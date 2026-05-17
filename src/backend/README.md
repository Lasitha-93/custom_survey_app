# Backend

All documentation has been consolidated into the main [`survey_app/README.md`](../README.md).

Production-ready REST API for the image evaluation survey system with PostgreSQL database.

## Architecture

- **Backend**: Flask REST API
- **Database**: PostgreSQL (recommended) or SQLite (development)
- **Architecture**: RESTful with CORS support
- **Designed for**: 0-100 concurrent users

## Project Structure

```
survey_backend/
├── app.py                 # Flask app factory
├── config.py              # Configuration management
├── models.py              # SQLAlchemy models
├── requirements.txt       # Python dependencies
├── .env.example            # Environment template
├── routes/
│   ├── sessions.py        # Session management APIs
│   ├── ratings.py         # Rating CRUD operations
│   └── admin.py           # Admin dashboard APIs
└── README.md              # This file
```

## Setup Instructions

### 1. Prerequisites

- Python 3.8+
- PostgreSQL 12+ (or SQLite for development)
- pip / virtualenv

### 2. Install PostgreSQL

**Windows (using Chocolatey or direct installer):**
```bash
# Using Chocolatey
choco install postgresql

# Or download from: https://www.postgresql.org/download/windows/
```

**After installation:**
- Start PostgreSQL service
- Create a new database:
```sql
CREATE DATABASE survey_db;
CREATE USER survey_user WITH PASSWORD 'your_secure_password';
ALTER ROLE survey_user SET client_encoding TO 'utf8';
ALTER ROLE survey_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE survey_user SET default_transaction_deferrable TO on;
ALTER ROLE survey_user SET default_transaction_read_only TO off;
GRANT ALL PRIVILEGES ON DATABASE survey_db TO survey_user;
```

### 3. Setup Python Environment

```bash
# Navigate to backend directory
cd evaluation\survey_backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate

# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Configure Environment

```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env with your database credentials
# DATABASE_URL=postgresql://survey_user:your_secure_password@localhost:5432/survey_db
```

### 5. Initialize Database

```bash
# Flask will auto-create tables on first run, but you can manually init:
python -c "from app import create_app; app = create_app(); app.app_context().push(); from models import db; db.create_all()"
```

### 6. Run Backend Server

```bash
python app.py

