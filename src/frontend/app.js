// I18n utilities
const i18n = {
    currentLanguage: 'en',
    translations: {},
    
    async load(lang) {
        try {
            const response = await fetch(`./translations/${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            this.translations[lang] = await response.json();
            this.currentLanguage = lang;
            localStorage.setItem('survey_lang', lang);
            return true;
        } catch (e) {
            console.error('[i18n] Failed to load language:', e);
            if (lang !== 'en') {
                console.log('[i18n] Falling back to English');
                return this.load('en');
            }
            return false;
        }
    },
    
    t(key) {
        const keys = key.split('.');
        let value = this.translations[this.currentLanguage] || {};
        for (const k of keys) {
            value = value[k];
            if (!value) return key;
        }
        return value;
    },
    
    replace(text, vars) {
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] || match);
    }
};

// Cookie utilities
const cookieUtils = {
    set(name, value, days = 30) {
        const expires = new Date();
        expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
        const cookieValue = encodeURIComponent(value) + '; expires=' + expires.toUTCString() + '; path=/; SameSite=Lax';
        document.cookie = name + '=' + cookieValue;
    },
    
    get(name) {
        const nameEQ = name + '=';
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.indexOf(nameEQ) === 0) {
                return decodeURIComponent(cookie.substring(nameEQ.length));
            }
        }
        return null;
    },
    
    remove(name) {
        this.set(name, '', -1);
    }
};

// Survey Tool Application
class SurveyApp {
    constructor() {
        this.metadata = [];
        this.sessionId = null;  // Will be set from API or cookie
        this.demographics = null;  // User demographics data
        this.currentSampleIndex = 0;
        this.currentSampleId = null;  // Track current sample ID (not index)
        this.currentStage = 1; // 1 = Pipeline 1, 2-5 = Pipeline 2 caption models
        this.ratings = {};      // In-memory cache for fast UI updates
        this.selectedFinalistCard = null;  // Track selected finalist for stage 6
        this.selectedFinalistSample = null;  // Track which sample the finalist is for
        this.stageBestImages = {};  // Best images for each stage {1: {...}, 2: {...}, ...}
        this.completedSampleIds = [];  // Track articles shown in this session for intelligent article selection
        this.totalPoints = 0;  // Gamification: accumulated points from source guesses
        this.currentBadgeTier = -1;  // Track current badge tier for detecting level-ups
        this.metadataPath = '/evaluation_sample_100_meta_data.json';
        this.sampleBasePath = './sample_100';  // Relative path to sample data (works with HTTP server from frontend/)
        this.apiBaseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:5000/api/v1'   // Local development
            : '/api/v1';                        // Production (proxied by Nginx)
        this.hasDemographics = false;  // Track if demographics collected
        
        // Evaluation criteria for each card
        this.criteria = [
            { key: 'a', label: 'Relevance', type: 'stars' },
            { key: 'b', label: 'Real-like', type: 'stars' },
            { key: 'c', label: 'Accuracy', type: 'stars' },
            { key: 'd', label: 'Source Guess', type: 'binary' }  // New binary criterion
        ];
        
        // Caption models for Pipeline 2 cycling (in order)
        this.captionModelQueue = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
        
        this.initializeApp();

        // Intercept all fetch calls for logging
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const [resource, config] = args;
            const method = (config?.method || 'GET').toUpperCase();
            const url = typeof resource === 'string' ? resource : resource.url;
            
            console.log(`[FETCH] ${method} ${url}`);
            if (config?.body) {
                try {
                    console.log(`[FETCH] Request body:`, JSON.parse(config.body));
                } catch (e) {
                    console.log(`[FETCH] Request body:`, config.body);
                }
            }
            
            try {
                const response = await originalFetch.apply(window, args);
                console.log(`[FETCH] Response: ${method} ${url} -> ${response.status}`);
                return response;
            } catch (error) {
                console.error(`[FETCH] ERROR: ${method} ${url} ->`, error.message);
                throw error;
            }
        };
    }

    updateDebugPanel() {
        try {
            const sessionIdEl = document.getElementById('debugSessionId');
            const apiUrlEl = document.getElementById('debugApiUrl');
            const statusEl = document.getElementById('debugStatus');
            const detailsEl = document.getElementById('debugDetails');
            
            if (sessionIdEl) sessionIdEl.textContent = this.sessionId || 'Not initialized';
            if (apiUrlEl) apiUrlEl.textContent = this.apiBaseUrl;
            if (statusEl) {
                if (!this.sessionId) {
                    statusEl.textContent = '🔄 Initializing...';
                    statusEl.style.color = 'orange';
                } else if (this.metadata.length === 0) {
                    statusEl.textContent = '⏳ Loading metadata...';
                    statusEl.style.color = 'blue';
                } else {
                    statusEl.textContent = '✅ Ready';
                    statusEl.style.color = 'green';
                }
            }
            
            if (detailsEl) {
                detailsEl.innerHTML = `
                    <div>Current: ID ${this.currentSampleId || '?'}</div>
                    <div>Completed: ${this.completedSampleIds.length}/${this.metadata.length || '?'}</div>
                    <div>Stage: ${this.currentStage}/6</div>
                    <div>Ratings cached: ${Object.keys(this.ratings).length}</div>
                    <div style="margin-top: 5px; word-break: break-all; font-size: 9px; color: #666;">
                        Last update: ${new Date().toLocaleTimeString()}
                    </div>
                `;
            }
        } catch (e) {
            console.error('[updateDebugPanel] Error:', e);
        }
    }

    async createSession() {
        try {
            console.log('[createSession] Creating new session via API...');
            console.log('[createSession] API URL:', `${this.apiBaseUrl}/sessions/`);
            
            const response = await fetch(`${this.apiBaseUrl}/sessions/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            console.log('[createSession] Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create session: HTTP ${response.status}, Response: ${errorText}`);
            }
            
            const data = await response.json();
            console.log('[createSession] Response data:', JSON.stringify(data, null, 2));
            
            if (!data.session || !data.session.id) {
                throw new Error(`Invalid session response - missing session.id. Got: ${JSON.stringify(data)}`);
            }
            
            this.sessionId = data.session.id;
            console.log('[createSession] ✅ Session created successfully:', this.sessionId);
            
            this.updateDebugPanel();
            return this.sessionId;
        } catch (error) {
            console.error('[createSession] ❌ Error creating session:', error.message);
            console.error('[createSession] Full error:', error);
            throw error;
        }
    }

    showConsentBanner() {
        return new Promise((resolve) => {
            console.log('[showConsentBanner] Displaying consent banner...');
            
            const modal = document.getElementById('consentModal');
            const rememberBtn = document.getElementById('consentRemember');
            const skipBtn = document.getElementById('consentSkip');
            
            // Find or create language selector for consent banner
            let consentLangSelect = document.getElementById('consentLanguageSelect');
            if (!consentLangSelect) {
                // Create container for language selector with label
                const langContainer = document.createElement('div');
                langContainer.style.cssText = 'position: absolute; top: 10px; right: 10px; display: flex; align-items: center; gap: 6px;';
                
                // Create language label with globe icon
                const langLabel = document.createElement('span');
                langLabel.textContent = '🌐';
                langLabel.style.fontSize = '16px';
                
                // Create language selector if it doesn't exist
                consentLangSelect = document.createElement('select');
                consentLangSelect.id = 'consentLanguageSelect';
                consentLangSelect.style.cssText = 'padding: 5px; font-size: 12px;';
                consentLangSelect.innerHTML = `
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="fr">Français</option>
                    <option value="si">සිංහල</option>
                `;
                
                // Append label and select to container
                langContainer.appendChild(langLabel);
                langContainer.appendChild(consentLangSelect);
                
                // Add change listener for language selection
                consentLangSelect.addEventListener('change', async (e) => {
                    const selectedLang = e.target.value;
                    console.log('[showConsentBanner] Language changed to:', selectedLang);
                    await i18n.load(selectedLang);
                    cookieUtils.set('survey_lang', selectedLang);
                    // Update consent banner text in new language
                    document.getElementById('consentTitle').textContent = i18n.t('consent.title');
                    document.getElementById('consentMessage').textContent = i18n.t('consent.message');
                    rememberBtn.textContent = i18n.t('consent.rememberButton');
                    skipBtn.textContent = i18n.t('consent.skipButton');
                    console.log('[showConsentBanner] Consent banner text updated to', selectedLang);
                    
                    // SYNC: Update main language select if it exists
                    const mainLangSelect = document.getElementById('languageSelect');
                    if (mainLangSelect) {
                        mainLangSelect.value = selectedLang;
                        console.log('[showConsentBanner] Main language select synced to', selectedLang);
                    }
                });
                
                // Add to modal
                const modalContent = modal.querySelector('.modal-content') || modal;
                modalContent.style.position = 'relative';
                modalContent.appendChild(langContainer);
            }
            
            // Set current language in selector
            consentLangSelect.value = i18n.currentLanguage;
            
            // Update text from i18n
            document.getElementById('consentTitle').textContent = i18n.t('consent.title');
            document.getElementById('consentMessage').textContent = i18n.t('consent.message');
            rememberBtn.textContent = i18n.t('consent.rememberButton');
            skipBtn.textContent = i18n.t('consent.skipButton');
            
            rememberBtn.onclick = async () => {
                console.log('[showConsentBanner] User clicked "Remember Me" - will collect demographics');
                await this.createSession();
                cookieUtils.set('survey_session_id', this.sessionId, 30);
                console.log('[showConsentBanner] Session cookie set for consenting user');
                modal.classList.add('hidden');
                resolve(true);  // true = Remember Me (collect demographics)
            };
            
            skipBtn.onclick = async () => {
                console.log('[showConsentBanner] User clicked "Skip" - ghost user, no demographics');
                await this.createSession();
                console.log('[showConsentBanner] Temp session created for ghost user (no cookie)');
                modal.classList.add('hidden');
                resolve(false);  // false = Skip (no demographics, ghost user)
            };
            
            modal.classList.remove('hidden');
        });
    }

    showDemographicForm() {
        return new Promise((resolve) => {
            console.log('[showDemographicForm] Displaying demographic form...');
            
            const modal = document.getElementById('demographicModal');
            const form = document.getElementById('demographicForm');
            const submitBtn = document.getElementById('demographicSubmit');

            // Helper: update all translatable labels in the form
            const updateDemographicLabels = () => {
                document.getElementById('demographicTitle').textContent = i18n.t('demographics.title');
                document.getElementById('demographicSubtitle').textContent = i18n.t('demographics.subtitle');
                document.getElementById('ageLabel').textContent = i18n.t('demographics.age');
                document.getElementById('occupationLabel').textContent = i18n.t('demographics.occupation');
                document.getElementById('educationLabel').textContent = i18n.t('demographics.education');
                document.getElementById('aiExperienceLabel').textContent = i18n.t('demographics.aiExperience');
                document.getElementById('aiStanceLabel').textContent = i18n.t('demographics.aiStance');
                document.getElementById('demographicSubmit').textContent = i18n.t('buttons.startSurvey');
            };

            // Find or create language selector for demographic modal
            let demoLangSelect = document.getElementById('demographicLanguageSelect');
            if (!demoLangSelect) {
                const langContainer = document.createElement('div');
                langContainer.style.cssText = 'position: absolute; top: 10px; right: 10px; display: flex; align-items: center; gap: 6px;';

                const langLabel = document.createElement('span');
                langLabel.textContent = '🌐';
                langLabel.style.fontSize = '16px';

                demoLangSelect = document.createElement('select');
                demoLangSelect.id = 'demographicLanguageSelect';
                demoLangSelect.style.cssText = 'padding: 5px; font-size: 12px;';
                demoLangSelect.innerHTML = `
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="fr">Français</option>
                    <option value="si">සිංහල</option>
                `;

                demoLangSelect.addEventListener('change', async (e) => {
                    const selectedLang = e.target.value;
                    console.log('[showDemographicForm] Language changed to:', selectedLang);
                    await i18n.load(selectedLang);
                    cookieUtils.set('survey_lang', selectedLang);
                    updateDemographicLabels();
                    console.log('[showDemographicForm] Form labels updated to', selectedLang);

                    // SYNC: Update consent and main language selects if present
                    const consentLangSelect = document.getElementById('consentLanguageSelect');
                    if (consentLangSelect) consentLangSelect.value = selectedLang;
                    const mainLangSelect = document.getElementById('languageSelect');
                    if (mainLangSelect) mainLangSelect.value = selectedLang;
                });

                langContainer.appendChild(langLabel);
                langContainer.appendChild(demoLangSelect);

                const modalContent = modal.querySelector('.modal-content') || modal;
                modalContent.style.position = 'relative';
                modalContent.appendChild(langContainer);
            }

            // Set selector to current language
            demoLangSelect.value = i18n.currentLanguage;

            // Update labels from i18n
            updateDemographicLabels();
            
            submitBtn.onclick = async () => {
                if (!form.checkValidity()) {
                    alert(i18n.t('notifications.completeAllRatings'));
                    return;
                }
                
                console.log('[showDemographicForm] Submitting demographics...');
                const formData = new FormData(form);
                
                const demographics = {
                    session_id: this.sessionId,
                    age: document.getElementById('ageSelect').value,
                    occupation: document.getElementById('occupationSelect').value,
                    education: document.getElementById('educationSelect').value,
                    ai_experience: formData.get('aiExperience'),
                    ai_stance: formData.get('aiStance')
                };
                
                try {
                    const response = await fetch(`${this.apiBaseUrl}/demographics/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(demographics)
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Failed to save demographics: ${response.status}`);
                    }
                    
                    const data = await response.json();
                    console.log('[showDemographicForm] Demographics saved:', data);
                    this.demographics = demographics;
                    this.hasDemographics = true;
                    this.showNotification(i18n.t('notifications.demographicsSaved'));
                    modal.classList.add('hidden');
                    resolve(true);
                } catch (error) {
                    console.error('[showDemographicForm] Error saving demographics:', error);
                    this.showError(i18n.t('notifications.demographicsError'));
                }
            };
            
            modal.classList.remove('hidden');
        });
    }

    async checkDemographics() {
        try {
            console.log('[checkDemographics] Checking if demographics exist...');
            const response = await fetch(`${this.apiBaseUrl}/demographics/${this.sessionId}`);
            
            if (response.ok) {
                const data = await response.json();
                this.demographics = data.demographic;
                this.hasDemographics = true;
                console.log('[checkDemographics] Demographics found:', this.demographics);
                return true;
            } else {
                console.log('[checkDemographics] No demographics found, showing form...');
                await this.showDemographicForm();
                return true;
            }
        } catch (error) {
            console.error('[checkDemographics] Error:', error);
            // If we can't check, show the form anyway
            await this.showDemographicForm();
            return false;
        }
    }

    async restoreSessionProgress() {
        try {
            console.log('[restoreSessionProgress] Fetching session progress...');
            const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}`);
            
            if (response.ok) {
                const data = await response.json();
                const session = data.session;
                
                // Restore the article being worked on
                this.currentSampleId = session.last_sample_id || null;
                this.currentStage = session.last_stage || 1;
                
                // Restore completed sample IDs from backend
                this.completedSampleIds = data.completed_sample_ids || [];
                console.log('[restoreSessionProgress] Restored completed samples:', this.completedSampleIds);
                
                // Restore total points and update badge display
                this.totalPoints = session.total_points || 0;
                // Set initial badge tier without triggering animation on first load
                const badgeTiers = [
                    { min: 0, max: 19 },    // tier 0
                    { min: 20, max: 49 },   // tier 1
                    { min: 50, max: 99 },   // tier 2
                    { min: 100, max: 199 }, // tier 3
                    { min: 200, max: 299 }, // tier 4
                    { min: 300, max: Infinity } // tier 5
                ];
                this.currentBadgeTier = badgeTiers.findIndex(t => this.totalPoints >= t.min && this.totalPoints <= t.max);
                this.updateBadgeDisplay();
                console.log('[restoreSessionProgress] Restored total points:', this.totalPoints, 'Badge tier:', this.currentBadgeTier);
                
                // Safety check: if stage > 1 but no currentSampleId, reset to stage 1
                // This prevents invalid state where article is missing
                if (this.currentStage > 1 && !this.currentSampleId) {
                    console.warn('[restoreSessionProgress] ⚠️ Invalid state detected: stage', this.currentStage, 'but no currentSampleId. Resetting to stage 1.');
                    this.currentStage = 1;
                    this.currentSampleId = null;
                }
                
                console.log('[restoreSessionProgress] Session restored:', {
                    currentSampleId: this.currentSampleId,
                    stage: this.currentStage,
                    completedCount: this.completedSampleIds.length,
                    totalPoints: this.totalPoints,
                    isCompleted: session.is_completed
                });
                
                return true;
            } else {
                console.warn('[restoreSessionProgress] Could not fetch session, starting fresh');
                this.currentStage = 1;
                this.currentSampleId = null;
                this.completedSampleIds = [];
                this.totalPoints = 0;
                // Initialize badge tier without animation on fresh start
                const badgeTiers = [
                    { min: 0, max: 19 },    // tier 0
                    { min: 20, max: 49 },   // tier 1
                    { min: 50, max: 99 },   // tier 2
                    { min: 100, max: 199 }, // tier 3
                    { min: 200, max: 299 }, // tier 4
                    { min: 300, max: Infinity } // tier 5
                ];
                this.currentBadgeTier = badgeTiers.findIndex(t => this.totalPoints >= t.min && this.totalPoints <= t.max);
                this.updateBadgeDisplay();
                return true;
            }
        } catch (error) {
            console.error('[restoreSessionProgress] Error:', error);
            this.currentStage = 1;
            this.currentSampleId = null;
            this.completedSampleIds = [];
            return false;
        }
    }

    /**
     * Calculate badge info based on total points
     * Badge tiers:
     * - 0-19:    🤖 (No badge, accumulating)
     * - 20-49:   🤓 AI Newbie
     * - 50-99:   😎 AI Spotter
     * - 100-199: 🧐 AI Expert
     * - 200-299: 👁️ AI Oracle
     * - 300+:    🏆 Legendary Detector
     */
    getBadgeInfo(points) {
        const badges = [
            { min: 0, max: 19, name: 'noBadge', emoji: '🤖', label: '' },
            { min: 20, max: 49, name: 'newbie', emoji: '🤓', label: i18n.t('survey.badge.newbie') },
            { min: 50, max: 99, name: 'spotter', emoji: '😎', label: i18n.t('survey.badge.spotter') },
            { min: 100, max: 199, name: 'expert', emoji: '🧐', label: i18n.t('survey.badge.expert') },
            { min: 200, max: 299, name: 'oracle', emoji: '👁️', label: i18n.t('survey.badge.oracle') },
            { min: 300, max: Infinity, name: 'legendary', emoji: '🏆', label: i18n.t('survey.badge.legendary') }
        ];
        
        const currentBadge = badges.find(b => points >= b.min && points <= b.max);
        const nextBadge = badges.find(b => b.min > currentBadge.max);
        
        const currentLevelStart = currentBadge.min;
        const nextLevelStart = nextBadge?.min || (currentBadge.max + 1);
        const progress = ((points - currentLevelStart) / (nextLevelStart - currentLevelStart)) * 100;
        
        return {
            ...currentBadge,
            currentPoints: points,
            nextLevelStart: nextLevelStart,
            pointsToNext: Math.max(0, nextLevelStart - points),
            progressPercent: Math.min(100, progress),
            isMaxBadge: !nextBadge
        };
    }

    animatePointsFloating(points) {
        /**
         * Create a floating "+X points" animation above the badge
         * that floats up and fades out
         */
        const badgeElement = document.getElementById('userBadge');
        if (!badgeElement || points === 0) return;
        
        // Create floating points overlay element
        const floatingPoints = document.createElement('div');
        floatingPoints.className = 'floating-points';
        floatingPoints.textContent = `+${points} ⭐`;
        
        // Position it relative to the badge
        const badgeRect = badgeElement.getBoundingClientRect();
        floatingPoints.style.cssText = `
            position: fixed;
            left: ${badgeRect.left + badgeRect.width / 2}px;
            top: ${badgeRect.top + badgeRect.height / 2}px;
            pointer-events: none;
            z-index: 10000;
        `;
        
        document.body.appendChild(floatingPoints);
        
        // Remove element after animation completes
        setTimeout(() => {
            floatingPoints.remove();
        }, 1200);
        
        console.log('[animatePointsFloating] Animating +' + points + ' points');
    }

    updateBadgeDisplay() {
        const badgeInfo = this.getBadgeInfo(this.totalPoints);
        
        // Update badge in header
        const badgeElement = document.getElementById('userBadge');
        if (badgeElement) {
            // Detect badge tier change (level-up)
            const badgeTiers = [
                { min: 0, max: 19 },    // tier 0
                { min: 20, max: 49 },   // tier 1
                { min: 50, max: 99 },   // tier 2
                { min: 100, max: 199 }, // tier 3
                { min: 200, max: 299 }, // tier 4
                { min: 300, max: Infinity } // tier 5
            ];
            
            const currentTier = badgeTiers.findIndex(t => this.totalPoints >= t.min && this.totalPoints <= t.max);
            const isBadgeLevelUp = currentTier > this.currentBadgeTier;
            
            if (isBadgeLevelUp && this.currentBadgeTier !== -1) {
                // Remove any existing animation class
                badgeElement.classList.remove('badge-levelup');
                // Trigger reflow to restart animation
                void badgeElement.offsetWidth;
                // Add animation class
                badgeElement.classList.add('badge-levelup');
                console.log('[updateBadgeDisplay] Badge level-up detected! Tier:', this.currentBadgeTier, '->', currentTier);
            }
            
            this.currentBadgeTier = currentTier;
            
            badgeElement.innerHTML = `
                <div class="badge-container">
                    <span class="badge-icon">${badgeInfo.emoji}</span>
                    <span class="badge-text">
                        <div class="badge-name">${badgeInfo.label || 'detective just started...'}</div>
                        <div class="badge-points">${badgeInfo.currentPoints} ⭐</div>
                    </span>
                </div>
                <div class="badge-progress-bar">
                    <div class="badge-progress-fill" style="width: ${badgeInfo.progressPercent}%"></div>
                    <div class="badge-progress-text">${badgeInfo.pointsToNext} more ⭐ to next badge</div>
                </div>
            `;
        }
    }

    updateUILanguage() {
        console.log('[updateUILanguage] Updating UI for language:', i18n.currentLanguage);
        
        // Update language select dropdown
        const langSelect = document.getElementById('languageSelect');
        if (langSelect) {
            langSelect.value = i18n.currentLanguage;
        }
        
        // Update main title and labels
        const surveyTitle = document.getElementById('surveyTitle');
        if (surveyTitle) {
            surveyTitle.textContent = i18n.t('survey.title');
        }
        
        // Update stage and sample labels
        const stageLabel = document.getElementById('stageLabel');
        const sampleLabel = document.getElementById('sampleLabel');
        if (stageLabel) stageLabel.textContent = i18n.t('survey.stage').split(' ')[0]; // Get "Stage" part
        if (sampleLabel) sampleLabel.textContent = i18n.t('survey.sampleCount').split(' ')[0]; // Get "Sample" part
        
        // Update button labels
        const articleBtn = document.getElementById('articleBtn');
        const summaryBtn = document.getElementById('summaryBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (articleBtn) articleBtn.textContent = i18n.t('buttons.article');
        if (summaryBtn) summaryBtn.textContent = i18n.t('buttons.summary');
        if (nextBtn) nextBtn.textContent = i18n.t('buttons.next');
        
        // Update criterion labels if cards are visible
        this.updateCriteriaLabels();
    }

    updateLanguageWarningBanner() {
        const banner = document.getElementById('languageWarningBanner');
        const bannerText = document.getElementById('languageWarningText');
        if (!banner || !bannerText) return;

        if (i18n.currentLanguage === 'en') {
            banner.style.display = 'none';
            console.log('[updateLanguageWarningBanner] Banner hidden (English selected)');
        } else {
            banner.style.display = 'block';
            bannerText.textContent = i18n.t('survey.languageWarningMessage');
            console.log('[updateLanguageWarningBanner] Banner shown (non-English language:', i18n.currentLanguage + ')');
        }
    }

    async changeLanguage(lang) {
        console.log('[changeLanguage] Changing language to:', lang);
        await i18n.load(lang);
        cookieUtils.set('survey_lang', lang);  // Update cookie so loadArticle/loadSummary use correct language
        this.updateUILanguage();
        this.updateLanguageWarningBanner();  // Show/hide banner based on language
        this.updateContentWarningBanner();  // Update article/summary content banner for new language
        
        // SYNC: Update consent banner language select if it exists
        const consentLangSelect = document.getElementById('consentLanguageSelect');
        if (consentLangSelect) {
            consentLangSelect.value = lang;
            console.log('[changeLanguage] Consent banner language select synced to', lang);
        }
        
        // Update criterion labels on currently displayed cards without regenerating
        this.updateCriteriaLabels();
        // Update Next button tooltip in new language
        if (document.getElementById('nextBtn')?.disabled) {
            document.getElementById('nextBtn').title = i18n.t('buttons.nextTooltip');
        }
        // Reload content (article, summary, caption) in new language
        if (this.currentSampleId !== null) {
            console.log('[changeLanguage] Reloading sample content in new language');
            await this.displaySample();
        }
    }

    updateCriteriaLabels() {
        console.log('[updateCriteriaLabels] Updating criterion labels for language:', i18n.currentLanguage);
        
        // Update criterion labels on all currently visible cards
        const cards = document.querySelectorAll('.image-card');
        
        cards.forEach(card => {
            this.criteria.forEach(criterion => {
                const criterionDiv = card.querySelector(`[data-criterion="${criterion.key}"]`);
                if (criterionDiv) {
                    const labelElement = criterionDiv.querySelector('.criterion-label');
                    if (labelElement) {
                        const labelKey = criterion.key === 'a' ? 'relevance' : 
                                        criterion.key === 'b' ? 'real_like' : 'accuracy';
                        const translatedLabel = i18n.t(`criteria.${labelKey}.label`);
                        labelElement.textContent = translatedLabel + ':';
                        console.log(`[updateCriteriaLabels] Updated ${criterion.key} to: ${translatedLabel}`);
                    }
                }
            });
        });
    }

    async initializeApp() {
        try {
            console.log('🚀 [initializeApp] Starting app initialization...');
            
            // Step 0: Load language
            console.log('[initializeApp] Step 0: Loading language...');
            const savedLanguage = cookieUtils.get('survey_lang') || 'en';
            await i18n.load(savedLanguage);
            this.updateUILanguage();
            console.log('[initializeApp] Step 0 complete: Language =', i18n.currentLanguage);
            
            // Step 1: Check for existing session cookie
            console.log('[initializeApp] Step 1: Checking for existing session...');
            const cookieSessionId = cookieUtils.get('survey_session_id');
            let isReturningUser = false;
            let shouldCollectDemographics = false;
            
            if (cookieSessionId) {
                console.log('[initializeApp] Found existing session cookie:', cookieSessionId);
                this.sessionId = cookieSessionId;
                isReturningUser = true;
                shouldCollectDemographics = true;  // Returning user with cookie should have demographics
                this.showNotification(i18n.t('notifications.sessionResumed'));
            } else {
                console.log('[initializeApp] No session cookie found - showing consent banner');
                shouldCollectDemographics = await this.showConsentBanner();  // true = Remember Me, false = Skip
                
                if (!this.sessionId) {
                    throw new Error('Failed to create session');
                }
                
                if (shouldCollectDemographics) {
                    console.log('[initializeApp] User consented (Remember Me) - will collect demographics');
                } else {
                    console.log('[initializeApp] User skipped consent (ghost user) - no demographics collection');
                }
            }
            console.log('[initializeApp] Step 1 complete: Session ID =', this.sessionId, ', Collect demographics =', shouldCollectDemographics);
            
            // Step 2: Load metadata
            console.log('[initializeApp] Step 2: Loading metadata...');
            await this.loadMetadata();
            console.log('[initializeApp] Step 2 complete: Loaded', this.metadata.length, 'samples');
            
            // Step 3: Collect demographics from all users (cookie consent is separate from research data collection)
            console.log('[initializeApp] Step 3: Checking demographics requirement...');
            if (isReturningUser) {
                console.log('[initializeApp] Returning user - checking existing demographics');
                await this.checkDemographics();
            } else {
                console.log('[initializeApp] New user - showing demographic form (applies to both consenting and ghost users)');
                await this.showDemographicForm();
            }
            console.log('[initializeApp] Step 3 complete: Demographics handled');
            
            // Step 4: Restore session progress (for returning users)
            console.log('[initializeApp] Step 4: Restoring session progress...');
            await this.restoreSessionProgress();
            console.log('[initializeApp] Step 4 complete: Session restored with', this.completedSampleIds.length, 'completed articles, Stage', this.currentStage);
            
            // Step 4.5: Load stored stage best images (for next sample we'll display)
            console.log('[initializeApp] Step 4.5: Loading stored stage best images will happen during displaySample');
            
            // Step 5: Setup event listeners
            console.log('[initializeApp] Step 5: Setting up event listeners...');
            this.setupEventListeners();
            this.setupStickyCaptionBar();
            console.log('[initializeApp] Step 5 complete');
            
            // Step 6: Display sample (will fetch from database)
            console.log('[initializeApp] Step 6: Displaying sample...');
            await this.displaySample();
            console.log('[initializeApp] Step 6 complete');
            
            // Step 7: Update language warning banner
            console.log('[initializeApp] Step 7: Updating language warning banner...');
            this.updateLanguageWarningBanner();
            console.log('[initializeApp] Step 7 complete');
            
            console.log('✅ [initializeApp] App initialization complete');
            console.log('[initializeApp] Ready to rate! Session ID:', this.sessionId);
        } catch (error) {
            console.error('❌ [initializeApp] Initialization failed:', error.message);
            console.error('[initializeApp] Full error:', error);
            this.showError(i18n.t('errors.loadingFailed'));
        }
    }

    setupStickyCaptionBar() {
        if (window.innerWidth > 768) return;

        const captionSection = document.querySelector('.caption-section');
        const stickyBar = document.getElementById('stickyCaptionBar');
        const toggleBtn = document.getElementById('stickyCaptionToggle');

        if (!captionSection || !stickyBar || !toggleBtn) return;

        // Tap header to expand/collapse caption text
        toggleBtn.addEventListener('click', () => {
            stickyBar.classList.toggle('expanded');
        });

        // Show when caption section scrolls out of view, hide when back in view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    stickyBar.classList.remove('hidden');
                } else {
                    stickyBar.classList.add('hidden');
                    stickyBar.classList.remove('expanded');
                }
            });
        }, { threshold: 0.1 });

        observer.observe(captionSection);
    }

    async loadMetadata() {
        try {
            console.log('[loadMetadata] Loading from path:', this.metadataPath);
            const response = await fetch(this.metadataPath);
            if (!response.ok) {
                console.error('[loadMetadata] Response not OK, status:', response.status);
                throw new Error(`Failed to fetch metadata: ${response.status}`);
            }
            this.metadata = await response.json();
            console.log('[loadMetadata] Successfully loaded', this.metadata.length, 'samples');
            
            document.getElementById('totalSamples').textContent = this.metadata.length;
            console.log('[loadMetadata] Metadata loading complete');
            this.updateDebugPanel();
        } catch (error) {
            console.error('[loadMetadata] Error:', error);
            throw error;
        }
    }

    getSampleById(sampleId) {
        /**
         * Find a sample in metadata by its ID.
         * Returns the sample object or null if not found.
         */
        return this.metadata.find(sample => sample.id === sampleId) || null;
    }

    async fetchNextLeastRatedArticle() {
        /**
         * Fetch the next article using three-phase intelligent selection:
         * Phase 0 (Resume): Find incomplete articles from current session
         * Phase 1 (Coverage): Get fresh articles (no ratings yet)
         * Phase 2 (Balancing): Get least-rated articles to balance distribution
         * 
         * Returns {sample, phase, stage} or null if all articles shown
         */
        try {
            console.log('[fetchNextLeastRatedArticle] Fetching article with intelligent selection...');
            console.log('[fetchNextLeastRatedArticle] Completed samples so far:', this.completedSampleIds);
            
            const excludeStr = this.completedSampleIds.join(',');
            const response = await fetch(
                `${this.apiBaseUrl}/sessions/${this.sessionId}/least-rated-article?exclude_samples=${excludeStr}&limit=1`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                console.error('[fetchNextLeastRatedArticle] API error:', response.status);
                return null;
            }

            const data = await response.json();
            const articles = data.least_rated_articles || [];
            const phase = data.phase || 'unknown';

            if (articles.length === 0) {
                console.log('[fetchNextLeastRatedArticle] No articles available');
                return null;
            }

            const article = articles[0];
            const nextSampleId = article.sample_id;
            const ratingCount = article.rating_count || 0;
            
            // Handle Phase 0 (Resume) - incomplete article with specific stage
            if (phase === 'resume') {
                const resumeStage = article.stage;
                console.log(`[fetchNextLeastRatedArticle] PHASE 0 (Resume): Found incomplete sample ${nextSampleId} at stage ${resumeStage} with ${ratingCount}/28 ratings`);
                console.warn(`[fetchNextLeastRatedArticle] ⚠️ User session interrupted! Resuming at Stage ${resumeStage}`);
                
                // Get the sample object from metadata
                const sample = this.getSampleById(nextSampleId);
                if (!sample) {
                    console.warn('[fetchNextLeastRatedArticle] Sample ID not found in metadata:', nextSampleId);
                    return null;
                }
                
                this.currentSampleId = nextSampleId;
                this.currentStage = resumeStage;  // Resume at the incomplete stage
                
                return { sample, phase, stage: resumeStage };
            }
            
            // Handle Phase 1 (Coverage) or Phase 2 (Balancing) - new article starting at stage 1
            console.log(`[fetchNextLeastRatedArticle] PHASE ${phase === 'coverage' ? 1 : 2} (${phase === 'coverage' ? 'Coverage' : 'Balancing'}): Found sample ${nextSampleId} with ${ratingCount} ratings`);

            // Get the actual sample object from metadata
            const sample = this.getSampleById(nextSampleId);
            if (!sample) {
                console.warn('[fetchNextLeastRatedArticle] Sample ID not found in metadata:', nextSampleId);
                return null;
            }

            this.currentSampleId = nextSampleId;
            return { sample, phase, stage: 1 };  // New article always starts at stage 1
            
        } catch (error) {
            console.error('[fetchNextLeastRatedArticle] Error:', error);
            return null;
        }
    }

    setupEventListeners() {
        document.getElementById('nextBtn').addEventListener('click', async () => await this.handleNextCaption());
        document.getElementById('articleBtn').addEventListener('click', (e) => this.toggleArticleView(e.target));
        document.getElementById('summaryBtn').addEventListener('click', (e) => this.toggleSummaryView(e.target));
        document.getElementById('leaveBtn').addEventListener('click', () => this.showLeaveConfirmation());
    }

    updateMainInstructionBanner() {
        const banner = document.getElementById('mainInstructionBanner');
        const finalizationBanner = document.getElementById('finalizationInstructionBanner');
        
        // Show banner for stages 1-5 (rating stages), hide for stage 6 (finalization)
        if (this.currentStage >= 1 && this.currentStage <= 5) {
            banner.textContent = i18n.t('survey.mainInstruction');
            banner.style.display = 'block';
            finalizationBanner.style.display = 'none';
            console.log('[updateMainInstructionBanner] Showing instruction banner for stage', this.currentStage);
        } else {
            banner.style.display = 'none';
            console.log('[updateMainInstructionBanner] Hiding instruction banner for stage', this.currentStage);
        }
    }

    async displaySample() {
        // Determine which article to display
        let sample = null;
        let resumePhase = false;
        
        if (this.currentStage === 1) {
            // Check if we're resuming from a page reload or starting a new article
            if (this.currentSampleId) {
                // Resuming from restore - use the saved article
                console.log('[displaySample] Resuming article from restore:', this.currentSampleId);
                sample = this.getSampleById(this.currentSampleId);
                if (!sample) {
                    console.log('[displaySample] Restored sample not found, fetching new article');
                    const result = await this.fetchNextLeastRatedArticle();
                    if (result) {
                        sample = result.sample;
                        resumePhase = result.phase === 'resume';
                    }
                }
            } else {
                // Starting a new article - use intelligent selection
                console.log('[displaySample] Starting new article, using intelligent selection');
                const result = await this.fetchNextLeastRatedArticle();
                if (result) {
                    sample = result.sample;
                    resumePhase = result.phase === 'resume';
                }
            }
            
            if (!sample) {
                console.log('[displaySample] No more articles available - showing completion');
                this.showCompletion();
                return;
            }
        } else {
            // Continue with the current article for stages 2-6
            sample = this.getSampleById(this.currentSampleId);
            if (!sample) {
                console.log('[displaySample] Current sample not found');
                this.showCompletion();
                return;
            }
        }
        
        // Check if this is finalization stage (stage 6)
        if (this.currentStage === 6) {
            console.log(`[displaySample] Stage 6 (Finalization) for sample ${sample.id}`);
            await this.displayFinalization(sample);
            return;
        }

        console.log(`[displaySample] Sample ID ${sample.id}, Stage ${this.currentStage}/5 (${resumePhase ? 'RESUMED' : 'NEW'})`);
        console.log('[displaySample] Sample data:', sample);

        // Update session progress on backend
        await this.updateSessionProgress();

        // Load ratings from backend for this stage
        await this.loadRatingsFromBackend();

        // Update progress - show article count and stage
        document.getElementById('stageProgress').textContent = this.currentStage;
        // Show: (completed articles + current article) - just the number, HTML has "/ 100" part
        const articleNumber = this.completedSampleIds.length + 1;
        document.getElementById('currentSample').textContent = articleNumber;
        
        // For progress bar, show percentage based on completed articles
        const progressPercent = ((this.completedSampleIds.length) / this.metadata.length) * 100;
        document.getElementById('progressFill').style.width = Math.min(progressPercent, 100) + '%';

        // Load article and summary
        console.log('[displaySample] Loading article...');
        const articleText = await this.loadArticle(sample);
        console.log('[displaySample] Article loaded, length:', articleText.length);
        
        console.log('[displaySample] Loading summary...');
        const summaryText = await this.loadSummary(sample);
        console.log('[displaySample] Summary loaded, length:', summaryText.length);

        // Get caption and images based on stage
        let captionText = '';
        let images = [];

        if (this.currentStage === 1) {
            // Stage 1/5: Original caption + 7 images (1 original + 6 generated)
            captionText = this.getTranslatedCaption(sample, sample.caption);
            console.log('[displaySample] Stage 1 (Pipeline 1) - using original caption');
            images = this.getImagesForPipeline1(sample);
        } else {
            // Stages 2-5: Synthetic caption models
            const stageIndex = this.currentStage - 2; // Convert stage 2-5 to index 0-3
            const captionModelName = this.captionModelQueue[stageIndex];
            console.log(`[displaySample] Stage ${this.currentStage} (Pipeline 2) - using caption model:`, captionModelName);
            
            const captionModelData = this.getCaptionModelData(sample, captionModelName);
            if (captionModelData) {
                captionText = this.getTranslatedCaption(captionModelData, captionModelData.generated_caption);
                images = this.getImagesForCaptionModel(sample, captionModelName);
            } else {
                console.warn('[displaySample] Caption model data not found');
                captionText = 'Caption not available';
            }
        }

        console.log('[displaySample] Caption text:', captionText.substring(0, 100) + '...');
        console.log('[displaySample] Images found:', images.length);

        // Show caption elements (they may be hidden from finalization stage)
        document.getElementById('captionTypeLabel').style.display = 'block';
        document.getElementById('captionDisplay').style.display = 'block';

        // Update UI
        document.getElementById('captionTypeLabel').textContent = 
            `Image Caption ${this.currentStage}`;
        document.getElementById('captionDisplay').textContent = captionText;

        // Sync sticky caption bar (mobile)
        const stickyCaptionText = document.getElementById('stickyCaptionText');
        const stickyCaptionTypeLabel = document.getElementById('stickyCaptionTypeLabel');
        if (stickyCaptionText) stickyCaptionText.textContent = captionText;
        if (stickyCaptionTypeLabel) stickyCaptionTypeLabel.textContent = `Image Caption ${this.currentStage}`;
        
        // Store for toggle access
        this.currentArticle = articleText;
        this.currentSummary = summaryText;

        // Display cards
        this.displayCards(images);

        // Update main instruction banner
        this.updateMainInstructionBanner();

        // Reset toggle buttons
        this.resetToggleButtons();

        // Check if all cards are rated and show/hide next button accordingly
        this.checkAllRated();
    }

    async loadArticle(sample) {
        try {
            const currentLanguage = cookieUtils.get('survey_lang') || 'en';
            const basePath = sample.article_path.replace(/^\.\//, '/sample_100/').replace('.txt', '');
            
            // If not English, try translated version first
            if (currentLanguage !== 'en') {
                const translatedPath = basePath + '_' + currentLanguage + '.txt';
                console.log('[loadArticle] Trying translated version:', translatedPath);
                
                try {
                    const response = await fetch(translatedPath);
                    if (response.ok) {
                        const text = await response.text();
                        console.log('[loadArticle] Successfully loaded translated article (' + currentLanguage + '), length:', text.length);
                        return text;
                    }
                } catch (e) {
                    console.warn('[loadArticle] Translated version not found, falling back to English');
                }
            }
            
            // Fall back to English
            const englishPath = basePath + '.txt';
            console.log('[loadArticle] Loading English version from path:', englishPath);
            
            const response = await fetch(englishPath);
            if (!response.ok) {
                console.warn('[loadArticle] Response not OK, status:', response.status);
                return 'Article not available';
            }
            const text = await response.text();
            console.log('[loadArticle] Successfully loaded English article, length:', text.length);
            return text;
        } catch (error) {
            console.error('[loadArticle] Error:', error);
            return 'Article not available';
        }
    }

    async loadSummary(sample) {
        try {
            const currentLanguage = cookieUtils.get('survey_lang') || 'en';
            
            // Get the base filename (e.g., "157840")
            const baseName = sample.article_path.split('/').pop().replace('.txt', '');
            const dirPath = sample.article_path.split('/').slice(0, -1).join('/');
            const summaryBase = (dirPath + '/' + baseName + '_deepseek_r1_summary').replace(/^\.\//, '/sample_100/');
            
            // If not English, try translated version first
            if (currentLanguage !== 'en') {
                const translatedSummaryPath = summaryBase + '_' + currentLanguage + '.txt';
                console.log('[loadSummary] Trying translated version:', translatedSummaryPath);
                
                try {
                    const response = await fetch(translatedSummaryPath);
                    if (response.ok) {
                        const text = await response.text();
                        console.log('[loadSummary] Successfully loaded translated summary (' + currentLanguage + '), length:', text.length);
                        return text;
                    }
                } catch (e) {
                    console.warn('[loadSummary] Translated version not found, falling back to English');
                }
            }
            
            // Fall back to English
            const englishSummaryPath = summaryBase + '.txt';
            console.log('[loadSummary] Loading English version from path:', englishSummaryPath);
            
            const response = await fetch(englishSummaryPath);
            if (!response.ok) {
                console.warn('[loadSummary] Response not OK, status:', response.status);
                return 'Summary not available';
            }
            const text = await response.text();
            console.log('[loadSummary] Successfully loaded English summary, length:', text.length);
            return text;
        } catch (error) {
            console.error('[loadSummary] Error:', error);
            return 'Summary not available';
        }
    }

    getCaptionModelData(sample, modelName) {
        const captionModel = sample.pipeline_2.caption_model;
        
        // Check closed_models first
        if (captionModel.closed_models && captionModel.closed_models[modelName]) {
            console.log('[getCaptionModelData] Found', modelName, 'in closed_models');
            return captionModel.closed_models[modelName];
        }
        
        // Check hf_models second
        if (captionModel.hf_models && captionModel.hf_models[modelName]) {
            console.log('[getCaptionModelData] Found', modelName, 'in hf_models');
            return captionModel.hf_models[modelName];
        }
        
        console.warn('[getCaptionModelData] Model not found:', modelName);
        return null;
    }

    getTranslatedCaption(captionData, fallbackCaption) {
        // Returns translated caption if available for current language, otherwise returns fallback
        const currentLanguage = cookieUtils.get('survey_lang') || 'en';
        
        if (currentLanguage !== 'en' && captionData && captionData.caption_translations && captionData.caption_translations[currentLanguage]) {
            console.log('[getTranslatedCaption] Using translated caption (' + currentLanguage + ')');
            return captionData.caption_translations[currentLanguage];
        }
        
        console.log('[getTranslatedCaption] Using English caption (translation unavailable or language is English)');
        return fallbackCaption;
    }

    // Seeded random number generator for consistent randomization across sessions
    seededShuffleArray(array, seed) {
        // Create a deterministic random function using the seed
        const seededRandom = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
        
        // Shuffle using seeded random
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(seededRandom() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    getImagesForPipeline1(sample) {
        console.log('[getImagesForPipeline1] Starting - getting 7 images (1 original + 6 generated)');
        let images = [];
        const imagePaths = {};

        // Add original image first
        if (sample.image_path) {
            imagePaths['original'] = sample.image_path;
            console.log('[getImagesForPipeline1] Added original image:', sample.image_path);
        }

        // Add 6 generated images from pipeline_1
        const pipeline1 = sample.pipeline_1;
        
        if (pipeline1.closed_models) {
            console.log('[getImagesForPipeline1] Closed models:', Object.keys(pipeline1.closed_models));
            Object.assign(imagePaths, pipeline1.closed_models);
        }
        
        if (pipeline1.hf_models) {
            console.log('[getImagesForPipeline1] HF models:', Object.keys(pipeline1.hf_models));
            Object.assign(imagePaths, pipeline1.hf_models);
        }

        // Filter out null values and convert paths
        console.log('[getImagesForPipeline1] All paths before filtering:', imagePaths);
        
        for (const [model, path] of Object.entries(imagePaths)) {
            if (path && path !== 'null') {
                const fullPath = this.convertPath(path);
                images.push({
                    model: model,
                    path: fullPath,
                    originalPath: path
                });
                console.log('[getImagesForPipeline1] Added:', model, '->', fullPath);
            } else {
                console.log('[getImagesForPipeline1] Skipped (null):', model);
            }
        }

        // Randomize image order (seeded for consistency across sessions)
        const seed = sample.id + this.currentStage; // Use sample ID + stage as seed
        images = this.seededShuffleArray(images, seed);

        console.log('[getImagesForPipeline1] Total images:', images.length);
        return images;
    }

    getImagesForCaptionModel(sample, modelName) {
        console.log('[getImagesForCaptionModel] Getting 6 images for caption model:', modelName);
        let images = [];
        let imagePaths = {};

        // Get caption model data
        const captionModelData = this.getCaptionModelData(sample, modelName);
        
        if (!captionModelData || !captionModelData.pipeline_1) {
            console.warn('[getImagesForCaptionModel] No pipeline_1 found for', modelName);
            return images;
        }

        const pipeline1 = captionModelData.pipeline_1;
        
        if (pipeline1.closed_models) {
            console.log('[getImagesForCaptionModel] Closed models:', Object.keys(pipeline1.closed_models));
            imagePaths = { ...imagePaths, ...pipeline1.closed_models };
        }
        
        if (pipeline1.hf_models) {
            console.log('[getImagesForCaptionModel] HF models:', Object.keys(pipeline1.hf_models));
            imagePaths = { ...imagePaths, ...pipeline1.hf_models };
        }

        // Filter out null values and convert paths
        console.log('[getImagesForCaptionModel] All paths before filtering:', imagePaths);
        
        for (const [model, path] of Object.entries(imagePaths)) {
            if (path && path !== 'null') {
                const fullPath = this.convertPath(path);
                images.push({
                    model: model,
                    path: fullPath,
                    originalPath: path
                });
                console.log('[getImagesForCaptionModel] Added:', model, '->', fullPath);
            } else {
                console.log('[getImagesForCaptionModel] Skipped (null):', model);
            }
        }

        // Randomize image order (seeded for consistency across sessions)
        const seed = 1000 + sample.id + this.currentStage; // Use sample ID + stage as seed
        images = this.seededShuffleArray(images, seed);

        console.log('[getImagesForCaptionModel] Total images:', images.length);
        return images;
    }

    getImagesForPipeline1Unrandomized(sample) {
        // Same as getImagesForPipeline1 but WITHOUT randomization (for consistency in finalization)
        console.log('[getImagesForPipeline1Unrandomized] Getting 7 images (unrandomized)');
        const images = [];
        const imagePaths = {};

        // Add original image first
        if (sample.image_path) {
            imagePaths['original'] = sample.image_path;
        }

        // Add 6 generated images from pipeline_1
        const pipeline1 = sample.pipeline_1;
        if (pipeline1.closed_models) {
            Object.assign(imagePaths, pipeline1.closed_models);
        }
        if (pipeline1.hf_models) {
            Object.assign(imagePaths, pipeline1.hf_models);
        }

        // Filter out null values and convert paths (NO randomization)
        for (const [model, path] of Object.entries(imagePaths)) {
            if (path && path !== 'null') {
                const fullPath = this.convertPath(path);
                images.push({
                    model: model,
                    path: fullPath,
                    originalPath: path
                });
            }
        }

        console.log('[getImagesForPipeline1Unrandomized] Total images:', images.length);
        return images;
    }

    getImagesForCaptionModelUnrandomized(sample, modelName) {
        // Same as getImagesForCaptionModel but WITHOUT randomization (for consistency in finalization)
        console.log('[getImagesForCaptionModelUnrandomized] Getting images (unrandomized) for:', modelName);
        const images = [];
        let imagePaths = {};

        const captionModelData = this.getCaptionModelData(sample, modelName);
        if (!captionModelData || !captionModelData.pipeline_1) {
            console.warn('[getImagesForCaptionModelUnrandomized] No pipeline_1 found for', modelName);
            return images;
        }

        const pipeline1 = captionModelData.pipeline_1;
        if (pipeline1.closed_models) {
            imagePaths = { ...imagePaths, ...pipeline1.closed_models };
        }
        if (pipeline1.hf_models) {
            imagePaths = { ...imagePaths, ...pipeline1.hf_models };
        }

        // Filter out null values and convert paths (NO randomization)
        for (const [model, path] of Object.entries(imagePaths)) {
            if (path && path !== 'null') {
                const fullPath = this.convertPath(path);
                images.push({
                    model: model,
                    path: fullPath,
                    originalPath: path
                });
            }
        }

        console.log('[getImagesForCaptionModelUnrandomized] Total images:', images.length);
        return images;
    }

    convertPath(path) {
        // Convert relative path to HTTP-accessible path
        // Remove leading ./
        let cleanPath = path.replace(/^\.\//, '');
        // Return path relative to survey_tool root (where HTTP server serves from)
        const converted = `sample_100/${cleanPath}`;
        console.log('[convertPath]', path, '->', converted);
        return converted;
    }

    displayCards(images) {
        const container = document.getElementById('cardsContainer');
        container.innerHTML = '';
        console.log('[displayCards] Starting to display', images.length, 'cards');
        console.log('[displayCards] Criteria available:', this.criteria);

        images.forEach((image, index) => {
            console.log('[displayCards] Creating card', index, 'for model:', image.model);
            const card = document.createElement('div');
            card.className = 'image-card';
            card.dataset.imageId = index;
            card.dataset.model = image.model;

            // Image wrapper for positioning fullscreen button
            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'image-wrapper';

            // Fullscreen button
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.className = 'fullscreen-btn';
            fullscreenBtn.title = 'View fullscreen';
            fullscreenBtn.innerHTML = '⛶';
            fullscreenBtn.addEventListener('click', () => this.showFullscreen(image.path, image.model));

            // Image element
            const img = document.createElement('img');
            img.className = 'card-image';
            img.src = image.path;
            img.onload = () => {
                console.log('[displayCards] Card', index, '- image loaded');
            };
            img.onerror = () => {
                console.error('[displayCards] Card', index, '- image failed to load');
                img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23f0f0f0" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" font-size="20" fill="%23999" text-anchor="middle" dy=".3em"%3EImage Not Found%3C/text%3E%3C/svg%3E';
            };

            imageWrapper.appendChild(img);
            imageWrapper.appendChild(fullscreenBtn);

            // Footer with criteria ratings
            const footer = document.createElement('div');
            footer.className = 'card-footer';
            console.log('[displayCards] Card', index, '- footer created');

            // Create rating set for each criterion
            console.log('[displayCards] Card', index, '- creating', this.criteria.length, 'criteria');
            this.criteria.forEach((criterion, cIdx) => {
                console.log('[displayCards] Card', index, '- creating criterion', cIdx, ':', criterion.key, '(type:', criterion.type, ')');
                
                const criterionDiv = document.createElement('div');
                criterionDiv.className = 'criterion-rating';
                criterionDiv.dataset.criterion = criterion.key;

                // Get translated label from i18n
                const labelKey = criterion.key === 'a' ? 'relevance' : 
                                criterion.key === 'b' ? 'real_like' : 
                                criterion.key === 'c' ? 'accuracy' : 'source_guess';
                const translatedLabel = i18n.t(`criteria.${labelKey}.label`);

                // Label
                const label = document.createElement('span');
                label.className = 'criterion-label';
                label.textContent = translatedLabel + ':';

                // Stars or Binary choice based on criterion type
                if (criterion.type === 'binary') {
                    // Binary choice: Real or AI Generated (radio buttons)
                    const binaryContainer = document.createElement('div');
                    binaryContainer.className = 'binary-choice';
                    binaryContainer.dataset.cardIndex = index;
                    binaryContainer.dataset.criterion = criterion.key;

                    const radioGroupId = `radio-${index}-${criterion.key}`;

                    // Real option
                    const realInput = document.createElement('input');
                    realInput.type = 'radio';
                    realInput.name = radioGroupId;
                    realInput.id = `${radioGroupId}-real`;
                    realInput.value = '1';
                    realInput.className = 'binary-radio';
                    realInput.dataset.rating = 1;  // 1 = Real
                    realInput.addEventListener('change', (e) => {
                        console.log('[displayCards] Card', index, 'Criterion', criterion.key, '- selected Real');
                        this.setRating(index, criterion.key, 1, e);
                    });

                    const realLabel = document.createElement('label');
                    realLabel.htmlFor = `${radioGroupId}-real`;
                    realLabel.className = 'binary-label';
                    realLabel.textContent = i18n.t('buttons.real');

                    // AI Generated option
                    const aiInput = document.createElement('input');
                    aiInput.type = 'radio';
                    aiInput.name = radioGroupId;
                    aiInput.id = `${radioGroupId}-ai`;
                    aiInput.value = '2';
                    aiInput.className = 'binary-radio';
                    aiInput.dataset.rating = 2;  // 2 = AI Generated
                    aiInput.addEventListener('change', (e) => {
                        console.log('[displayCards] Card', index, 'Criterion', criterion.key, '- selected AI Generated');
                        this.setRating(index, criterion.key, 2, e);
                    });

                    const aiLabel = document.createElement('label');
                    aiLabel.htmlFor = `${radioGroupId}-ai`;
                    aiLabel.className = 'binary-label';
                    aiLabel.textContent = i18n.t('buttons.aiGenerated');

                    binaryContainer.appendChild(realInput);
                    binaryContainer.appendChild(realLabel);
                    binaryContainer.appendChild(aiInput);
                    binaryContainer.appendChild(aiLabel);

                    criterionDiv.appendChild(label);
                    criterionDiv.appendChild(binaryContainer);
                } else {
                    // Stars (1-5 rating)
                    const stars = document.createElement('div');
                    stars.className = 'star-rating';
                    stars.dataset.cardIndex = index;
                    stars.dataset.criterion = criterion.key;

                    for (let i = 1; i <= 5; i++) {
                        const star = document.createElement('span');
                        star.className = 'star';
                        star.textContent = '★';
                        star.dataset.rating = i;

                        star.addEventListener('click', (e) => {
                            console.log('[displayCards] Card', index, 'Criterion', criterion.key, '- clicked, rating:', i);
                            this.setRating(index, criterion.key, i, e);
                        });
                        star.addEventListener('mouseenter', (e) => this.previewRating(index, criterion.key, i, e));
                        star.addEventListener('mouseleave', () => this.clearPreview(index, criterion.key));

                        stars.appendChild(star);
                    }

                    criterionDiv.appendChild(label);
                    criterionDiv.appendChild(stars);
                }

                footer.appendChild(criterionDiv);
                console.log('[displayCards] Card', index, '- criterion', criterion.label, 'added to footer');
            });

            card.appendChild(imageWrapper);
            card.appendChild(footer);
            container.appendChild(card);

            // Restore ratings if exist
            this.restoreRatings(index);
        });
        console.log('[displayCards] All', images.length, 'cards rendered');
    }

    async setRating(cardIndex, criterion, rating, event) {
        try {
            // Validate prerequisites
            if (!this.currentSampleId) {
                throw new Error('Current sample ID not set - cannot save rating');
            }
            if (!this.sessionId) {
                throw new Error('Session ID not initialized - cannot save rating');
            }

            const sampleId = this.currentSampleId;
            const ratingKey = `${sampleId}_${this.currentStage}_${cardIndex}${criterion}`;
            console.log('[setRating] Setting rating - Session:', this.sessionId, 'SampleID:', sampleId, 'Stage:', this.currentStage, 'CardIdx:', cardIndex, 'Criterion:', criterion, 'Rating:', rating);
            
            // Get metadata for this card
            const card = document.querySelector(`[data-image-id="${cardIndex}"]`);
            const imageModel = card ? card.dataset.model : null;
            
            // Update local cache with full data including image_model (for Results Popup fallback)
            this.ratings[ratingKey] = {
                rating: rating,
                image_model: imageModel  // ✓ Stores model for source guess evaluation fallback
            };
            
            // Determine caption model
            let captionModel = 'original';
            if (this.currentStage > 1) {
                const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
                captionModel = captionModels[this.currentStage - 2];
            }
            
            // Get image path and caption text
            const imgElement = card ? card.querySelector('.card-image') : null;
            const imagePath = imgElement ? imgElement.src : null;
            const captionText = document.getElementById('captionDisplay') ? document.getElementById('captionDisplay').textContent : null;
            
            // Save to backend API
            const payload = {
                session_id: this.sessionId,
                sample_id: sampleId,
                stage: this.currentStage,
                card_index: cardIndex,
                criterion: criterion,
                rating: rating,
                image_model: imageModel,
                caption_model: captionModel,
                image_path: imagePath,
                caption_text: captionText
            };
            
            console.log('[setRating] POST payload:', JSON.stringify(payload));
            
            const response = await fetch(`${this.apiBaseUrl}/ratings/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const responseData = await response.text();
            console.log('[setRating] Response status:', response.status, 'Body:', responseData);
            
            if (!response.ok) {
                throw new Error(`Failed to save rating to backend. Status: ${response.status}. Response: ${responseData}`);
            }
            
            console.log('[setRating] ✅ Rating successfully saved to backend');
        } catch (error) {
            console.error('[setRating] ❌ ERROR:', error.message);
            console.error('[setRating] Full error:', error);
            console.error('[setRating] Stack:', error.stack);
            
            // Show error to user
            const errorMsg = `⚠️ Failed to save your rating: ${error.message}`;
            console.warn(errorMsg);
            alert(errorMsg + '\n\nYour rating has been saved locally but may not appear in results. Please try refreshing the page.');
            
            // IMPORTANT: Still continue - local rating is saved
        }

        // Update star display (always do this)
        this.updateStarDisplay(cardIndex, criterion, rating);

        // Check if all cards and criteria are rated (always do this)
        this.checkAllRated();
        
        // Update debug panel
        this.updateDebugPanel();
    }

    updateStarDisplay(cardIndex, criterion, rating) {
        console.log('[updateStarDisplay] Updating display for card', cardIndex, 'criterion', criterion, 'to rating', rating);
        
        // Check if this is a binary criterion
        const criterionObj = this.criteria.find(c => c.key === criterion);
        
        if (criterionObj && criterionObj.type === 'binary') {
            // Binary choice display (radio buttons)
            const radioGroupId = `radio-${cardIndex}-${criterion}`;
            const radios = document.querySelectorAll(`input[name="${radioGroupId}"]`);
            
            if (radios.length === 0) {
                console.warn('[updateStarDisplay] Radio buttons not found for card', cardIndex, 'criterion', criterion);
                return;
            }

            radios.forEach((radio) => {
                if (parseInt(radio.value) === rating) {
                    radio.checked = true;
                } else {
                    radio.checked = false;
                }
            });
        } else {
            // Star rating display
            const selector = `[data-card-index="${cardIndex}"][data-criterion="${criterion}"] .star`;
            const starElements = document.querySelectorAll(selector);
            
            if (starElements.length === 0) {
                console.warn('[updateStarDisplay] Stars element not found for card', cardIndex, 'criterion', criterion);
                return;
            }

            starElements.forEach((star, index) => {
                if (index < rating) {
                    star.classList.add('active');
                } else {
                    star.classList.remove('active');
                }
            });
        }
    }

    async loadRatingsFromBackend() {
        if (!this.currentSampleId) {
            console.warn('[loadRatingsFromBackend] Current sample ID not set');
            return;
        }
        
        const sampleId = this.currentSampleId;
        try {
            console.log('[loadRatingsFromBackend] Loading ratings from API for sample', sampleId, 'stage', this.currentStage);
            const response = await fetch(
                `${this.apiBaseUrl}/ratings/session/${this.sessionId}/sample/${sampleId}/stage/${this.currentStage}`
            );
            
            if (!response.ok) {
                throw new Error(`Failed to load ratings: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('[loadRatingsFromBackend] Loaded', data.ratings.length, 'ratings from backend');
            
            // Update local cache with backend ratings
            data.ratings.forEach(rating => {
                const ratingKey = `${rating.sample_id}_${rating.stage}_${rating.card_index}${rating.criterion}`;
                this.ratings[ratingKey] = rating.rating;
            });
            
        } catch (error) {
            console.error('[loadRatingsFromBackend] Error:', error);
            // Continue anyway - empty ratings for this stage
        }
    }

    async updateSessionProgress() {
        try {
            console.log('[updateSessionProgress] Updating session progress - sample', this.currentSampleId, 'stage', this.currentStage, 'points', this.totalPoints);
            const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    last_sample_id: this.currentSampleId,
                    last_stage: this.currentStage,
                    total_points: this.totalPoints
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to update session: ${response.status}`);
            }
            
            console.log('[updateSessionProgress] Session progress saved');
        } catch (error) {
            console.error('[updateSessionProgress] Error:', error);
        }
    }

    restoreRatings(cardIndex) {
        const sample = this.getSampleById(this.currentSampleId);
        if (!sample) {
            console.warn('[restoreRatings] Current sample not found');
            return;
        }
        
        const sampleId = sample.id;
        
        for (const criterion of this.criteria) {
            const ratingKey = `${sampleId}_${this.currentStage}_${cardIndex}${criterion.key}`;
            const ratingData = this.ratings[ratingKey];
            
            if (ratingData) {
                // Extract rating value from object structure
                const ratingValue = typeof ratingData === 'object' ? ratingData.rating : ratingData;
                this.updateStarDisplay(cardIndex, criterion.key, ratingValue);
            }
        }
    }

    previewRating(cardIndex, criterion, rating, event) {
        // Skip preview for binary criteria
        const criterionObj = this.criteria.find(c => c.key === criterion);
        if (criterionObj && criterionObj.type === 'binary') {
            return;
        }

        console.log('[previewRating] Previewing rating for card', cardIndex, 'criterion', criterion, 'to', rating);
        
        const selector = `[data-card-index="${cardIndex}"][data-criterion="${criterion}"] .star`;
        const starElements = document.querySelectorAll(selector);
        
        if (starElements.length === 0) {
            console.warn('[previewRating] Stars element not found for card', cardIndex, 'criterion', criterion);
            return;
        }

        starElements.forEach((star, index) => {
            if (index < rating) {
                star.classList.add('hover');
            } else {
                star.classList.remove('hover');
            }
        });
    }

    clearPreview(cardIndex, criterion) {
        // Skip for binary criteria
        const criterionObj = this.criteria.find(c => c.key === criterion);
        if (criterionObj && criterionObj.type === 'binary') {
            return;
        }

        console.log('[clearPreview] Clearing preview for card', cardIndex, 'criterion', criterion);
        
        const selector = `[data-card-index="${cardIndex}"][data-criterion="${criterion}"] .star`;
        const starElements = document.querySelectorAll(selector);
        
        starElements.forEach(star => star.classList.remove('hover'));
    }

    checkAllRated() {
        if (!this.currentSampleId) {
            console.warn('[checkAllRated] Current sample ID not set');
            return false;
        }
        
        const sampleId = this.currentSampleId;
        const container = document.getElementById('cardsContainer');
        const cards = container.querySelectorAll('.image-card');
        const cardCount = cards.length;
        const criteriaCount = this.criteria.length;
        
        console.log(`[checkAllRated] Checking - Sample: ${sampleId}, Stage: ${this.currentStage}, Cards: ${cardCount}, Criteria: ${criteriaCount}`);

        let fullyRatedCards = 0;
        
        for (let i = 0; i < cardCount; i++) {
            let cardComplete = true;
            
            for (const criterion of this.criteria) {
                const ratingKey = `${sampleId}_${this.currentStage}_${i}${criterion.key}`;
                if (!this.ratings[ratingKey]) {
                    cardComplete = false;
                    console.log(`[checkAllRated] Card ${i} missing rating for criterion '${criterion.key}'`);
                    break;
                }
            }
            
            if (cardComplete) {
                fullyRatedCards++;
            }
        }

        console.log(`[checkAllRated] Summary - Fully rated cards: ${fullyRatedCards}/${cardCount}`);
        
        // Enable next button only if ALL cards have ALL criteria rated
        if (fullyRatedCards === cardCount && cardCount > 0) {
            document.getElementById('nextBtn').disabled = false;
            document.getElementById('nextBtn').title = '';
        } else {
            document.getElementById('nextBtn').disabled = true;
            document.getElementById('nextBtn').title = i18n.t('buttons.nextTooltip');
        }
    }

    async handleNextCaption() {
        if (this.currentStage < 6) {
            // Calculate and store best image for THIS stage before moving to next
            if (this.currentStage >= 1 && this.currentStage <= 5) {
                await this.calculateAndStoreBestImageForStage();
            }
            
            // Continue to next stage within same ID (stages 1-6)
            this.currentStage++;
            await this.displaySample();
        } else if (this.currentStage === 6) {
            // Save finalist selection before moving to next ID
            if (this.selectedFinalistCard && this.selectedFinalistSample) {
                try {
                    const response = await fetch(`${this.apiBaseUrl}/finalists/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: this.sessionId,
                            sample_id: this.selectedFinalistSample.id,
                            selected_card_index: this.selectedFinalistCard.card_index,
                            selected_stage: this.selectedFinalistCard.stage,
                            image_model: this.selectedFinalistCard.model,                    // NEW: metadata
                            caption_model: this.selectedFinalistCard.caption_model,          // NEW: metadata
                            image_path: this.selectedFinalistCard.path,                      // NEW: metadata
                            caption_text: this.selectedFinalistCard.caption                  // NEW: metadata
                        })
                    });

                    if (response.ok) {
                        // Finalist selection saved
                    } else {
                        console.error('[handleNextCaption] Failed to save finalist selection:', response.status);
                    }
                } catch (error) {
                    console.error('[handleNextCaption] Error saving finalist:', error);
                }
            }

            // Show results directly (no confirmation modal)
            await this.displayFeedbackResults();
        }
    }

    async calculateAndStoreBestImageForStage() {
        /**
         * Calculate which image has highest average rating for current stage
         * Store the actual image object (not just index) for later retrieval
         * ALSO save to database for persistence across sessions
         */
        const sample = this.getSampleById(this.currentSampleId);
        if (!sample) {
            console.warn('[calculateAndStoreBestImageForStage] Current sample not found');
            return;
        }
        
        const stage = this.currentStage;
        const sampleId = sample.id;
        
        // Get all ratings for this stage from memory
        const stageRatings = {};  // { cardIndex: { a: [ratings], b: [ratings], c: [ratings] } }
        
        for (const [cardKey, cardData] of Object.entries(this.ratings)) {
            // Parse key format: {sampleId}_{stage}_{cardIndex}{criteria}
            const parts = cardKey.split('_');
            const ratings_stage = parseInt(parts[1]);
            const cardInfo = parts[2];
            const card_index = parseInt(cardInfo[0]);
            const criteria = cardInfo[1];
            
            if (ratings_stage === stage) {
                if (!stageRatings[card_index]) {
                    stageRatings[card_index] = { a: [], b: [], c: [] };
                }
                
                // Skip source guess criterion (d)
                if (criteria !== 'd') {
                    // Extract rating value from object structure
                    const ratingValue = typeof cardData === 'object' ? cardData.rating : cardData;
                    stageRatings[card_index][criteria].push(ratingValue);
                }
            }
        }
        
        if (Object.keys(stageRatings).length === 0) {
            console.warn(`[calculateAndStoreBestImageForStage] No ratings found for stage ${stage}`);
            return;
        }
        
        // Find card with highest average rating
        let bestCardIndex = 0;
        let bestAvgRating = 0;
        
        for (const [cardIndex, criteriaData] of Object.entries(stageRatings)) {
            // Calculate average for each criterion
            const avgA = criteriaData.a.length > 0 ? criteriaData.a.reduce((a, b) => a + b, 0) / criteriaData.a.length : 0;
            const avgB = criteriaData.b.length > 0 ? criteriaData.b.reduce((a, b) => a + b, 0) / criteriaData.b.length : 0;
            const avgC = criteriaData.c.length > 0 ? criteriaData.c.reduce((a, b) => a + b, 0) / criteriaData.c.length : 0;
            
            // Average the three criteria
            const avg = (avgA + avgB + avgC) / 3;
            
            if (avg > bestAvgRating) {
                bestAvgRating = avg;
                bestCardIndex = parseInt(cardIndex);
            }
        }
        
        // Get the actual image object for this card
        let images = [];
        let caption = '';
        
        if (stage === 1) {
            images = this.getImagesForPipeline1(sample);
            caption = this.getTranslatedCaption(sample, sample.caption);
        } else {
            const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
            const modelName = captionModels[stage - 2];
            images = this.getImagesForCaptionModel(sample, modelName);
            const captionModelData = this.getCaptionModelData(sample, modelName);
            caption = captionModelData ? this.getTranslatedCaption(captionModelData, captionModelData.generated_caption) : 'Caption not available';
        }
        
        if (bestCardIndex >= 0 && bestCardIndex < images.length) {
            const imageObj = images[bestCardIndex];
            
            // Initialize cache for this sample if needed
            if (!this.stageBestImages[sampleId]) {
                this.stageBestImages[sampleId] = {};
            }
            
            // Store the complete image object with metadata
            this.stageBestImages[sampleId][stage] = {
                stage: stage,
                card_index: bestCardIndex,
                average_rating: bestAvgRating,
                image: imageObj,
                caption: caption,
                model: imageObj.model,
                path: imageObj.path
            };
            
            // Get caption model for this stage
            let captionModel = 'original';
            if (stage > 1) {
                const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
                captionModel = captionModels[stage - 2];
            }
            
            // Save to database for persistence across sessions with metadata
            await this.saveStageBestImageToDB(sampleId, stage, bestCardIndex, bestAvgRating, imageObj.model, captionModel, imageObj.path, caption);
        } else {
            console.warn(`[calculateAndStoreBestImageForStage] Invalid card index ${bestCardIndex} (${images.length} images)`);
        }
    }

    async saveStageBestImageToDB(sampleId, stage, bestCardIndex, averageRating, imageModel, captionModel, imagePath, captionText) {
        /**
         * Save stage best image to database for persistence
         */
        try {
            const response = await fetch(`${this.apiBaseUrl}/finalists/stage-best-images/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    sample_id: sampleId,
                    stage: stage,
                    best_card_index: bestCardIndex,
                    average_rating: averageRating,
                    image_model: imageModel,          // NEW: which image generation model
                    caption_model: captionModel,      // NEW: which caption model
                    image_path: imagePath,            // NEW: path to the image
                    caption_text: captionText         // NEW: the caption text used
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                console.error(`[saveStageBestImageToDB] Failed stage ${stage}: ${response.status}`, error);
            }
        } catch (error) {
            console.error(`[saveStageBestImageToDB] Exception:`, error);
        }
    }

    async loadStoredStageBestImages(sampleId) {
        /**
         * Load previously stored best images for all stages from database
         * Uses stored metadata directly (image_path, caption_text) to avoid recalculation
         * Falls back to card_index reconstruction only for backward compatibility
         */
        try {
            console.log(`[loadStoredStageBestImages] Loading stored best images for sample ${sampleId}`);
            
            const response = await fetch(`${this.apiBaseUrl}/finalists/stage-best-images/${this.sessionId}/${sampleId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const bestImages = data.best_images || [];
                
                console.log(`[loadStoredStageBestImages] Retrieved ${bestImages.length} stored best images`);
                
                // Initialize cache for this sample
                if (!this.stageBestImages[sampleId]) {
                    this.stageBestImages[sampleId] = {};
                }
                
                // For each stored best image, use metadata directly if available
                for (const stored of bestImages) {
                    const stage = stored.stage;
                    
                    // If metadata was stored, use it directly (no recalculation needed!)
                    if (stored.image_model && stored.image_path && stored.caption_text) {
                        console.log(`[loadStoredStageBestImages] Using stored metadata for stage ${stage}`);
                        this.stageBestImages[sampleId][stage] = {
                            stage: stage,
                            card_index: stored.best_card_index,
                            average_rating: stored.average_rating,
                            image: { model: stored.image_model, path: stored.image_path },
                            caption: stored.caption_text,
                            model: stored.image_model,
                            path: stored.image_path
                        };
                        console.log(`[loadStoredStageBestImages] Loaded stage ${stage} best image:`, this.stageBestImages[sampleId][stage]);
                        continue;
                    }
                    
                    // Fallback: reconstruct from card_index (for old data without metadata)
                    console.log(`[loadStoredStageBestImages] No stored metadata for stage ${stage}, reconstructing...`);
                    let images = [];
                    let caption = '';
                    let model = '';
                    
                    const sample = this.metadata.find(s => s.id === sampleId);
                    if (!sample) continue;
                    
                    if (stage === 1) {
                        images = this.getImagesForPipeline1(sample);
                        caption = this.getTranslatedCaption(sample, sample.caption);
                    } else {
                        const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
                        const modelName = captionModels[stage - 2];
                        images = this.getImagesForCaptionModel(sample, modelName);
                        const captionModelData = this.getCaptionModelData(sample, modelName);
                        caption = captionModelData ? this.getTranslatedCaption(captionModelData, captionModelData.generated_caption) : 'Caption not available';
                        model = modelName;
                    }
                    
                    // Retrieve the image object
                    if (stored.best_card_index >= 0 && stored.best_card_index < images.length) {
                        const imageObj = images[stored.best_card_index];
                        
                        // Store the complete image data
                        this.stageBestImages[sampleId][stage] = {
                            stage: stage,
                            card_index: stored.best_card_index,
                            average_rating: stored.average_rating,
                            image: imageObj,
                            caption: caption,
                            model: imageObj.model,
                            path: imageObj.path
                        };
                        
                        console.log(`[loadStoredStageBestImages] Loaded stage ${stage} best image:`, this.stageBestImages[sampleId][stage]);
                    }
                }
            } else {
                console.log(`[loadStoredStageBestImages] No stored best images found for this sample (status: ${response.status})`);
            }
        } catch (error) {
            console.warn(`[loadStoredStageBestImages] Error loading stored best images:`, error);
            // This is not critical - user can still continue
        }
    }

    showFeedbackModal() {
        const modal = document.getElementById('feedbackModal');
        const feedbackYes = document.getElementById('feedbackYes');
        const feedbackNo = document.getElementById('feedbackNo');

        // Update text
        document.getElementById('feedbackTitle').textContent = i18n.t('survey.feedbackTitle');
        document.getElementById('feedbackQuestion').textContent = i18n.t('survey.feedbackQuestion');
        feedbackYes.textContent = i18n.t('survey.feedbackYes');
        feedbackNo.textContent = i18n.t('survey.feedbackNo');

        // Clear previous listeners
        const newFeedbackYes = feedbackYes.cloneNode(true);
        const newFeedbackNo = feedbackNo.cloneNode(true);
        feedbackYes.parentNode.replaceChild(newFeedbackYes, feedbackYes);
        feedbackNo.parentNode.replaceChild(newFeedbackNo, feedbackNo);

        // Add new listeners
        document.getElementById('feedbackYes').addEventListener('click', async () => {
            console.log('[showFeedbackModal] User clicked Yes');
            modal.classList.add('hidden');
            await this.displayFeedbackResults();
        });

        document.getElementById('feedbackNo').addEventListener('click', () => {
            console.log('[showFeedbackModal] User clicked No');
            modal.classList.add('hidden');
            this.proceedToNextArticle();
        });

        modal.classList.remove('hidden');
    }

    async displayFeedbackResults() {
        if (!this.currentSampleId) {
            console.warn('[displayFeedbackResults] Current sample ID not set');
            return;
        }
        
        console.log('[displayFeedbackResults] Building feedback results for article', this.currentSampleId);
        
        const currentArticle = this.getSampleById(this.currentSampleId);
        if (!currentArticle) {
            console.error('[displayFeedbackResults] Sample not found');
            return;
        }
        
        const resultsModal = document.getElementById('resultsModal');
        const resultsGridContainer = document.getElementById('resultsGridContainer');
        
        // Clear previous results
        resultsGridContainer.innerHTML = '';

        // Evaluate all source guesses for this article (fetches from database)
        const results = await this.evaluateSourceGuessesWithDatabaseFetch(currentArticle);
        
        // Create feedback cards for each stage
        for (let stage = 1; stage <= 5; stage++) {
            const stageResults = results.byStage[stage];
            if (!stageResults || stageResults.images.length === 0) continue;

            for (let cardIdx = 0; cardIdx < stageResults.images.length; cardIdx++) {
                const imageData = stageResults.images[cardIdx];
                if (!imageData) continue;

                const card = document.createElement('div');
                card.className = 'feedback-card';

                // Create image
                const img = document.createElement('img');
                img.className = 'feedback-card-image';
                img.src = imageData.path;
                img.onerror = () => {
                    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E';
                };
                card.appendChild(img);

                // Create overlay with checkmark or X
                const overlay = document.createElement('div');
                overlay.className = `feedback-overlay ${imageData.isCorrect ? 'correct' : 'incorrect'}`;
                overlay.textContent = imageData.isCorrect ? '✓' : '✗';
                card.appendChild(overlay);

                // Create label showing user's answer and the actual answer
                const label = document.createElement('div');
                label.className = 'feedback-card-label';
                
                // Normalize the displayed values (in case numeric indices are stored)
                const displayUserGuess = this.normalizeSourceGuessDisplay(imageData.userGuess);
                const displayCorrectAnswer = imageData.correctAnswer;
                
                label.innerHTML = `<strong>Your guess:</strong> ${displayUserGuess}<br/><strong>Correct:</strong> ${displayCorrectAnswer}`;
                card.appendChild(label);

                resultsGridContainer.appendChild(card);
            }
        }

        // Update score
        const scoreText = i18n.t('survey.resultsScore');
        const formattedScore = scoreText
            .replace('{{correct}}', results.correctCount)
            .replace('{{total}}', results.totalCount);
        
        document.getElementById('resultsTitle').textContent = i18n.t('survey.resultsTitle');
        document.getElementById('resultsScore').textContent = formattedScore;
        
        // Show points earned
        const pointsText = i18n.t('survey.pointsEarned')
            .replace('{{points}}', results.points)
            .replace('{{plural}}', results.points === 1 ? '' : 's');
        
        // Create points display element
        const pointsElement = document.createElement('div');
        pointsElement.style.cssText = 'text-align: center; font-size: 18px; font-weight: bold; color: #4CAF50; margin-top: 15px; padding: 10px; background-color: #f0f8f0; border-radius: 8px;';
        pointsElement.textContent = pointsText;
        document.getElementById('resultsScore').parentNode.appendChild(pointsElement);
        
        // Add points to total (badge display will update on button click)
        this.totalPoints += results.points;
        console.log('[displayFeedbackResults] Total points updated:', this.totalPoints, 'from earning', results.points);
        
        document.getElementById('resultsContinue').textContent = i18n.t('survey.resultsContinue');

        // Add continue button listener
        const continueBtn = document.getElementById('resultsContinue');
        const newContinueBtn = continueBtn.cloneNode(true);
        continueBtn.parentNode.replaceChild(newContinueBtn, continueBtn);

        document.getElementById('resultsContinue').addEventListener('click', async () => {
            console.log('[displayFeedbackResults] User clicked Continue, saving points...');
            
            // Trigger both animations on advance: floating points + badge level-up
            this.animatePointsFloating(results.points);
            this.updateBadgeDisplay();  // This detects level-up and plays animation
            
            // Save points to backend
            await this.updateSessionProgress();
            
            resultsModal.classList.add('hidden');
            this.proceedToNextArticle();
        });

        resultsModal.classList.remove('hidden');
    }

    evaluateSourceGuesses(article) {
        console.log('[evaluateSourceGuesses] Evaluating source guesses for article', article.id);
        
        const results = {
            correctCount: 0,
            totalCount: 0,
            byStage: {}
        };

        // Process each stage (1-5)
        for (let stage = 1; stage <= 5; stage++) {
            results.byStage[stage] = { images: [] };
            
            // Get images for this stage (same logic as displaySample)
            let imagePaths = [];
            
            if (stage === 1) {
                // Pipeline 1: Original image + 6 generated images
                imagePaths = this.getImagePathsForFeedback(article, 1);
            } else {
                // Pipelines 2-5: 6 images from different caption models
                imagePaths = this.getImagePathsForFeedback(article, stage);
            }
            
            if (!imagePaths || imagePaths.length === 0) {
                console.log(`[evaluateSourceGuesses] No images found for stage ${stage}`);
                continue;
            }

            for (let cardIdx = 0; cardIdx < imagePaths.length; cardIdx++) {
                const imagePath = imagePaths[cardIdx];
                if (!imagePath) continue;
                
                // Get user's source guess rating for this card
                const ratingKey = `${article.id}_${stage}_${cardIdx}d`;
                let userGuess = this.ratings[ratingKey];
                
                if (!userGuess) {
                    console.log(`[evaluateSourceGuesses] No rating found for ${ratingKey}`);
                    continue;
                }

                // Normalize the user guess
                userGuess = this.normalizeSourceGuessDisplay(userGuess);

                // Determine correct answer
                // Original image (first one in stage 1) = Real
                // All others = AI Generated
                const isOriginal = (stage === 1 && cardIdx === 0);
                const correctAnswer = isOriginal ? 'Real' : 'AI Generated';
                
                // Check if user is correct
                const isCorrect = userGuess === correctAnswer;
                
                results.totalCount++;
                if (isCorrect) results.correctCount++;

                results.byStage[stage].images.push({
                    path: imagePath,
                    userGuess: userGuess,
                    correctAnswer: correctAnswer,
                    isCorrect: isCorrect
                });

                console.log(`[evaluateSourceGuesses] Stage ${stage}, Card ${cardIdx}: User=${userGuess}, Correct=${correctAnswer}, IsCorrect=${isCorrect}`);
            }
        }

        console.log('[evaluateSourceGuesses] Total: ', results.correctCount, '/', results.totalCount);
        return results;
    }

    async fetchRatingsFromDatabase(sampleId) {
        /**
         * Fetch criterion 'd' (source guess) ratings from the database.
         * Each rating includes image_model which tells us the truth:
         * image_model='original' means Real, anything else means AI Generated
         */
        console.log('[fetchRatingsFromDatabase] Fetching source guess (d) ratings for sample', sampleId);
        const ratingsMap = {};
        
        try {
            // Fetch ratings for each stage (1-5)
            for (let stage = 1; stage <= 5; stage++) {
                const response = await fetch(
                    `${this.apiBaseUrl}/ratings/session/${this.sessionId}/sample/${sampleId}/stage/${stage}`,
                    {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' }
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    const ratings = data.ratings || [];
                    console.log(`[fetchRatingsFromDatabase] Stage ${stage}: Received ${ratings.length} rows total`);

                    // Filter to only criterion 'd' (source guess) ratings
                    for (const rating of ratings) {
                        if (rating.criterion === 'd') {
                            const ratingKey = `${sampleId}_${stage}_${rating.card_index}d`;
                            ratingsMap[ratingKey] = {
                                rating: rating.rating,          // 1=Real, 2=AI
                                image_model: rating.image_model // original or model name
                            };
                            console.log(`[fetchRatingsFromDatabase] ✓ Stored criterion 'd': ${ratingKey} = Rating:${rating.rating}, Model:${rating.image_model}`);
                        }
                    }
                } else {
                    console.warn(`[fetchRatingsFromDatabase] Status ${response.status} for stage ${stage}`);
                }
            }
        } catch (error) {
            console.error('[fetchRatingsFromDatabase] Error fetching ratings:', error);
        }

        console.log('[fetchRatingsFromDatabase] Total stored:', Object.keys(ratingsMap).length, 'keys');
        return ratingsMap;
    }

    async evaluateSourceGuessesWithDatabaseFetch(article) {
        /**
         * Evaluate source guesses using ratings fetched from the database.
         * Criterion 'd' rating's image_model field tells us the truth:
         * - image_model='original' = Real image
         * - image_model=anything else = AI Generated image
         */
        console.log('[evaluateSourceGuessesWithDatabaseFetch] Evaluating source guesses for article', article.id);
        
        // Fetch ratings from database
        const dbRatings = await this.fetchRatingsFromDatabase(article.id);
        console.log('[evaluateSourceGuessesWithDatabaseFetch] Fetched ratings:', dbRatings);
        
        const results = {
            correctCount: 0,
            totalCount: 0,
            byStage: {}
        };

        // Process each stage (1-5)
        for (let stage = 1; stage <= 5; stage++) {
            results.byStage[stage] = { images: [] };
            
            // Get image paths for feedback display
            let imagePaths = [];
            if (stage === 1) {
                imagePaths = this.getImagePathsForFeedback(article, 1);
            } else {
                imagePaths = this.getImagePathsForFeedback(article, stage);
            }
            
            if (!imagePaths || imagePaths.length === 0) {
                console.log(`[evaluateSourceGuessesWithDatabaseFetch] No images found for stage ${stage}`);
                continue;
            }

            // For each card in this stage
            for (let cardIdx = 0; cardIdx < imagePaths.length; cardIdx++) {
                const imagePath = imagePaths[cardIdx];
                if (!imagePath) continue;
                
                // Get the criterion 'd' (source guess) rating for this card
                const ratingKey = `${article.id}_${stage}_${cardIdx}d`;
                const ratingData = dbRatings[ratingKey];
                
                if (!ratingData) {
                    console.log(`[evaluateSourceGuessesWithDatabaseFetch] No criterion 'd' rating found for ${ratingKey}`);
                    continue;
                }

                // Extract user's guess and the truth from the rating
                const userRatingValue = typeof ratingData === 'object' ? ratingData.rating : ratingData;
                const imageModel = typeof ratingData === 'object' ? ratingData.image_model : null;
                
                console.log(`[evaluateSourceGuessesWithDatabaseFetch] DEBUG Stage ${stage}, Card ${cardIdx}:`, {
                    ratingKey,
                    userRatingValue,
                    imageModel,
                    ratingData
                });
                
                // Convert user's numeric rating (1 or 2) to text
                const userGuess = userRatingValue === 1 ? 'Real' : (userRatingValue === 2 ? 'AI Generated' : 'Unknown');
                
                // Determine truth based on image_model
                const truthIsReal = (imageModel === 'original');
                const correctAnswer = truthIsReal ? 'Real' : 'AI Generated';
                
                // Compare user guess with truth
                const isCorrect = (userGuess === correctAnswer);
                
                results.totalCount++;
                if (isCorrect) results.correctCount++;

                results.byStage[stage].images.push({
                    path: imagePath,
                    userGuess: userGuess,
                    correctAnswer: correctAnswer,
                    isCorrect: isCorrect
                });

                console.log(`[evaluateSourceGuessesWithDatabaseFetch] ✓ Stage ${stage}, Card ${cardIdx}: User guessed='${userGuess}', Truth='${correctAnswer}', Result=${isCorrect ? 'CORRECT' : 'WRONG'}`);
            }
        }

        console.log('[evaluateSourceGuessesWithDatabaseFetch] Total correct: ', results.correctCount, '/', results.totalCount);
        
        // Points earned = number of correct source guesses
        results.points = results.correctCount;
        console.log('[evaluateSourceGuessesWithDatabaseFetch] Total points earned:', results.points);
        
        return results;
    }

    getImagePathsForFeedback(sample, stage) {
        // Get image paths for feedback display using deterministic (seeded) randomization
        // This ensures the same order as the rating display
        const images = this.getImagesForStageDeterministic(sample, stage);
        // Ensure paths are properly converted
        return images.map(img => {
            const convertedPath = typeof img.path === 'string' && img.path.startsWith('sample_100') 
                ? `./${img.path}` 
                : img.path;
            console.log('[getImagePathsForFeedback] Image path:', convertedPath);
            return convertedPath;
        });
    }

    normalizeSourceGuessDisplay(value) {
        // Map numeric stored values to user-friendly display
        // Radio button encoding: 1 = Real, 2 = AI Generated
        if (value === 'Real' || value === 'AI Generated') {
            return value;
        }
        // Convert numeric values
        if (value === '1' || value === 1) return 'Real';
        if (value === '2' || value === 2) return 'AI Generated';
        // Return as-is if we can't map it
        return value;
    }

    async proceedToNextArticle() {
        console.log('[proceedToNextArticle] Moving to next article');
        
        // Add current sample to completed list
        if (this.currentSampleId && !this.completedSampleIds.includes(this.currentSampleId)) {
            this.completedSampleIds.push(this.currentSampleId);
            console.log('[proceedToNextArticle] Added sample', this.currentSampleId, 'to completed list. Total completed:', this.completedSampleIds.length);
        }
        
        // Reset to Stage 1 for the next article
        this.currentStage = 1;
        this.currentSampleId = null;  // Clear to trigger intelligent selection for next article
        
        // Reset finalist selection
        this.selectedFinalistCard = null;
        this.selectedFinalistSample = null;

        console.log('[proceedToNextArticle] Fetching next article...');
        await this.displaySample();
    }

    async displayFinalization(sample) {
        console.log('[displayFinalization] Starting finalization display');

        // Update session progress on backend
        await this.updateSessionProgress();

        // Update progress
        document.getElementById('stageProgress').textContent = '6';
        document.getElementById('stageLabel').textContent = i18n.t('survey.finalization');
        document.getElementById('currentSample').textContent = this.currentSampleIndex + 1;
        const progress = ((this.currentSampleIndex + 1) / this.metadata.length) * 100;
        document.getElementById('progressFill').style.width = progress + '%';

        // Hide caption display for finalization
        document.getElementById('captionTypeLabel').style.display = 'none';
        document.getElementById('captionDisplay').style.display = 'none';

        // Hide main instruction banner for finalization (stage 1-5 banner)
        document.getElementById('mainInstructionBanner').style.display = 'none';

        // Load article and summary (for side panel only)
        const articleText = await this.loadArticle(sample);
        const summaryText = await this.loadSummary(sample);
        this.currentArticle = articleText;
        this.currentSummary = summaryText;

        // Fetch best images from each stage
        const bestImages = await this.fetchBestImages(sample.id);
        
        if (bestImages.length === 0) {
            console.warn('[displayFinalization] No best images to display');
            return;
        }

        // Display finalist cards (without rating elements)
        this.displayFinalistCards(bestImages, sample);

        // Update finalization instruction banner
        this.updateFinalizationInstructionBanner();

        // Store sample for later use when saving
        this.selectedFinalistSample = sample;

        // Disable next button until a finalist is selected
        this.selectedFinalistCard = null;
        document.getElementById('nextBtn').disabled = true;
        document.getElementById('nextBtn').title = i18n.t('survey.selectFinalistMessage') || 'Please select a finalist image';
    }

    async fetchBestImages(sampleId) {
        /**
         * Fetch best images for this sample.
         * For Stage 6 (finalization): Always fetch from database to guarantee all 5 stages
         * Otherwise: Check memory cache first, then fall back to API
         */
        const sample = this.metadata[this.currentSampleIndex];
        
        // For finalization (Stage 6), ALWAYS fetch from database to ensure all 5 stages
        // Memory cache might be incomplete after page reloads that resume mid-article
        if (this.currentStage === 6) {
            console.log('[fetchBestImages] Stage 6 (Finalization): Fetching all 5 stages from database');
            return await this.fetchBestImagesFromDatabase(sampleId);
        }
        
        // Check if we have pre-calculated best images in memory
        if (this.stageBestImages[sampleId]) {
            console.log('[fetchBestImages] Using pre-calculated best images from memory');
            const bestImageList = [];
            
            for (let stage = 1; stage <= 5; stage++) {
                if (this.stageBestImages[sampleId][stage]) {
                    const stored = this.stageBestImages[sampleId][stage];
                    bestImageList.push({
                        stage: stored.stage,
                        card_index: stored.card_index,
                        average_rating: stored.average_rating,
                        image: stored.image,
                        caption: stored.caption,
                        model: stored.model,
                        path: stored.path
                    });
                }
            }
            
            if (bestImageList.length > 0) {
                console.log('[fetchBestImages] Returning', bestImageList.length, 'stored best images');
                return bestImageList;
            }
        }
        
        // Fallback: fetch from API (for backward compatibility or if no ratings exist)
        return await this.fetchBestImagesFromDatabase(sampleId);
    }

    async fetchBestImagesFromDatabase(sampleId) {
        /**
         * Fetch best images by calculating from actual ratings in database.
         * This queries all ratings and finds the highest-rated image for each stage.
         * Used for Stage 6 finalization to display the TRUE best images.
         */
        try {
            console.log('[fetchBestImagesFromDatabase] Calculating best images from actual ratings');
            // Use /best-images/ endpoint which calculates from ratings table (not pre-stored indices)
            const response = await fetch(`${this.apiBaseUrl}/finalists/best-images/${this.sessionId}/${sampleId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                const bestImages = data.best_images || [];
                console.log('[fetchBestImagesFromDatabase] Retrieved', bestImages.length, 'best images calculated from ratings');
                
                // Map backend response to frontend format
                const result = bestImages.map(bi => {
                    console.log(`[fetchBestImagesFromDatabase] Stage ${bi.stage}: card index ${bi.card_index}, avg rating ${bi.average_rating}, model: ${bi.image_model}`);
                    return {
                        stage: bi.stage,
                        card_index: bi.card_index,
                        average_rating: bi.average_rating,
                        image: { model: bi.image_model, path: bi.image_path },
                        caption: bi.caption_text,
                        model: bi.image_model,
                        caption_model: bi.caption_model,
                        path: bi.image_path
                    };
                });
                
                console.log('[fetchBestImagesFromDatabase] Returning', result.length, 'best images (sorted by stage)');
                return result;
            } else {
                console.error('[fetchBestImagesFromDatabase] Error fetching best images:', response.status);
                return [];
            }
        } catch (error) {
            console.error('[fetchBestImagesFromDatabase] Error:', error);
            return [];
        }
    }

    displayFinalistCards(bestImages, sample) {
        console.log('[displayFinalistCards] Displaying', bestImages.length, 'finalist cards');
        const container = document.getElementById('cardsContainer');
        container.innerHTML = '';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(250px, 1fr))';
        container.style.gap = '20px';

        bestImages.forEach((bestImage, index) => {
            /**
             * Use stored image data directly - no shuffling complexity
             * bestImage already contains: image object, caption, stage, card_index, average_rating
             */
            let displayPath = bestImage.path || (bestImage.image && bestImage.image.path);
            let displayCaption = bestImage.caption || '';
            
            if (!displayPath) {
                console.warn('[displayFinalistCards] No image path for finalist:', bestImage);
                return;
            }
            
            const card = document.createElement('div');
            card.className = 'finalist-card';
            card.style.cursor = 'pointer';
            card.style.border = '2px solid #ccc';
            card.style.padding = '15px';
            card.style.borderRadius = '8px';
            card.style.transition = 'all 0.3s ease';
            card.dataset.finalistStage = bestImage.stage;
            card.dataset.finalistCardIndex = bestImage.card_index;

            const img = document.createElement('img');
            img.src = displayPath;
            img.style.width = '100%';
            img.style.borderRadius = '6px';
            img.style.marginBottom = '10px';

            const captionElement = document.createElement('p');
            captionElement.textContent = displayCaption;
            captionElement.style.fontSize = '12px';
            captionElement.style.color = '#666';
            captionElement.style.margin = '5px 0';
            captionElement.style.lineHeight = '1.4';
            captionElement.style.minHeight = '60px';

            card.appendChild(img);
            card.appendChild(captionElement);

            // Click handler for selection (just select, don't navigate)
            card.addEventListener('click', () => {
                console.log('[displayFinalistCards] Card clicked - selecting finalist', bestImage);
                // Deselect all cards
                document.querySelectorAll('.finalist-card').forEach(c => {
                    c.style.border = '2px solid #ccc';
                    c.style.boxShadow = 'none';
                });
                // Select this card
                card.style.border = '3px solid #27ae60';
                card.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.4)';
                // Store selection
                this.selectedFinalistCard = bestImage;
                // Enable Next button now that a finalist is selected
                document.getElementById('nextBtn').disabled = false;
                document.getElementById('nextBtn').title = '';
                console.log('[displayFinalistCards] Finalist selected - Next button enabled');
            });

            // Hover effect
            card.addEventListener('mouseover', () => {
                if (this.selectedFinalistCard?.stage !== bestImage.stage || this.selectedFinalistCard?.card_index !== bestImage.card_index) {
                    card.style.border = '2px solid #3498db';
                    card.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.3)';
                }
            });

            card.addEventListener('mouseout', () => {
                if (this.selectedFinalistCard?.stage !== bestImage.stage || this.selectedFinalistCard?.card_index !== bestImage.card_index) {
                    card.style.border = '2px solid #ccc';
                    card.style.boxShadow = 'none';
                }
            });

            container.appendChild(card);
        });
    }

    updateFinalizationInstructionBanner() {
        const banner = document.getElementById('finalizationInstructionBanner');
        banner.textContent = i18n.t('survey.finalizationInstructions');
        banner.style.display = 'block';
        console.log('[updateFinalizationInstructionBanner] Showing finalization instruction banner');
    }

    getImagesForStage(sample, stage) {
        // Reuse existing logic to get images for a specific stage
        if (stage === 1) {
            return this.getImagesForPipeline1(sample);
        } else {
            const stageIndex = stage - 2;
            const captionModelName = this.captionModelQueue[stageIndex];
            return this.getImagesForCaptionModel(sample, captionModelName);
        }
    }

    getImagesForStageUnrandomized(sample, stage) {
        // Returns images WITHOUT randomization (original method kept for reference)
        if (stage === 1) {
            return this.getImagesForPipeline1Unrandomized(sample);
        } else {
            const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
            const modelName = captionModels[stage - 2];
            return this.getImagesForCaptionModelUnrandomized(sample, modelName);
        }
    }

    getImagesForStageDeterministic(sample, stage) {
        // Returns images WITH seeded randomization (consistent across sessions)
        // This is used for finalization to match the order from stage display
        if (stage === 1) {
            return this.getImagesForPipeline1(sample);
        } else {
            const captionModels = ['gemini_1_5_flash', 'gemini_2_5_pro', 'deepseek_r1', 'llma_3_1_8b'];
            const modelName = captionModels[stage - 2];
            return this.getImagesForCaptionModel(sample, modelName);
        }
    }

    getCaptionForStage(sample, stage) {
        // Get caption for specific stage
        if (stage === 1) {
            return this.getTranslatedCaption(sample, sample.caption);
        } else {
            const stageIndex = stage - 2;
            const captionModelName = this.captionModelQueue[stageIndex];
            const captionModelData = this.getCaptionModelData(sample, captionModelName);
            return captionModelData ? this.getTranslatedCaption(captionModelData, captionModelData.generated_caption) : 'Caption not available';
        }
    }

    async handleFinalistSelection(selectedImage, sample) {
        console.log('[handleFinalistSelection] Selected finalist:', selectedImage);

        try {
            // Save selection to backend with metadata
            const response = await fetch(`${this.apiBaseUrl}/finalists/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    sample_id: sample.id,
                    selected_card_index: selectedImage.card_index,
                    selected_stage: selectedImage.stage,
                    image_model: selectedImage.model,                    // NEW: image generation model
                    caption_model: selectedImage.caption_model,          // NEW: caption model
                    image_path: selectedImage.path,                      // NEW: image path
                    caption_text: selectedImage.caption                  // NEW: caption text
                })
            });

            if (response.ok) {
                console.log('[handleFinalistSelection] Finalist selection saved successfully');
                // Move to next caption/sample
                await this.handleNextCaption();
            } else {
                console.error('[handleFinalistSelection] Error saving finalist selection:', response.status);
            }
        } catch (error) {
            console.error('[handleFinalistSelection] Error:', error);
        }
    }

    toggleArticleView(button) {
        console.log('[toggleArticleView] Article button clicked');
        const content = document.getElementById('articleContent');
        const isActive = button.classList.toggle('active');
        console.log('[toggleArticleView] Button active:', isActive);
        
        document.getElementById('summaryBtn').classList.remove('active');
        content.classList.remove('show');

        if (isActive) {
            console.log('[toggleArticleView] Displaying article content');
            content.textContent = this.currentArticle || '';
            content.classList.add('show');
        } else {
            console.log('[toggleArticleView] Hiding article content');
        }
        
        this.updateContentWarningBanner();
    }

    toggleSummaryView(button) {
        console.log('[toggleSummaryView] Summary button clicked');
        const content = document.getElementById('articleContent');
        const isActive = button.classList.toggle('active');
        console.log('[toggleSummaryView] Button active:', isActive);
        
        document.getElementById('articleBtn').classList.remove('active');
        content.classList.remove('show');

        if (isActive) {
            console.log('[toggleSummaryView] Displaying summary content');
            content.textContent = this.currentSummary || 'Summary not available';
            content.classList.add('show');
        } else {
            console.log('[toggleSummaryView] Hiding summary content');
        }
        
        this.updateContentWarningBanner();
    }

    resetToggleButtons() {
        document.getElementById('articleBtn').classList.remove('active');
        document.getElementById('summaryBtn').classList.remove('active');
        document.getElementById('articleContent').classList.remove('show');
        this.updateContentWarningBanner();
    }

    updateContentWarningBanner() {
        const banner = document.getElementById('contentWarningBanner');
        const bannerText = document.getElementById('contentWarningText');
        const articleBtn = document.getElementById('articleBtn');
        const summaryBtn = document.getElementById('summaryBtn');
        const currentLanguage = i18n.currentLanguage || 'en';

        console.log('[updateContentWarningBanner] Current language:', currentLanguage, 'Article active:', articleBtn.classList.contains('active'), 'Summary active:', summaryBtn.classList.contains('active'));

        // Check which view is currently active
        const isArticleActive = articleBtn.classList.contains('active');
        const isSummaryActive = summaryBtn.classList.contains('active');

        // Hide banner by default
        banner.style.display = 'none';

        if (isSummaryActive) {
            // Always show banner for summary (in any language)
            banner.style.display = 'block';
            bannerText.textContent = i18n.t('survey.aiSummaryBanner');
            console.log('[updateContentWarningBanner] Showing AI summary banner');
        } else if (isArticleActive) {
            // Show banner for article only if NOT English
            if (currentLanguage !== 'en') {
                banner.style.display = 'block';
                bannerText.textContent = i18n.t('survey.translatedArticleBanner');
                console.log('[updateContentWarningBanner] Showing translated article banner (language:', currentLanguage + ')');
            } else {
                banner.style.display = 'none';
                console.log('[updateContentWarningBanner] Hiding banner (article in English)');
            }
        } else {
            console.log('[updateContentWarningBanner] No view active, hiding banner');
        }
    }

    showLeaveConfirmation() {
        const confirmMessage = i18n.t('leave.confirmMessage');
        if (confirm(confirmMessage)) {
            this.showThankYouMessage();
        }
    }

    showThankYouMessage() {
        console.log('[showThankYouMessage] Redirecting to thank you page');
        // Redirect to standalone thank you page
        window.location.href = './thank-you.html';
    }

    showFullscreen(imagePath, modelName) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'fullscreen-modal';
        modal.id = 'fullscreenModal';

        // Create image container
        const container = document.createElement('div');
        container.className = 'fullscreen-container';

        // Create image
        const img = document.createElement('img');
        img.src = imagePath;
        img.className = 'fullscreen-image';

        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'fullscreen-close';
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = () => modal.remove();

        container.appendChild(closeBtn);
        container.appendChild(img);
        modal.appendChild(container);
        document.body.appendChild(modal);

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        // Close on Escape key
        const closeOnEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', closeOnEscape);
            }
        };
        document.addEventListener('keydown', closeOnEscape);
    }

    showCompletion() {
        const container = document.getElementById('cardsContainer');
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <h2>Thank you!</h2>
                <p>You have completed the survey for all 100 samples.</p>
                <p>Your feedback has been recorded.</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background-color: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">Reset Survey</button>
            </div>
        `;
        document.getElementById('nextBtn').disabled = true;
    }

    showError(message) {
        const container = document.getElementById('cardsContainer');
        container.innerHTML = `<div style="color: red; padding: 20px; background-color: #ffebee; border: 1px solid #f5a6a6; border-radius: 4px;">${message}</div>`;
    }

    showNotification(message, duration = 3000) {
        const notification = document.createElement('div');
        notification.className = 'notification show';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, duration);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SurveyApp();
});
