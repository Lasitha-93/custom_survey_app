# Frontend

All documentation has been consolidated into the main [`survey_app/README.md`](../README.md).

## Overview
Production-ready survey application for rating AI-generated images across 6 evaluation stages (100 samples, 5 rating stages + 1 finalization stage = 600 sets).

## Key Features

### Session & User Management
- **Two-Path Consent System**: 
  - "Remember Me" → 30-day cookie + demographics form + session resumption
  - "Skip" → No cookie + no demographics (ghost user) + fresh session on return
- **Multi-Language Support**: 4 languages (EN/DE/FR/SI) with auto-detection
  - Language selector with globe icon (🌐) in consent banner and main survey
  - Instant content translation (articles, summaries, captions)
  - All UI elements translate dynamically

### Survey Features
- **6-Stage Workflow**: 5 rating stages + 1 finalization stage per sample
  - **Stages 1-5**: Rating phase (Stage 1 = original caption + 7 images; Stages 2-5 = synthetic captions + 6 images)
  - **Stage 6**: Finalization phase (Select best image across all stages)
- **Rating System**: 4 evaluation criteria per image (Stages 1-5 only)
  - **Relevance** (1-5 stars ⭐)
  - **Real-likeness** (1-5 stars ⭐)
  - **Accuracy** (1-5 stars ⭐)
  - **Source Guess** (Binary: Real or AI Generated 🎚️)
- **Finalization System**: Stage 6 - Best Image Selection
  - System calculates best-rated image from each stage (highest 3-criterion average)
  - User selects overall best image from 5 finalist candidates
  - No rating elements shown (clean, unbiased comparison)
- **Content Access**: Article and Summary buttons (mutually exclusive toggle)
- **Progress Tracking**: Real-time progress bar + sample counter
- **Leave Survey**: Button with multilingual confirmation → thank you page

### Technical Stack
- **Frontend**: Vanilla JS (~1,800 lines, zero dependencies)
- **Backend**: Flask + PostgreSQL (CORS enabled)
- **Database**: 4 tables (Sessions, Ratings, Demographics, FinalistSelections)
- **HTTP Servers**: Python SimpleHTTPServer (8000), Flask (5000), PostgreSQL (5432)

## Complete Survey Flow

### **Phase 1: Entry & Consent**
1. **User loads survey** (localhost:8000)
2. **Language selection** appears:
   - Auto-detects browser language (EN/DE/FR/SI)
   - User can change language via dropdown (🌐 globe icon)
   - Language saved in cookie (30 days)
3. **Consent banner** displays:
   - "Remember Me" button → Creates session + will collect demographics
   - "Skip" button → Creates session + no demographics (ghost user)

### **Phase 2: Demographics (Optional)**
- **If "Remember Me":**
  - Demographics form displayed (Age, Occupation, Education, AI Experience, AI Stance)
  - Data saved to database
  - Session gets 30-day cookie
- **If "Skip":**
  - Skip demographics → Go directly to survey
  - No cookie stored → Fresh start on return

### **Phase 3: Survey Workflow**
**For each of 100 samples:**
- **6 stages per sample** (5 rating stages + 1 finalization stage = 600 stage sets)

**Stages 1-5: Rating Phase**

**Stage 1:** Original Caption
- Shows original article image + 7 cards (1 original + 6 AI-generated)
- User rates all 7 images across 4 criteria

**Stages 2-5:** Synthetic Captions
- Each stage uses different AI caption model
- Shows 6 AI-generated images per stage
- User rates all 6 images across 4 criteria

**Stage 6:** Finalization Phase
- System calculates best-rated image from each stage (using average of 3 criteria: Relevance, Real-likeness, Accuracy)
- Displays 5 finalist cards (1 best image from each stage)
- User selects overall best image from finalist candidates
- Simple card-based interface with no rating elements (clean comparison)

### **Phase 4: Rating Each Image (Stages 1-5 Only)**
1. **Relevance** (1-5 stars ⭐) - "How relevant to article topic?"
2. **Real-likeness** (1-5 stars ⭐) - "How realistic?"
3. **Accuracy** (1-5 stars ⭐) - "How accurate to content?"
4. **Source Guess** (Radio buttons 🎚️) - "Real or AI Generated?"

**Additional UI per image (Stages 1-5):**
- Article button (toggle, loads full article)
- Summary button (toggle, loads summary)
- Fullscreen button (view image larger)

