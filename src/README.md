# Survey App

Self-contained image evaluation survey for rating AI-generated images. 100 articles × 6 stages (5 rating + 1 finalization) = 600 rating sets per participant.

---

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Key Features](#key-features)
3. [Complete Survey Flow](#complete-survey-flow)
4. [Architecture](#architecture)
5. [Quick Start (Local Development)](#quick-start-local-development)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Production Deployment](#production-deployment)
9. [Capacity & Scaling](#capacity--scaling)
10. [Troubleshooting](#troubleshooting)
11. [Beta Testing & Reset](#beta-testing--reset)

---

## Directory Structure

```
survey_app/
├── backend/                          # Flask REST API
│   ├── app.py                        # Flask application factory
│   ├── config.py                     # Configuration (reads from .env)
│   ├── models.py                     # SQLAlchemy ORM models (5 tables)
│   ├── dashboard.py                  # Plotly Dash admin dashboard
│   ├── reset_database.py             # Database reset utility (dev/testing)
│   ├── requirements.txt              # Python dependencies
│   ├── .env                          # Environment variables (not in git)
│   ├── .env.example                  # Environment template
│   ├── data/
│   │   └── evaluation_sample_100_meta_data.json  # Article metadata (100 samples)
│   └── routes/
│       ├── sessions.py               # Session management
│       ├── ratings.py                # Rating CRUD
│       ├── demographics.py           # User demographics
│       ├── finalists.py              # Stage best images + finalist selection
│       └── admin.py                  # Admin stats + CSV export
└── frontend/                         # Vanilla JavaScript Survey UI
    ├── app.js                        # Main application logic (~3000 lines)
    ├── index.html                    # Main survey interface
    ├── thank-you.html                # Completion page
    ├── styles.css                    # Responsive styling
    ├── evaluation_sample_100_meta_data.json  # Article metadata (for frontend fetch)
    ├── translations/                 # i18n JSON files
    │   ├── en.json                   # English
    │   ├── de.json                   # German
    │   ├── fr.json                   # French
    │   └── si.json                   # Sinhala
    └── sample_100/                   # Survey data (100 articles × 4 news sources)
        ├── bbc/
        ├── guardian/
        ├── usa_today/
        └── washington_post/
```

---

## Key Features

✅ **4-Language Support** — English, German, French, Sinhala (instant switching, all UI elements translated)  
✅ **Two-Path Consent** — "Remember Me" (cookie + demographics) vs "Skip" (ghost user, ratings only)  
✅ **Session Resumption** — 30-day cookies; page reload restores exact article and stage  
✅ **Intelligent Article Selection** — 3-phase strategy (Resume → Coverage → Balancing) across 100 articles  
✅ **Multi-Stage Rating** — 6 stages × 100 samples; stages 1–5 rate images, stage 6 selects best  
✅ **Gamification** — Points system, 6 badge tiers with level-up animation  
✅ **Admin Dashboard** — Plotly Dash dashboard at `/admin/dashboard/` + CSV export  
✅ **CORS Configurable** — `CORS_ORIGINS` read from `.env` (no hardcoded hosts)

---

## Complete Survey Flow

### Phase 1 — Entry & Consent
1. User loads survey (`http://your-host:8000`)
2. Language detected from cookie or browser preference (EN/DE/FR/SI)
3. Consent banner:
   - **"Remember Me"** → 30-day cookie + demographics form + session resumption
   - **"Skip"** → No cookie, demographics form shown (ghost user), fresh session on return

### Phase 2 — Demographics (all users)
- Age, Occupation, Education, AI Experience, AI Stance
- Saved to `demographics` table linked to session ID
- **Ghost users see the form on every new session** — without a cookie there is no way to recognise a returning ghost user. This is intentional: the survey makes no attempt to track or identify users who have not given cookie consent.

### Phase 3 — Survey Workflow (100 articles × 6 stages)

**Stages 1–5: Rating Phase**

| Stage | Caption Source | Images Shown |
|-------|---------------|--------------|
| 1 | Original article caption | 7 (1 original + 6 AI-generated) |
| 2 | `gemini_1_5_flash` synthetic caption | 6 AI-generated |
| 3 | `gemini_2_5_pro` synthetic caption | 6 AI-generated |
| 4 | `deepseek_r1` synthetic caption | 6 AI-generated |
| 5 | `llma_3_1_8b` synthetic caption | 6 AI-generated |

Each image is rated on 4 criteria:
- **Relevance** (1–5 ⭐) — How relevant to article topic?
- **Real-likeness** (1–5 ⭐) — How realistic does it look?
- **Accuracy** (1–5 ⭐) — How accurately does it depict content?
- **Source Guess** (binary 🎚️) — Real photo or AI-generated?

Images are **seeded-shuffled** per session so the original is not always at position 0.

**Stage 6: Finalization**
- System computes best image from each stage (average of Relevance + Real-likeness + Accuracy; Source Guess excluded)
- Shows 5 finalist cards (one per stage 1–5)
- User clicks one to mark as overall best → stored in `FinalistSelections`

### Phase 4 — Navigation & Progress
- Progress bar: Sample X/100 + Stage Y/6
- "Next" button enabled only when **all images × all criteria** rated (stages 1–5)
- Stage 6: Next enabled after one finalist selected
- Flow: 1 → 2 → 3 → 4 → 5 → 6 → next article (resets to Stage 1)

### Phase 5 — Exit
- "Leave Survey" button (always visible) → multilingual confirmation → `thank-you.html`

### Data Collection

| Data | When | Optional? |
|------|------|-----------|
| Session ID | On entry | No — always created |
| Demographics | Shown to all users | Ghost users see it every new session (no cross-session tracking without cookie consent) |
| Ratings (a/b/c/d) | Per image per stage | No — required to proceed |
| Stage best image | After each stage 1–5 | No — calculated automatically |
| Finalist selection | Stage 6 | No — required to proceed |

### Session Types

| Feature | Remember Me | Skip (Ghost) |
|---------|------------|--------------|
| Cookie | ✅ 30 days | ❌ |
| Demographics | ✅ Collected once | ✅ Collected each new session† |
| Resumption | ✅ Exact stage | ❌ Fresh start |
| Ratings saved | ✅ | ✅ |

†Ghost users cannot be recognised across sessions because no cookie is stored. The demographic form will therefore appear again on every new session. This is by design — the survey does not track or profile users who have not given cookie consent.

---

## Architecture

```
Browser → HTTP Server (port 8000) → Frontend (app.js)
                                          ↓
                                    API Requests
                                          ↓
                              Nginx (port 80/443, reverse proxy)
                                          ↓
                              Gunicorn (port 5000, WSGI server)
                                          ↓
                              Flask API (survey_app/backend)
                                          ↓
                              PostgreSQL (port 5432, database)
```

### Intelligent Article Selection (3-Phase Strategy)

`GET /api/v1/sessions/<session_id>/least-rated-article`

| Phase | Name | Triggered When | Returns |
|-------|------|---------------|---------|
| 0 | **Resume** | User has an incomplete article (< full ratings for a stage) | That article + incomplete stage |
| 1 | **Coverage** | No incomplete articles; some articles have 0 global ratings | Fresh unrated article |
| 2 | **Balancing** | All 100 articles rated at least once | Least-rated article overall |

---

## Quick Start (Local Development)

### Prerequisites
- Python 3.8+, PostgreSQL 12+

### Step 1: Database Setup

```sql
-- In psql as postgres superuser:
CREATE DATABASE survey_db;
CREATE USER survey_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE survey_db TO survey_user;
```

### Step 2: Backend

```bash
cd survey_app/backend

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL to match your credentials

# Run (tables auto-created on first start)
python app.py
# → Running on http://localhost:5000
```

### Step 3: Frontend

```bash
# New terminal:
cd survey_app/frontend
python -m http.server 8000
# → Survey at http://localhost:8000
```

### Step 4: Verify

1. Open `http://localhost:8000`
2. Click "Remember Me" → backend logs `[createSession] ✅ Session created successfully`
3. Health check: `curl http://localhost:5000/health` → `{"status": "ok"}`

---

## API Reference

### Sessions

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/sessions/` | Create new session |
| GET | `/api/v1/sessions/<id>` | Get session + completed sample IDs |
| PUT | `/api/v1/sessions/<id>` | Update session progress |
| GET | `/api/v1/sessions/<id>/least-rated-article` | 3-phase next article selection |

### Ratings

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/ratings/` | Create or update rating |
| GET | `/api/v1/ratings/session/<sid>/sample/<sid>/stage/<stage>` | Get all ratings for a stage |

### Demographics

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/demographics/` | Save demographics (consenting users only) |
| GET | `/api/v1/demographics/<session_id>` | Retrieve demographics |

### Finalists & Stage Best Images

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/finalists/stage-best-images/` | Store best image after completing a stage |
| GET | `/api/v1/finalists/stage-best-images/<session_id>/<sample_id>` | Load stored best images (used on resume + stage 6) |
| GET | `/api/v1/finalists/best-images/<session_id>/<sample_id>` | Calculate best images on-the-fly (legacy fallback) |
| POST | `/api/v1/finalists/` | Save finalist selection (stage 6) |
| GET | `/api/v1/finalists/<session_id>/<sample_id>` | Retrieve existing finalist selection |

### Admin

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats` | Overall statistics |
| GET | `/api/v1/admin/export/csv` | Export all ratings as CSV |
| GET | `/api/v1/admin/export/json` | Export ratings as JSON |
| GET | `/admin/dashboard/` | Plotly Dash live dashboard |
| GET | `/health` | Health check |

### Example Requests

```bash
# Create session
curl -X POST http://localhost:5000/api/v1/sessions/

# Save a rating
curl -X POST http://localhost:5000/api/v1/ratings/ \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-...",
    "sample_id": 157840,
    "stage": 1,
    "card_index": 3,
    "criterion": "a",
    "rating": 4,
    "image_model": "blackforest_flux1_dev",
    "caption_model": "original",
    "image_path": "sample_100/bbc/images/0001/model_flux_282.jpg",
    "caption_text": "The caption shown to the user..."
  }'

# Save demographics
curl -X POST http://localhost:5000/api/v1/demographics/ \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-...",
    "age": "26-35",
    "occupation": "Engineering/Technology",
    "education": "Bachelor'\''s Degree",
    "ai_experience": "Intermediate",
    "ai_stance": "Neutral"
  }'
```

---

## Database Schema

### Sessions
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `created_at` / `updated_at` | DateTime | |
| `last_sample_id` | Integer | Article currently being rated (enables page-reload recovery) |
| `last_sample_index` | Integer | Legacy position index |
| `last_stage` | Integer | 1–6 |
| `is_completed` | Boolean | |
| `total_points` | Integer | Gamification |

### Ratings
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key |
| `session_id` | UUID | FK → Sessions |
| `sample_id` | Integer | Article ID |
| `stage` | Integer | 1–5 |
| `card_index` | Integer | 0–6 |
| `criterion` | String | `a`=Relevance, `b`=Real-like, `c`=Accuracy, `d`=Source Guess |
| `rating` | Integer | 1–5 for a/b/c; 1=Real / 2=AI for d |
| `image_model` | String | e.g. `blackforest_flux1_dev` or `original` |
| `caption_model` | String | e.g. `gemini_1_5_flash` or `original` |
| `image_path` | String | Path/URL to image |
| `caption_text` | Text | Caption shown during rating |
| `created_at` / `updated_at` | DateTime | |
| **Unique** | | `(session_id, sample_id, stage, card_index, criterion)` |

### StageBestImages
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key |
| `session_id` | UUID | FK → Sessions |
| `sample_id` | Integer | Article ID |
| `stage` | Integer | 1–5 |
| `best_card_index` | Integer | Which image (0–6) was best-rated |
| `average_rating` | Float | Avg of criteria a, b, c |
| `image_model` / `caption_model` / `image_path` / `caption_text` | | Full context |
| **Unique** | | `(session_id, sample_id, stage)` |

### FinalistSelections
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key |
| `session_id` | UUID | FK → Sessions |
| `sample_id` | Integer | Article ID |
| `selected_card_index` | Integer | Which finalist card was chosen |
| `selected_stage` | Integer | Which stage (1–5) it came from |
| `image_model` / `caption_model` / `image_path` / `caption_text` | | Full context |
| **Unique** | | `(session_id, sample_id)` |

### Demographics
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key |
| `session_id` | UUID | FK → Sessions (UNIQUE) |
| `age` | String | 18-25, 26-35, 36-45, 46-55, 56+ |
| `occupation` | String | 7 categories |
| `education` | String | 6 categories |
| `ai_experience` | String | None / Basic / Intermediate / Advanced |
| `ai_stance` | String | Impressed / Neutral / Skeptical |

> Ghost users ("Skip" path) have no Demographics record.

### ArticleMetadata
| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | Primary key |
| `sample_id` | Integer | Matches `id` in metadata JSON |
| `caption` / `topic` / `source` | String | Article details |
| `image_path` / `article_path` | String | Relative paths |
| `metadata_json` | JSON | Full metadata structure |

---

## Production Deployment

### ⚠️ Pre-Deployment Checklist

Two required config changes before going live:

**1. `frontend/app.js` line 83 — API URL**
```javascript
// Change from:
this.apiBaseUrl = 'http://localhost:5000/api/v1';
// To:
this.apiBaseUrl = 'https://your-server-hostname.com/api/v1';
```
> This is the **single point** controlling all `fetch()` calls — one change covers the entire frontend.

**2. `backend/.env` — CORS Origins**
```env
# Change from:
CORS_ORIGINS=http://localhost:8000,http://localhost:3000
# To:
CORS_ORIGINS=https://your-server-hostname.com
```

---

### Step 1: Server Setup

```bash
# Ubuntu 20.04/22.04 LTS
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv postgresql postgresql-contrib nginx git

sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Step 2: Database Setup

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE survey_db;
CREATE USER survey_user WITH PASSWORD 'your_very_secure_password';
ALTER ROLE survey_user SET client_encoding TO 'utf8';
ALTER ROLE survey_user SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE survey_db TO survey_user;
\q
```

### Step 3: Deploy Application

```bash
cd /opt
sudo git clone https://github.com/your-repo/artificial_news_imagery.git
sudo chown -R $USER:$USER artificial_news_imagery

cd artificial_news_imagery/survey_app/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn

cat > .env << EOF
FLASK_ENV=production
DEBUG=False
DATABASE_URL=postgresql://survey_user:your_very_secure_password@localhost:5432/survey_db
CORS_ORIGINS=https://your-server-hostname.com
EOF

# Tables auto-created on first run; optionally init manually:
python3 -c "from app import create_app; app = create_app(); print('DB initialized')"
deactivate
```

### Step 4: Gunicorn Service

Create `/etc/systemd/system/survey-backend.service`:

```ini
[Unit]
Description=Survey Tool API (Gunicorn)
After=network.target postgresql.service

[Service]
Type=notify
User=www-data
WorkingDirectory=/opt/artificial_news_imagery/survey_app/backend
Environment="PATH=/opt/artificial_news_imagery/survey_app/backend/venv/bin"
ExecStart=/opt/artificial_news_imagery/survey_app/backend/venv/bin/gunicorn \
    --workers 5 \
    --worker-class sync \
    --bind unix:/run/gunicorn.sock \
    --timeout 60 \
    --access-logfile /var/log/gunicorn_access.log \
    --error-logfile /var/log/gunicorn_error.log \
    "app:create_app()"
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable survey-backend
sudo systemctl start survey-backend
```

### Step 5: Nginx Configuration

Create `/etc/nginx/sites-available/survey`:

```nginx
upstream gunicorn_backend {
    server unix:/run/gunicorn.sock fail_timeout=0;
}

server {
    listen 80;
    server_name your-server-hostname.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-server-hostname.com;
    client_max_body_size 10M;

    ssl_certificate /etc/letsencrypt/live/your-server-hostname.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-server-hostname.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    gzip on;
    gzip_types text/plain text/css text/javascript application/json;

    # Frontend static files
    location / {
        root /opt/artificial_news_imagery/survey_app/frontend;
        try_files $uri $uri/ /index.html;
        expires 1h;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://gunicorn_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    # Admin dashboard proxy
    location /admin/ {
        proxy_pass http://gunicorn_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache survey images (immutable)
    location /sample_100/ {
        root /opt/artificial_news_imagery/survey_app/frontend;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/survey /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 6: SSL Certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d your-server-hostname.com
sudo systemctl enable certbot.timer
```

### Step 7: Verify Deployment

```bash
sudo systemctl status survey-backend nginx postgresql

# API health check
curl https://your-server-hostname.com/health

# Check logs
sudo journalctl -u survey-backend -f
tail -f /var/log/gunicorn_error.log
```

### Automated Daily Backups

```bash
cat > /usr/local/bin/backup-survey-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups"
mkdir -p $BACKUP_DIR
pg_dump -U survey_user survey_db | gzip > $BACKUP_DIR/survey_db_$(date +%Y%m%d_%H%M%S).sql.gz
find $BACKUP_DIR -name "survey_db_*.sql.gz" -mtime +30 -delete
EOF

sudo chmod +x /usr/local/bin/backup-survey-db.sh
# Add to crontab (runs at 2 AM daily):
# 0 2 * * * /usr/local/bin/backup-survey-db.sh
```

---

## Capacity & Scaling

**Recommended for 30–50 concurrent users (thesis deployment):**
- t3.medium EC2 (2 vCPU, 4 GB RAM)
- PostgreSQL on same instance
- Gunicorn 5 workers
- Nginx reverse proxy

**Expected performance:**
- Response time: < 200ms at 50 concurrent users
- Database growth: ~500 KB per completed session
- Monthly storage: ~3–5 GB per 1,000 users

**Scaling beyond 50 users:**
1. Increase Gunicorn workers: `--workers` = (CPU cores × 2 + 1)
2. Add second app server + load balancer
3. Add DB indexes; archive old rating data
4. Serve `sample_100/` images via CDN (CloudFront/CloudFlare)

---

## Troubleshooting

### Backend won't start
```bash
sudo journalctl -u survey-backend -n 50
# Check DATABASE_URL in backend/.env is correct
```

### CORS errors in browser console
- Verify `CORS_ORIGINS` in `backend/.env` contains the exact origin (including scheme)
- Restart backend: `sudo systemctl restart survey-backend`

### No images loading
- Confirm `sample_100/` is present in `frontend/`
- Check `frontend/app.js` line 83 has the correct `apiBaseUrl` for the environment

### Database connection error
```bash
# Verify PostgreSQL running
sudo systemctl status postgresql
# Test connection
psql -U survey_user -d survey_db -c "SELECT 1;"
```

### Check stored data
```bash
psql -U survey_user -d survey_db -c "SELECT COUNT(*) FROM sessions;"
psql -U survey_user -d survey_db -c "SELECT COUNT(*) FROM ratings;"
```

---

## Beta Testing & Reset

**During testing:**
```bash
# Restart backend after code changes
git pull && sudo systemctl restart survey-backend

# Reset database (wipes all data)
cd survey_app/backend && python reset_database.py
```

**Before production launch:**
1. Backup: `sudo /usr/local/bin/backup-survey-db.sh`
2. Reset: `python reset_database.py`
3. Restart: `sudo systemctl restart survey-backend`
4. Verify health: `curl https://your-server-hostname.com/health`

---

**Status**: ✅ Ready for deployment  
**Last Updated**: May 2026  
**Version**: 1.0
