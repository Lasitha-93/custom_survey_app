from flask import Blueprint, request, jsonify
from models import db, Session, Rating, FinalistSelection
from datetime import datetime

sessions_bp = Blueprint('sessions', __name__)

@sessions_bp.route('/', methods=['POST'])
def create_session():
    """Create a new survey session"""
    try:
        session = Session()
        db.session.add(session)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'session': session.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@sessions_bp.route('/<session_id>', methods=['GET'])
def get_session(session_id):
    """Get session details and progress"""
    try:
        session = Session.query.get(session_id)
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
        
        # Count ratings by stage
        rating_stats = db.session.query(Rating.stage, db.func.count(Rating.id)).filter_by(session_id=session_id).group_by(Rating.stage).all()
        
        # Get completed sample IDs (those with finalist selections)
        completed_samples = db.session.query(FinalistSelection.sample_id).filter_by(
            session_id=session_id
        ).all()
        completed_sample_ids = [row[0] for row in completed_samples]
        
        return jsonify({
            'success': True,
            'session': session.to_dict(),
            'rating_stats': {stage: count for stage, count in rating_stats},
            'completed_sample_ids': completed_sample_ids
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@sessions_bp.route('/<session_id>', methods=['PUT'])
def update_session(session_id):
    """Update session progress"""
    try:
        session = Session.query.get(session_id)
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
        
        data = request.get_json()
        
        if 'last_sample_index' in data:
            session.last_sample_index = data['last_sample_index']
        if 'last_sample_id' in data:
            session.last_sample_id = data['last_sample_id']
        if 'last_stage' in data:
            session.last_stage = data['last_stage']
        if 'is_completed' in data:
            session.is_completed = data['is_completed']
        if 'total_points' in data:
            session.total_points = data['total_points']
        
        session.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'session': session.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@sessions_bp.route('/<session_id>/ratings', methods=['GET'])
def get_session_ratings(session_id):
    """Get all ratings for a session"""
    try:
        session = Session.query.get(session_id)
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
        
        # Get stage and sample filters from query params
        stage = request.args.get('stage', type=int)
        sample_id = request.args.get('sample_id', type=int)
        
        query = Rating.query.filter_by(session_id=session_id)
        if stage:
            query = query.filter_by(stage=stage)
        if sample_id:
            query = query.filter_by(sample_id=sample_id)
        
        ratings = query.all()
        
        return jsonify({
            'success': True,
            'ratings': [r.to_dict() for r in ratings]
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@sessions_bp.route('/<session_id>/least-rated-article', methods=['GET'])
def get_least_rated_article(session_id):
    """
    Intelligent article selection with three-phase logic:
    
    Phase 0 (Resume): Get incomplete articles for this session (mid-survey reloads)
    Phase 1 (Coverage): Get fresh articles (in metadata but not yet rated)
    Phase 2 (Balancing): If no fresh articles, get least-rated articles
    
    Query params:
    - exclude_samples: comma-separated list of sample_ids to exclude (already shown in this session)
    - limit: max number of samples to get (default 1)
    """
    try:
        from models import ArticleMetadata
        from sqlalchemy import func
        
        session = Session.query.get(session_id)
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
        
        # Get excluded samples from query params
        exclude_samples_str = request.args.get('exclude_samples', '')
        exclude_samples = [int(s) for s in exclude_samples_str.split(',') if s.strip().isdigit()] if exclude_samples_str else []
        limit = request.args.get('limit', 1, type=int)
        
        # PHASE 0: Resume - Find incomplete articles for this session (page reload recovery)
        # ===================================================================================
        print(f'[get_least_rated_article] PHASE 0 (Resume): Checking for incomplete articles...')
        
        # Import FinalistSelection to check for completed articles
        from models import FinalistSelection
        
        # An article is "incomplete" if:
        # 1. It has ratings in this session (user has started it)
        # 2. It does NOT have a finalist_selection (user hasn't completed it)
        
        # Get all sample IDs that have ratings in this session
        samples_with_ratings = db.session.query(
            Rating.sample_id.distinct()
        ).filter_by(
            session_id=session_id
        ).all()
        
        samples_with_ratings = [row[0] for row in samples_with_ratings]
        
        if samples_with_ratings:
            # Check which ones have finalist selections
            completed_samples = db.session.query(
                FinalistSelection.sample_id.distinct()
            ).filter_by(
                session_id=session_id
            ).all()
            
            completed_samples = set(row[0] for row in completed_samples)
            
            # Find incomplete samples (have ratings but no finalist selection)
            incomplete_samples = [s for s in samples_with_ratings if s not in completed_samples]
            
            if incomplete_samples:
                # Get the last incomplete sample (most recent)
                # Also get the highest stage number with ratings for this sample
                incomplete_sample = incomplete_samples[-1]
                
                stage_info = db.session.query(
                    func.max(Rating.stage).label('max_stage'),
                    func.count(Rating.id).label('rating_count')
                ).filter_by(
                    session_id=session_id,
                    sample_id=incomplete_sample
                ).first()
                
                if stage_info and stage_info.max_stage:
                    stage = stage_info.max_stage
                    rating_count = stage_info.rating_count or 0
                    print(f'[get_least_rated_article] PHASE 0 (Resume): Found incomplete article {incomplete_sample} with ratings at stage {stage}')
                    
                    return jsonify({
                        'success': True,
                        'least_rated_articles': [{
                            'sample_id': incomplete_sample,
                            'stage': stage,
                            'rating_count': rating_count,
                            'phase': 'resume'
                        }],
                        'phase': 'resume'
                    }), 200
        
        print(f'[get_least_rated_article] PHASE 0 (Resume): No incomplete articles found')
        
        # PHASE 1: Coverage - Find fresh articles (in metadata but not in ratings)
        # ========================================================================
        
        # Get all sample IDs from metadata (exhaustive list)
        all_metadata_ids = db.session.query(ArticleMetadata.sample_id).all()
        all_metadata_ids = [row[0] for row in all_metadata_ids]
        
        if not all_metadata_ids:
            return jsonify({
                'success': False,
                'error': 'No articles in metadata table'
            }), 400
        
        # Get all sample IDs that have been rated
        rated_ids = db.session.query(Rating.sample_id.distinct()).all()
        rated_ids = [row[0] for row in rated_ids]
        
        # Fresh articles = metadata IDs that haven't been rated
        fresh_ids = set(all_metadata_ids) - set(rated_ids)
        
        # Exclude already-shown samples in this session
        fresh_ids = fresh_ids - set(exclude_samples)
        fresh_ids = list(fresh_ids)
        
        if fresh_ids:
            # We have fresh articles! Pick the first one(s)
            print(f'[get_least_rated_article] PHASE 1 (Coverage): Found {len(fresh_ids)} fresh articles')
            selected_ids = fresh_ids[:limit]
            articles = []
            for sample_id in selected_ids:
                articles.append({
                    'sample_id': sample_id,
                    'rating_count': 0,
                    'phase': 'coverage'
                })
            
            return jsonify({
                'success': True,
                'least_rated_articles': articles,
                'phase': 'coverage'
            }), 200
        
        # PHASE 2: Balancing - Find least-rated articles (when all have ≥1 rating)
        # ========================================================================
        print(f'[get_least_rated_article] PHASE 2 (Balancing): All articles have been rated at least once')
        
        # Subquery to count ratings per sample_id
        rating_counts = db.session.query(
            Rating.sample_id,
            func.count(Rating.id).label('rating_count')
        ).group_by(Rating.sample_id).subquery()
        
        # Query to get samples with their rating counts, sorted by rating count ascending
        query = db.session.query(
            rating_counts.c.sample_id,
            rating_counts.c.rating_count
        ).order_by(rating_counts.c.rating_count.asc())
        
        # Exclude already-shown samples
        if exclude_samples:
            query = query.filter(~rating_counts.c.sample_id.in_(exclude_samples))
        
        results = query.limit(limit).all()
        
        if not results:
            return jsonify({
                'success': True,
                'least_rated_articles': [],
                'phase': 'balancing',
                'message': 'All articles shown in this session'
            }), 200
        
        articles = []
        for sample_id, rating_count in results:
            articles.append({
                'sample_id': sample_id,
                'rating_count': rating_count,
                'phase': 'balancing'
            })
        
        return jsonify({
            'success': True,
            'least_rated_articles': articles,
            'phase': 'balancing'
        }), 200
        
    except Exception as e:
        print(f'[get_least_rated_article] ERROR: {str(e)}')
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
