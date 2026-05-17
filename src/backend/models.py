from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import uuid

db = SQLAlchemy()

class Session(db.Model):
    """User session for survey tracking"""
    __tablename__ = 'sessions'
    
    id = db.Column(db.String(100), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_sample_index = db.Column(db.Integer, default=0)
    last_sample_id = db.Column(db.Integer, nullable=True)  # Current article being rated
    last_stage = db.Column(db.Integer, default=1)
    is_completed = db.Column(db.Boolean, default=False)
    total_points = db.Column(db.Integer, default=0)  # Gamification: accumulated points from source guesses
    
    # Relationships
    ratings = db.relationship('Rating', backref='session', lazy=True, cascade='all, delete-orphan')
    demographics = db.relationship('Demographic', backref='session', lazy=True, cascade='all, delete-orphan', uselist=False)
    finalist_selections = db.relationship('FinalistSelection', backref='session', lazy=True, cascade='all, delete-orphan')
    stage_best_images = db.relationship('StageBestImage', backref='session', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_sample_index': self.last_sample_index,
            'last_sample_id': self.last_sample_id,
            'last_stage': self.last_stage,
            'is_completed': self.is_completed,
            'total_points': self.total_points,
            'rating_count': len(self.ratings)
        }

class Rating(db.Model):
    """Individual rating for an image"""
    __tablename__ = 'ratings'
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), db.ForeignKey('sessions.id'), nullable=False)
    sample_id = db.Column(db.Integer, nullable=False)  # From metadata
    stage = db.Column(db.Integer, nullable=False)  # 1-5
    card_index = db.Column(db.Integer, nullable=False)  # 0-6
    criterion = db.Column(db.String(1), nullable=False)  # 'a'=Relevance, 'b'=Real-like, 'c'=Accuracy, 'd'=Source Guess
    rating = db.Column(db.Integer, nullable=False)  # 1-5 for stars, 1-2 for binary
    notes = db.Column(db.Text, nullable=True)
    
    # Metadata for thesis analysis - captured at rating time
    image_model = db.Column(db.String(100), nullable=True)  # 'original' or model name (e.g., 'gemini_2_5_flash')
    caption_model = db.Column(db.String(100), nullable=True)  # 'original' or model name (e.g., 'gemini_2_5_pro')
    image_path = db.Column(db.String(500), nullable=True)  # File path for reproducibility
    caption_text = db.Column(db.Text, nullable=True)  # The actual caption shown to user
    
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Unique constraint to prevent duplicate ratings
    __table_args__ = (
        db.UniqueConstraint('session_id', 'sample_id', 'stage', 'card_index', 'criterion', name='unique_rating'),
    )
    
    def to_dict(self):
        return {
            'id': self.id,
            'session_id': self.session_id,
            'sample_id': self.sample_id,
            'stage': self.stage,
            'card_index': self.card_index,
            'criterion': self.criterion,
            'rating': self.rating,
            'notes': self.notes,
            'image_model': self.image_model,
            'caption_model': self.caption_model,
            'image_path': self.image_path,
            'caption_text': self.caption_text,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

class Demographic(db.Model):
    """User demographic information collected at survey start"""
    __tablename__ = 'demographics'
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), db.ForeignKey('sessions.id'), nullable=False, unique=True)
    age = db.Column(db.String(50), nullable=False)
    occupation = db.Column(db.String(100), nullable=False)
    education = db.Column(db.String(100), nullable=False)
    ai_experience = db.Column(db.String(50), nullable=False)
    ai_stance = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'session_id': self.session_id,
            'age': self.age,
            'occupation': self.occupation,
            'education': self.education,
            'ai_experience': self.ai_experience,
            'ai_stance': self.ai_stance,
            'created_at': self.created_at.isoformat()
        }