# Server will start on http://localhost:5000
```

## API Endpoints

### Sessions Management

```
POST   /api/v1/sessions/                                   # Create new session
GET    /api/v1/sessions/<id>                               # Get session details
PUT    /api/v1/sessions/<id>                               # Update session progress
GET    /api/v1/sessions/<id>/ratings                       # Get session ratings
GET    /api/v1/sessions/<id>/least-rated-article           # Intelligent article selection (NEW)
```

#### Intelligent Article Selection Endpoint (NEW)

**Endpoint:** `GET /api/v1/sessions/<session_id>/least-rated-article`

**Purpose:** Returns the next article to survey, using a smart 3-phase selection strategy to optimize coverage and distribution across 100 articles.

**Response Format:**
```json
{
  "sample_id": 12345,
  "rating_count": 15,
  "phase": 0,
  "stage": 2
}
```

**Selection Strategy:**

- **Phase 0 (Resume):** If user has incomplete articles from a previous session (< 28 ratings for a given stage), returns that article and stage to resume. Detected by checking if currentSampleId already has ratings in the database that are incomplete.
  
- **Phase 1 (Coverage):** Once all incomplete articles are handled, returns fresh articles that have never been rated globally (no ratings in database for that article across all sessions). Ensures broad coverage of all 100 articles.
  
- **Phase 2 (Balancing):** When all 100 articles have been rated at least once, returns the least-rated article across all stages. Ensures balanced distribution of ratings, preventing some articles from being rated far fewer times than others.

**Return Values:**
- `sample_id`: The article ID to display
- `rating_count`: Current number of ratings for this article (for UI feedback)
- `phase`: Which phase triggered (0=Resume, 1=Coverage, 2=Balancing)
- `stage`: (Phase 0 only) The incomplete stage to resume

### Ratings Management

```
POST   /api/v1/ratings/               # Create/update rating
GET    /api/v1/ratings/<id>           # Get specific rating
PUT    /api/v1/ratings/<id>           # Update rating
DELETE /api/v1/ratings/<id>           # Delete rating
GET    /api/v1/ratings/session/<sid>/sample/<sampleid>/stage/<stage>  # Get all ratings for stage
```

### Finalist & Stage Best Images Management

```
POST   /api/v1/finalists/                                  # Save final selection (stage 6)
GET    /api/v1/finalists/<session_id>/<sample_id>        # Get final selection
POST   /api/v1/finalists/stage-best-images/               # Save best image for stage (NEW)
GET    /api/v1/finalists/stage-best-images/<session_id>/<sample_id>  # Load stored best images (NEW)
GET    /api/v1/finalists/best-images/<session_id>/<sample_id>  # Get calculated best images (legacy)
```

**Stage Best Images Endpoints (NEW):**

These endpoints handle persistence of the best-rated image for each stage, enabling users to resume surveys with consistent best image selections.

- **POST /api/v1/finalists/stage-best-images/** - Called after each stage (1-5) completes. Stores the best-rated image for that stage.
- **GET /api/v1/finalists/stage-best-images/<session_id>/<sample_id>** - Called when user resumes survey or reaches Stage 6 (finalist). Returns all 5 stored best images with metadata. Stage 6 always queries this endpoint to ensure consistency after page reloads.

### Demographics Management

```
POST   /api/v1/demographics/          # Create demographic data (consenting user)
GET    /api/v1/demographics/<session_id>  # Get demographics for session
PUT    /api/v1/demographics/<session_id>  # Update demographics (rare case)
```

**Note:** Demographics are only created for consenting users ("Remember Me" path). Ghost users ("Skip" path) have no demographic record.


### Admin Dashboard

```
GET    /api/v1/admin/stats            # Overall statistics
GET    /api/v1/admin/sessions         # List all sessions (paginated)
GET    /api/v1/admin/ratings          # List ratings with filters
GET    /api/v1/admin/export/csv       # Export ratings as CSV
GET    /api/v1/admin/export/json      # Export ratings as JSON
```

### Health Check

```
GET    /health                         # API health status
```

## API Usage Examples

### Create Session

```bash
curl -X POST http://localhost:5000/api/v1/sessions/
```

Response:
```json
{
  "success": true,
  "session": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "created_at": "2024-04-11T10:00:00",
    "last_sample_index": 0,
    "last_stage": 1,
    "is_completed": false,
    "rating_count": 0
  }
}
```

### Save Rating

```bash
curl -X POST http://localhost:5000/api/v1/ratings/ \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "sample_id": 157840,
    "stage": 1,
    "card_index": 0,
    "criterion": "a",
    "rating": 4,
    "notes": "Good quality"
  }'
```

### Save Demographics (Consenting User Only)

```bash
curl -X POST http://localhost:5000/api/v1/demographics/ \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "age": "26-35",
    "occupation": "Engineering/Technology",
    "education": "Bachelor'\''s Degree",
    "ai_experience": "Intermediate",
    "ai_stance": "Neutral"
  }'