**Stage 6 (Finalization):**
- No rating criteria shown
- Simple card display: Image + Caption + Average Rating Label
- Click any card to mark as best overall image

### **Phase 5: Navigation & Progress**
- Progress bar shows: Sample X/100 + Stage Y/6 (5 rating stages + 1 finalization)
- **"Next" button** appears only when ALL images + ALL criteria rated (for stages 1-5)
- Moving through stages: 1→2→3→4→5→6 (Finalization)→Next sample (resets to Stage 1)
- Finalization stage requires selecting one finalist image to proceed

### **Phase 6: Exit Option**
- "Leave Survey" button visible throughout
- Shows confirmation dialog (multilingual)
- Redirects to standalone thank-you.html page
- User can close browser

### **Data Collection Points**

| Data | When | Optional? | Stages |
|------|------|-----------|--------|
| Session ID | Entry | No - Always created | All |
| Demographics | After consent | Yes - Only "Remember Me" | All |
| Article/Summary views | User clicks buttons | No - Tracked client-side | 1-5 |
| Each rating (a/b/c/d) | User rates image | No - Required to proceed | 1-5 |
| Finalist selection | User clicks finalist card | No - Required to proceed | 6 |
| Session progress | After each stage | No - Tracked | All |

## File Structure
```
survey_tool/
├── index.html              # Main survey UI (includes language warning banner)
├── app.js                  # Survey logic (~1,800 lines)
├── styles.css              # Responsive styling
├── thank-you.html          # Exit page (multilingual)
├── translations/           # JSON files for 4 languages
│   ├── en.json
│   ├── de.json
│   ├── fr.json
│   └── si.json
└── sample_100/             # Image and content directory
```

## Getting Started

### Starting the Server
```bash
cd evaluation/
python -m http.server 8000
```

### Access the Survey
Current language detection: Browser language → Fallback to English  
Language persistence: 30-day cookie

### Session Types
| Feature | Remember Me | Skip |
|---------|------------|------|
| Cookie | ✅ 30 days | ❌ |
| Demographics | ✅ Collected | ⏭️ Skipped |
| Resumption | ✅ Last position | ❌ Fresh start |
| Data Saved | ✅ Full profile | ✅ Ratings only |

## Translation Files

All translation keys automatically available across 4 languages:

```json
{
  "consent": { "title", "message", "rememberButton", "skipButton" },
  "demographics": { "title", "subtitle", "age", "occupation", ... },
  "buttons": { "article", "summary", "next", "close", "startSurvey" },
  "leave": { "confirmMessage", "thankYouTitle", "thankYouMessage", "thankYouDetails", "footerText" },
  "criteria": { "relevance", "real_like", "accuracy" },
  "survey": { "title", "stage", "sampleCount" },
  ...
}
```

## Database Schema

**Sessions**: `id`, `created_at`, `last_sample_index`, **`last_sample_id` (NEW)**, `last_stage`, `completed`  
  - **last_sample_id**: UUID of article currently being worked on (enables page reload recovery)
**Ratings**: `id`, `session_id`, `sample_id`, `stage`, `card_index`, `criterion`, `rating`, `image_model`, `caption_model`, `image_path`, `caption_text`
  - **criterion**: 'a' (Relevance), 'b' (Real-like), 'c' (Accuracy), 'd' (Source Guess)
  - **rating**: 1-5 for star criteria; 1-2 for binary (1=Real, 2=AI Generated)
  - **NEW - Metadata**: image_model (which image generation model), caption_model (which caption model or 'original'), image_path (path to image), caption_text (caption shown)
**Demographics**: `id`, `session_id`, `age`, `occupation`, `education`, `ai_experience`, `ai_stance`
**StageBestImages**: `id`, `session_id`, `sample_id`, `stage`, `best_card_index`, `average_rating`, `image_model`, `caption_model`, `image_path`, `caption_text`
  - **stage**: 1-5, representing which stage/caption-model this best image came from
  - **best_card_index**: Which image (0-6) was best-rated
  - **average_rating**: Average rating across Relevance, Real-like, Accuracy criteria
  - **NEW - Metadata**: Full context of best image for thesis analysis
**FinalistSelections**: `id`, `session_id`, `sample_id`, `selected_card_index`, `selected_stage`, `image_model`, `caption_model`, `image_path`, `caption_text`
  - **selected_stage**: Which stage (1-5) the best image came from
  - **selected_card_index**: Index of selected image within that stage
  - **NEW - Metadata**: Full context of selected finalist for thesis analysis
  - **Unique**: One selection per session per sample

