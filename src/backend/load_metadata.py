"""
Load article metadata from JSON file into the database.
Run this once to initialize the article_metadata table.
"""
import json
import os
import sys
from pathlib import Path
from app import app, db
from models import ArticleMetadata

def load_metadata_from_json():
    """
    Load metadata from the JSON file into the database.
    Creates records for each article.
    """
    # Path to the metadata JSON file
    json_path = Path(__file__).parent / 'data' / 'evaluation_sample_100_meta_data.json'
    
    print(f'[load_metadata] Loading metadata from: {json_path}')
    
    if not json_path.exists():
        print(f'[load_metadata] ERROR: File not found at {json_path}')
        return False
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            metadata_list = json.load(f)
        
        print(f'[load_metadata] Loaded {len(metadata_list)} articles from JSON')
    except Exception as e:
        print(f'[load_metadata] ERROR reading JSON file: {e}')
        return False
    
    with app.app_context():
        # Check if metadata is already loaded
        existing_count = ArticleMetadata.query.count()
        if existing_count > 0:
            print(f'[load_metadata] Database already contains {existing_count} metadata records')
            response = input('Clear existing metadata and reload? (yes/no): ').strip().lower()
            if response == 'yes':
                print('[load_metadata] Clearing existing metadata...')
                ArticleMetadata.query.delete()
                db.session.commit()
            else:
                print('[load_metadata] Aborting metadata load')
                return False
        
        # Load each article into database
        loaded_count = 0
        skipped_count = 0
        
        for idx, article in enumerate(metadata_list):
            try:
                sample_id = article.get('id')
                
                # Check if already exists
                existing = ArticleMetadata.query.filter_by(sample_id=sample_id).first()
                if existing:
                    print(f'[load_metadata] Skipping article {sample_id} (already exists)')
                    skipped_count += 1
                    continue
                
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
                    print(f'[load_metadata] Loaded {loaded_count} records so far...')
            
            except Exception as e:
                print(f'[load_metadata] ERROR loading article {idx}: {e}')
                db.session.rollback()
                continue
        
        # Final commit
        try:
            db.session.commit()
            print(f'[load_metadata] Successfully loaded {loaded_count} metadata records')
            print(f'[load_metadata] Skipped {skipped_count} existing records')
            print(f'[load_metadata] Total articles in database: {ArticleMetadata.query.count()}')
            return True
        except Exception as e:
            print(f'[load_metadata] ERROR committing to database: {e}')
            db.session.rollback()
            return False

if __name__ == '__main__':
    print('=' * 60)
    print('Article Metadata Loader')
    print('=' * 60)
    success = load_metadata_from_json()
    sys.exit(0 if success else 1)