```

Response:
```json
{
  "success": true,
  "message": "Demographics saved successfully",
  "demographic": {
    "id": 1,
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "age": "26-35",
    "occupation": "Engineering/Technology",
    "education": "Bachelor's Degree",
    "ai_experience": "Intermediate",
    "ai_stance": "Neutral",
    "created_at": "2026-04-13T10:00:00"
  }
}
```

### Get Demographics

```bash
curl http://localhost:5000/api/v1/demographics/550e8400-e29b-41d4-a716-446655440000
```

Response (if demographics exist):
```json
{
  "success": true,
  "demographic": { ...demographic object... }
}
```

Response (if ghost user, no demographics):
```json
{
  "success": false,
  "message": "Demographic data not found"
}
```


### Get Admin Stats

```bash
curl http://localhost:5000/api/v1/admin/stats
```

## Database Schema

### Sessions Table
- `id`: UUID (primary key)
- `created_at`: DateTime
- `updated_at`: DateTime
- `last_sample_index`: Integer (current sample index, legacy)
- `last_sample_id`: UUID (current sample being worked on, enables page reload recovery)
- `last_stage`: Integer (1-6, where 6=finalist selection)
- `is_completed`: Boolean
- `ratings`: Foreign key relationship
- `demographics`: Foreign key relationship (optional, one-to-one)

**Note:** `last_sample_id` is the sample ID (not index) of the article currently being rated. It enables users to resume at the exact article they were working on, even after page refreshes. When combined with phase detection, it supports three recovery scenarios:
1. **Same stage resume** - User was on incomplete article at stage 3, resumes stage 3 of same article
2. **Next stage** - User completed all stages of article, resumes article at next stage
3. **New article** - User finished article completely, proceeds to next article via Phase 1/2 selection

### Ratings Table
- `id`: Integer (primary key)
- `session_id`: UUID (foreign key)
- `sample_id`: Integer (reference to metadata)
- `stage`: Integer (1-5)
- `card_index`: Integer (0-6)
- `criterion`: String ('a'=Relevance, 'b'=Real-like, 'c'=Accuracy, 'd'=Source)
- `rating`: Integer (1-5 stars for a/b/c, 1-2 for d/source)
- `notes`: Text (optional)
- **NEW - Metadata (NULLABLE):**
  - `image_model`: String (e.g., 'gemini_3_pro' or 'original')
  - `caption_model`: String (e.g., 'gemini_1_5_flash' or 'original')
  - `image_path`: String (path to image file)
  - `caption_text`: Text (caption shown during rating)
- `created_at`: DateTime
- `updated_at`: DateTime
- Unique constraint on (session_id, sample_id, stage, card_index, criterion)

### Stage Best Images Table (NEW)
**Stores the best-rated image for each stage per session (for session resumption)**
- `id`: Integer (primary key)
- `session_id`: UUID (foreign key)
- `sample_id`: Integer (article ID)
- `stage`: Integer (1-5, corresponding to caption model stage)
- `best_card_index`: Integer (0-6, which image was best)
- `average_rating`: Float (average of criteria a, b, c)
- **NEW - Metadata (NULLABLE):**
  - `image_model`: String (image generation model name or 'original')
  - `caption_model`: String (caption model or 'original' for stage 1)
  - `image_path`: String (path to best image)
  - `caption_text`: Text (caption shown for this stage)
- `created_at`: DateTime
- `updated_at`: DateTime
- Unique constraint on (session_id, sample_id, stage)

### Finalist Selections Table (NEW)
**Stores user's final image selection from stage 6**
- `id`: Integer (primary key)
- `session_id`: UUID (foreign key)
- `sample_id`: Integer (article ID)
- `selected_card_index`: Integer (which best image was selected)
- `selected_stage`: Integer (which stage the finalist came from, 1-5)
- **NEW - Metadata (NULLABLE):**
  - `image_model`: String (image generation model of selected image)
  - `caption_model`: String (caption model of selected image)
  - `image_path`: String (path to selected image)
  - `caption_text`: Text (caption of selected image)
- `created_at`: DateTime
- `updated_at`: DateTime
- Unique constraint on (session_id, sample_id)

### Demographics Table (NEW)
**For consenting users only ("Remember Me" path)**
- `id`: Integer (primary key)
- `session_id`: UUID (foreign key, UNIQUE)
- `age`: String (18-25, 26-35, 36-45, 46-55, 56+)
- `occupation`: String (7 categories)
- `education`: String (6 categories)
- `ai_experience`: String (None, Basic, Intermediate, Advanced)
- `ai_stance`: String (Impressed, Neutral, Skeptical)
- `created_at`: DateTime

**Note:** Ghost users ("Skip" path) have no demographic record. Queries for demographics on ghost user sessions return `not found`.


### Users Table
- `id`: Integer (primary key)
- `username`: String (unique)
- `email`: String (unique)
- `password_hash`: String
- `is_admin`: Boolean
- `created_at`: DateTime

## Frontend Integration

Update the survey tool frontend to use the API:

1. **Create Session on Load**
```javascript
const response = await fetch('http://localhost:5000/api/v1/sessions/', {
  method: 'POST'
});
const data = await response.json();
const sessionId = data.session.id;
```

2. **Save Rating to Backend**
```javascript
const response = await fetch('http://localhost:5000/api/v1/ratings/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: sessionId,
    sample_id: sampleId,
    stage: stage,
    card_index: cardIndex,
    criterion: criterion,
    rating: rating,
    // NEW - Metadata (optional but recommended for thesis analysis):
    image_model: 'gemini_3_pro',          // or 'original'
    caption_model: 'gemini_1_5_flash',    // or 'original'
    image_path: '/sample_100/images/02/image.jpg',
    caption_text: 'The caption shown to user...'
  })
});
```

3. **Load Ratings for Current Stage**
```javascript
const response = await fetch(
  `http://localhost:5000/api/v1/ratings/session/${sessionId}/sample/${sampleId}/stage/${stage}`
);
const data = await response.json();
// Restore ratings from backend
```

## Deployment

### Docker (Production)

```dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_ENV=production
EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:create_app()"]
```

### Production Checklist

- [ ] Set `FLASK_ENV=production`
- [ ] Set `DEBUG=False`
- [ ] Use strong database credentials
- [ ] Enable HTTPS/SSL
- [ ] Set secure CORS origins
- [ ] Use production WSGI server (Gunicorn)
- [ ] Setup database backups
- [ ] Monitor API performance

## Troubleshooting

### PostgreSQL Connection Error
- Verify PostgreSQL service is running
- Check `DATABASE_URL` in `.env`
- Verify database credentials

### CORS Errors
- Add frontend URL to `CORS_ORIGINS` in `.env`
- Verify frontend is making requests to correct API URL

### Database Migration Issues
- Delete `survey.db` (if using SQLite)
- Drop and recreate PostgreSQL database
- Run `db.create_all()` again

## Production Deployment Guide

### Quick Overview

For 30-50 concurrent survey users, a single Linux VPS with the following stack is ideal:
- **OS**: Ubuntu 20.04 LTS or 22.04 LTS
- **Web Server**: Nginx (reverse proxy + static file serving)
- **App Server**: Gunicorn (Python WSGI)
- **Database**: PostgreSQL 12+
- **Resource Estimate**: 2GB RAM, 2 CPU cores ($5-10/month)

### Pre-Deployment Checklist

- [ ] Code is committed and tested locally
- [ ] Environment variables documented
- [ ] Database schema is finalized
- [ ] Images resized to 800x600 (uniform size)
- [ ] Frontend configured with production API URL
- [ ] SSL certificate obtained (Let's Encrypt free)

### Step 1: Server Setup

**SSH into your VPS and run:**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3-pip python3-venv postgresql postgresql-contrib nginx git

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### Step 2: Create PostgreSQL Database & User

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Inside psql:
CREATE DATABASE survey_db;
CREATE USER survey_user WITH PASSWORD 'your_very_secure_password_here';
ALTER ROLE survey_user SET client_encoding TO 'utf8';
ALTER ROLE survey_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE survey_user SET default_transaction_deferrable TO on;
GRANT ALL PRIVILEGES ON DATABASE survey_db TO survey_user;
\q
```

