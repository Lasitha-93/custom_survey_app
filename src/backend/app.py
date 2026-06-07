import os
from dotenv import load_dotenv

# Load environment variables BEFORE importing config (which reads env vars at class definition time)
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path)

from flask import Flask
from flask_cors import CORS
from config import config
from models import db
import json
from pathlib import Path

def initialize_article_metadata():
    """
    Initialize article metadata from JSON file if not already loaded.
    Called on app startup for fresh database initialization.
    """
    from models import ArticleMetadata
    
    try:
        # Check if metadata is already loaded
        existing_count = ArticleMetadata.query.count()
        if existing_count > 0:
            print(f'[initialize_metadata] ✓ Database already contains {existing_count} metadata records')
            return True
        
        # Find the JSON file
        json_path = Path(__file__).parent / 'data' / 'evaluation_sample_100_meta_data.json'
        
        if not json_path.exists():
            print(f'[initialize_metadata] ⚠ Metadata JSON file not found at {json_path}')
            print(f'[initialize_metadata] Skipping metadata initialization')
            return False
        
        print(f'[initialize_metadata] Loading metadata from: {json_path}')
        
        with open(json_path, 'r', encoding='utf-8') as f:
            metadata_list = json.load(f)
        
        print(f'[initialize_metadata] Loaded {len(metadata_list)} articles from JSON')
        
        # Load each article into database
        loaded_count = 0
        
        for idx, article in enumerate(metadata_list):
            try:
                sample_id = article.get('id')
                
                # Create new record
                metadata_record = ArticleMetadata(
                    sample_id=sample_id,
                    caption=article.get('caption', ''),
                    topic=article.get('topic', ''),
                    source=article.get('source', ''),
                    image_path=article.get('image_path', ''),
                    article_path=article.get('article_path', ''),
                    metadata_json=article  # Store full structure
                )
                
                db.session.add(metadata_record)
                loaded_count += 1
                
                # Commit every 10 records for progress
                if (idx + 1) % 10 == 0:
                    db.session.commit()
                    print(f'[initialize_metadata] • Loaded {loaded_count} records...')
            
            except Exception as e:
                print(f'[initialize_metadata] ✗ ERROR loading article {idx}: {e}')
                db.session.rollback()
                continue
        
        # Final commit
        db.session.commit()
        print(f'[initialize_metadata] ✓ Successfully loaded {loaded_count} metadata records')
        print(f'[initialize_metadata] ✓ Total articles in database: {ArticleMetadata.query.count()}')
        return True
        
    except Exception as e:
        print(f'[initialize_metadata] ✗ ERROR: {e}')
        db.session.rollback()
        return False

def create_app(config_name=None):
    """Application factory"""
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'development')
    
    app = Flask(__name__)
    app.config.from_object(config[config_name])
    
    # Initialize extensions
    db.init_app(app)
    CORS(app, origins=app.config['CORS_ORIGINS'])
    
    # Register blueprints
    from routes.ratings import ratings_bp
    from routes.sessions import sessions_bp
    from routes.admin import admin_bp
    from routes.demographics import demographics_bp
    from routes.finalists import finalists_bp
    
    app.register_blueprint(ratings_bp, url_prefix='/api/v1/ratings')
    app.register_blueprint(sessions_bp, url_prefix='/api/v1/sessions')
    app.register_blueprint(admin_bp, url_prefix='/api/v1/admin')
    app.register_blueprint(demographics_bp, url_prefix='/api/v1/demographics')
    app.register_blueprint(finalists_bp, url_prefix='/api/v1/finalists')
    
    # Create tables and initialize metadata
    with app.app_context():
        db.create_all()
        print('[app] ✓ Database tables created')
        
        # Initialize article metadata from JSON if needed
        print('[app] Initializing article metadata...')
        initialize_article_metadata()
    
    # Initialize Plotly Dash admin dashboard
    from dashboard import create_dash_app
    create_dash_app(app)
    
    # Health check endpoint
    @app.route('/health', methods=['GET'])
    def health_check():
        return {'status': 'ok'}, 200
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