class FinalistSelection(db.Model):
    """User's selection of best image for a sample/article"""
    __tablename__ = 'finalist_selections'
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), db.ForeignKey('sessions.id'), nullable=False)
    sample_id = db.Column(db.Integer, nullable=False)  # Article ID
    selected_card_index = db.Column(db.Integer, nullable=False)  # 0-4 (which of the 5 finalists)
    selected_stage = db.Column(db.Integer, nullable=False)  # 1-5 (which stage was the selected image from)
    
    # Metadata for thesis analysis - snapshot of what was selected
    image_model = db.Column(db.String(100), nullable=True)  # 'original' or model name
    caption_model = db.Column(db.String(100), nullable=True)  # 'original' or model name
    image_path = db.Column(db.String(500), nullable=True)  # File path for reproducibility
    caption_text = db.Column(db.Text, nullable=True)  # The caption of selected image
    
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    # Unique constraint: one selection per user per article
    __table_args__ = (
        db.UniqueConstraint('session_id', 'sample_id', name='unique_finalist_selection'),
    )
    
    def to_dict(self):
        return {
            'id': self.id,
            'session_id': self.session_id,
            'sample_id': self.sample_id,
            'selected_card_index': self.selected_card_index,
            'selected_stage': self.selected_stage,
            'image_model': self.image_model,
            'caption_model': self.caption_model,
            'image_path': self.image_path,
            'caption_text': self.caption_text,
            'created_at': self.created_at.isoformat()
        }

class StageBestImage(db.Model):
    """Best-rated image for each stage (1-5) of each sample for each session"""
    __tablename__ = 'stage_best_images'
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), db.ForeignKey('sessions.id'), nullable=False)
    sample_id = db.Column(db.Integer, nullable=False)  # Article ID
    stage = db.Column(db.Integer, nullable=False)  # 1-5
    best_card_index = db.Column(db.Integer, nullable=False)  # 0-6, which image was best
    average_rating = db.Column(db.Float, nullable=False)  # Average of 3 criteria
    
    # Metadata for thesis analysis - snapshot of best image
    image_model = db.Column(db.String(100), nullable=True)  # 'original' or model name
    caption_model = db.Column(db.String(100), nullable=True)  # 'original' or model name
    image_path = db.Column(db.String(500), nullable=True)  # File path for reproducibility
    caption_text = db.Column(db.Text, nullable=True)  # The caption of best image
    
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    # Unique constraint: one best image per stage per sample per session
    __table_args__ = (
        db.UniqueConstraint('session_id', 'sample_id', 'stage', name='unique_stage_best_image'),
    )
    
    def to_dict(self):
        return {
            'id': self.id,
            'session_id': self.session_id,
            'sample_id': self.sample_id,
            'stage': self.stage,
            'best_card_index': self.best_card_index,
            'average_rating': round(self.average_rating, 2),
            'image_model': self.image_model,
            'caption_model': self.caption_model,
            'image_path': self.image_path,
            'caption_text': self.caption_text,
            'created_at': self.created_at.isoformat()
        }

class User(db.Model):
    """Admin user for dashboard access"""
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_admin': self.is_admin,
            'created_at': self.created_at.isoformat()
        }

class ArticleMetadata(db.Model):
    """Metadata for survey articles/samples loaded from JSON"""
    __tablename__ = 'article_metadata'
    
    id = db.Column(db.Integer, primary_key=True)
    sample_id = db.Column(db.Integer, unique=True, nullable=False, index=True)  # Article ID (157840, 765090, etc)
    caption = db.Column(db.Text, nullable=False)  # Original caption
    topic = db.Column(db.String(100), nullable=False)  # Topic category
    source = db.Column(db.String(50), nullable=False)  # Article source (washington_post, bbc, guardian, usa_today)
    image_path = db.Column(db.String(300), nullable=False)  # Original image path
    article_path = db.Column(db.String(300), nullable=False)  # Path to full article text
    metadata_json = db.Column(db.JSON, nullable=False)  # Full complex nested structure from JSON
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'sample_id': self.sample_id,
            'caption': self.caption,
            'topic': self.topic,
            'source': self.source,
            'image_path': self.image_path,
            'article_path': self.article_path,
            'metadata_json': self.metadata_json,
            'created_at': self.created_at.isoformat()
        }