### Step 3: Deploy Application

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/your-repo/artificial_news_imagery.git
sudo chown -R $USER:$USER artificial_news_imagery

# Setup Python environment
cd artificial_news_imagery/evaluation/survey_backend
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install gunicorn

# Create .env file with production settings
cat > .env << EOF
FLASK_ENV=production
DEBUG=False
DATABASE_URL=postgresql://survey_user:your_very_secure_password_here@localhost:5432/survey_db
SECRET_KEY=your_random_secret_key_here_at_least_32_chars
CORS_ORIGINS=https://yourdomain.com
API_PORT=5000
EOF

# Initialize database
python3 -c "from app import create_app; app = create_app(); app.app_context().push(); from models import db; db.create_all()"

deactivate
```

### Step 4: Create Gunicorn Service

**Create `/etc/systemd/system/survey-api.service`:**

```ini
[Unit]
Description=Survey Tool API (Gunicorn)
After=network.target postgresql.service

[Service]
Type=notify
User=www-data
WorkingDirectory=/opt/artificial_news_imagery/evaluation/survey_backend
Environment="PATH=/opt/artificial_news_imagery/evaluation/survey_backend/venv/bin"
ExecStart=/opt/artificial_news_imagery/evaluation/survey_backend/venv/bin/gunicorn \
    --workers 4 \
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

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable survey-api
sudo systemctl start survey-api
sudo systemctl status survey-api
```

### Step 5: Configure Nginx

**Create `/etc/nginx/sites-available/survey`:**

```nginx
upstream gunicorn_backend {
    server unix:/run/gunicorn.sock fail_timeout=0;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    client_max_body_size 10M;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    client_max_body_size 10M;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Compression
    gzip on;
    gzip_types text/plain text/css text/javascript application/json;

    # Frontend - serve static files
    location / {
        root /opt/artificial_news_imagery/evaluation/survey_tool;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }

    # API backend proxy
    location /api/ {
        proxy_pass http://gunicorn_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }

    # Serve images efficiently
    location /sample_100/ {
        root /opt/artificial_news_imagery/evaluation/survey_tool;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
}
```

**Enable and start Nginx:**

```bash
sudo ln -s /etc/nginx/sites-available/survey /etc/nginx/sites-enabled/
sudo nginx -t  # Test config
sudo systemctl restart nginx
```

### Step 6: Setup SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install -y certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renew will be configured automatically
sudo systemctl enable certbot.timer
```

### Step 7: Verify Deployment

```bash
# Check all services are running
sudo systemctl status survey-api
sudo systemctl status nginx
sudo systemctl status postgresql

# Test API endpoint
curl https://yourdomain.com/api/v1/sessions/

# Check logs
sudo journalctl -u survey-api -f
tail -f /var/log/gunicorn_error.log
tail -f /var/log/nginx/error.log
```

### Monitoring & Maintenance

**Check memory/CPU usage:**
```bash
# Install monitoring tools
sudo apt install -y htop

# Monitor real-time
htop

# Check disk space
df -h
```

**Database backups (daily at 2 AM):**

```bash
# Create backup script
cat > /usr/local/bin/backup-survey-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups"
mkdir -p $BACKUP_DIR
pg_dump -U survey_user survey_db | gzip > $BACKUP_DIR/survey_db_$(date +%Y%m%d_%H%M%S).sql.gz
# Keep only last 30 days
find $BACKUP_DIR -name "survey_db_*.sql.gz" -mtime +30 -delete
EOF

sudo chmod +x /usr/local/bin/backup-survey-db.sh

# Add to crontab
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-survey-db.sh
```

**Log rotation:**

```bash
# Create `/etc/logrotate.d/survey-api`:
/var/log/gunicorn_*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
}
```

### Scaling Beyond 50 Users

If you need to handle more than 50 concurrent users:

1. **Add Gunicorn workers** - Adjust `--workers` parameter (cores × 2 + 1)
2. **Second app server** - Add another VPS, use load balancer
3. **Database optimization** - Add indexes, archive old data
4. **CDN** - Serve images from CloudFlare (reduces API load)

---

## Next Steps

1. ✅ **Backend API** - Complete
2. 🔄 **Update Frontend** - Modify survey tool to use API instead of localStorage
3. 🔄 **Admin Dashboard** - Build web UI for admins
4. 🔄 **User Authentication** - Add login system
5. 🔄 **Testing** - Write unit and integration tests
6. 🔄 **Deployment** - Deploy to production server (see guide above)

