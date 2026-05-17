import os
from datetime import timedelta

class Config:
    """Base configuration"""
    # Database
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        db_url = 'postgresql://survey_user:survey_password@localhost:5432/survey_db'
    SQLALCHEMY_DATABASE_URI = db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Session
    PERMANENT_SESSION_LIFETIME = timedelta(days=30)
    SESSION_COOKIE_SECURE = False  # Set to True in production with HTTPS
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    
    # API
    JSON_SORT_KEYS = False
    JSONIFY_PRETTYPRINT_REGULAR = True
    
    # CORS (read from env var; fallback to localhost defaults)
    _cors_env = os.getenv('CORS_ORIGINS', '')
    CORS_ORIGINS = [o.strip() for o in _cors_env.split(',') if o.strip()] or ['http://localhost:8000', 'http://localhost:3000']

class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    TESTING = False

class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    TESTING = False
    SESSION_COOKIE_SECURE = True

config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