*Note: Demographics = NULL for ghost users (Skip path); Metadata = optional but recommended (NULL for backward compatibility)*

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/sessions/` | POST | Create new session |
| `/api/v1/sessions/{id}` | PUT | Update session progress |
| `/api/v1/sessions/{id}/least-rated-article` | GET | **NEW:** Intelligent 3-phase article selection |
| `/api/v1/ratings/` | POST | Save image rating |
| `/api/v1/demographics/` | POST/GET/PUT | User demographics |
| `/api/v1/finalists/best-images/{session_id}/{sample_id}` | GET | Get 5 best-rated images (1 per stage, legacy) |
| `/api/v1/finalists/stage-best-images/` | POST | **NEW:** Save best image for stage |
| `/api/v1/finalists/stage-best-images/{session_id}/{sample_id}` | GET | **NEW:** Load stored best images (for resume) |
| `/api/v1/finalists/` | POST | Save finalist selection |
| `/api/v1/finalists/{session_id}/{sample_id}` | GET | Retrieve existing finalist selection |

## Important Technical Features

### Intelligent Article Selection (3-Phase Strategy)
**Endpoint:** `GET /api/v1/sessions/<session_id>/least-rated-article`  
**Purpose:** Intelligently selects which article (sample) to display next, optimizing coverage and distribution across 100 samples.

**Selection Phases:**

1. **Phase 0 (Resume)**: For articles with incomplete ratings
   - Detects when user has < 28 ratings for an article at a given stage (28 = 4 criteria × 7 images for stage 1; 4 × 6 images for stages 2-5)
   - Returns the incomplete article and the incomplete stage number
   - Triggered when: `last_sample_id` exists and has incomplete ratings in database
   - Use Case: User was rating Stage 3 of Article #45, then left browser. On return, Phase 0 resumes Stage 3 of Article #45

2. **Phase 1 (Coverage)**: For fresh, never-rated articles
   - Returns articles that have 0 ratings globally (across all sessions)
   - Ensures systematic coverage of all 100 articles
   - Triggered when: Phase 0 has no incomplete articles, no new articles remaining
   - Use Case: Second user gets a fresh article not yet touched by anyone

3. **Phase 2 (Balancing)**: For least-rated articles
   - Returns article with minimum total ratings across all stages
   - Distributes ratings evenly instead of concentrating on first few articles
   - Triggered when: Phases 0 and 1 exhausted (all articles have been rated at least once)
   - Use Case: 50th user gets an article that has been rated fewer times than others

**Response Format:**
```json
{
  "sample_id": 12345,
  "rating_count": 15,
  "phase": 0,
  "stage": 2
}
```

**Frontend Handling:**
```javascript
// Call endpoint to get next article
const response = await fetch(`/api/v1/sessions/${sessionId}/least-rated-article`);
const data = await response.json();

if (data.phase === 0) {
  // Resume: Jump to incomplete stage
  this.currentSampleId = data.sample_id;
  this.currentStage = data.stage;
  this.displaySample(data.sample_id, data.stage);
} else if (data.phase === 1 || data.phase === 2) {
  // Coverage or Balancing: Start at Stage 1
  this.currentSampleId = data.sample_id;
  this.currentStage = 1;
  this.displaySample(data.sample_id, 1);
}
```

### Session Restoration with last_sample_id
- **Persistence**: `last_sample_id` stored in database (UUID of current article)
- **Restoration**: On page reload, frontend queries session to get `last_sample_id` and `last_stage`
- **Recovery**: Frontend restores exact article + stage (prevents showing thank you page incorrectly)
- **Safety Check**: If `last_sample_id` exists but `last_stage <= 1`, treats as valid resume (Phase 0 handles detection)
- **Impact**: Users can close browser mid-survey and resume exactly where they left off

### Stage 6 Best Images Caching Strategy
- **During Rating (Stages 1-5)**: Best images calculated in memory (`stageBestImages` object)
- **During Finalization (Stage 6)**: **NEW** - Forces database query via `fetchBestImagesFromDatabase()`
- **Reason**: After page reload, memory cache is empty; must query database to ensure correct best images
- **Implementation**: 
  ```javascript
  if (currentStage === 6) {
    // Always query database for Stage 6 to avoid stale memory cache
    return await this.fetchBestImagesFromDatabase(sampleId);
  }
  ```
- **Fallback**: If database query fails, falls back to memory cache (graceful degradation)

### Session Restoration
- **Automatic Resumption**: Returning users automatically resume at the exact last stage where they left off
- **Mechanism**: On app initialization, system fetches session from backend and restores `last_sample_index` and `last_stage`
- **User Experience**: No need to click through completed stages; returns to precise resumption point
- **Data Integrity**: Incomplete samples are not skipped; users can still go back if needed

### Finalization Stage Best-Image Algorithm
- **Scoring**: Best image = Average(Relevance, Real-likeness, Accuracy) ÷ 3
- **Exclusion**: Source Guess criterion is excluded from finalization calculation
- **Selection**: System selects top-rated image from each stage (1-5) by average score
- **Display**: Shows 5 finalist cards (one best from each stage) for user final selection
- **State Management**: Users click to select card (visual highlight), then click Next button to confirm selection

### Image Randomization
- **Rating Phases (1-5)**: Images are randomized per session for unbiased comparison
- **Finalization Phase (6)**: Images are NOT randomized - retrieved in consistent order to match card indices selected by user
- **Implementation**: Uses `getImagesForStageUnrandomized()` functions to fetch images without randomization for finalization

### Language Warning Banner
- **Display**: Permanent info banner below header (only for non-English languages)
- **Message**: "Original language of the article is English. We encourage you to complete the survey in English..."
- **Languages**: Banner text displayed in user's selected language
- **Behavior**: Shows automatically on non-English language selection, hidden when English selected
- **Automation**: Updates dynamically when user changes language selection

- ✅ **Production Ready**: All features tested and working
- ✅ **Consent-Based**: Two distinct user paths (consenting vs ghost)
- ✅ **Multilingual**: Full translation support with instant switching
- ✅ **Session Persistent**: Returning users resume from exact last position
- ✅ **Data Integrity**: All responses saved regardless of user type
- ✅ **Session Restoration**: Automatic resumption at last stage (no manual clicking through completed stages)
- ✅ **Language Warning**: Non-English users see warning banner about original article language
- ✅ **Finalization Selection**: Visual feedback (green border) when finalist card selected
- ✅ **NEW - Intelligent Article Selection**: 3-phase strategy (Resume/Coverage/Balancing) for optimal survey distribution
- ✅ **NEW - last_sample_id Persistence**: Page reload recovery restores exact article being worked on
- ✅ **NEW - Stage 6 Database Fallback**: Forces database query after page reload for consistency
- ⚠️ **No Backwards Navigation**: Forward-only flow (by design)
- ⚠️ **All Criteria Required**: Cannot proceed until all images rated (stages 1-5)

## Deployment Instructions

1. Ensure Flask backend is running on port 5000
2. Ensure PostgreSQL is running on port 5432
3. Start HTTP server on port 8000
4. All three servers will be accessible simultaneously
5. Session IDs are automatically managed (30-day persistence for consenting users)

## April 18, 2026 Updates

### Features Added
1. **Finalization Stage (Stage 6)**
   - Best-image selection workflow
   - Algorithm: Average of Relevance, Real-likeness, Accuracy (Source Guess excluded)
   - Displays 5 finalist cards for final user selection
   
2. **Session Restoration**
   - Returning users automatically resume at exact last stage
   - No need to manually click through previously completed stages
   
3. **Language Warning Banner**
   - Permanent info banner for non-English language users
   - Displays "Original language of the article is English..." message
   - Updates dynamically when language changes
   - Messages translated to all 4 languages

### Bug Fixes
1. Fixed i18n undefined error in finalization functions
2. Fixed image path reference (imageObj.path instead of imageObj.url)
3. Created unrandomized image retrieval for finalization (prevents card index mismatch)
4. Changed finalist card behavior from auto-navigation to selection + Next button
5. Fixed stage progress display to show /6 instead of /5
6. Fixed caption visibility after finalization stage transitions

### Technical Improvements
- Added ~250+ lines to app.js for finalization workflow
- Implemented session restoration on app initialization
- Created FinalistSelection database model with unique constraints
- Added 3 new API endpoints for finalist operations
- Enhanced image randomization logic with unrandomized variants

---

**Status**: ✅ Complete and production-ready  
**Last Updated**: April 18, 2026 (Finalization stage + Session restoration + Language warning banner)


