from flask import Blueprint, request, jsonify
from models import db, Rating, Session, User
from sqlalchemy import func
import csv
from io import StringIO
from datetime import datetime, timedelta
import time

admin_bp = Blueprint('admin', __name__)

# Simple caching without external dependencies
_dashboard_cache = {
    'data': None,
    'timestamp': None,
    'ttl': 30  # 30 seconds
}

def get_cached_dashboard_data():
    """Get cached dashboard data, or refresh if expired"""
    now = time.time()
    
    # Check if cache is still valid
    if (_dashboard_cache['data'] is not None and 
        _dashboard_cache['timestamp'] is not None and
        (now - _dashboard_cache['timestamp']) < _dashboard_cache['ttl']):
        return _dashboard_cache['data']
    
    # Cache expired or empty, compute fresh data
    data = _compute_dashboard_data()
    _dashboard_cache['data'] = data
    _dashboard_cache['timestamp'] = now
    return data

def _compute_dashboard_data():
    """Compute all dashboard data efficiently in one pass"""
    try:
        # Stats
        total_sessions = Session.query.count()
        completed_sessions = Session.query.filter_by(is_completed=True).count()
        total_ratings = Rating.query.count()
        
        # Ratings by stage
        ratings_by_stage = db.session.query(Rating.stage, func.count(Rating.id)).group_by(Rating.stage).all()
        ratings_by_stage_dict = {str(stage): count for stage, count in ratings_by_stage}
        
        # Ratings by criterion
        ratings_by_criterion = db.session.query(Rating.criterion, func.count(Rating.id)).group_by(Rating.criterion).all()
        ratings_by_criterion_dict = {criterion: count for criterion, count in ratings_by_criterion}
        
        # Average ratings by criterion
        avg_by_criterion = db.session.query(Rating.criterion, func.avg(Rating.rating)).group_by(Rating.criterion).all()
        avg_by_criterion_dict = {criterion: round(float(avg) if avg else 0, 2) for criterion, avg in avg_by_criterion}
        
        # Top samples by rating count
        sample_rating_counts = db.session.query(
            Rating.sample_id,
            func.count(Rating.id).label('rating_count')
        ).group_by(Rating.sample_id).order_by(func.count(Rating.id).desc()).limit(30).all()
        
        top_samples = [{'sample_id': s[0], 'count': s[1]} for s in sample_rating_counts]
        
        # Recent sessions (last 10)
        recent_sessions = Session.query.order_by(Session.created_at.desc()).limit(10).all()
        recent_sessions_data = [s.to_dict() for s in recent_sessions]
        
        return {
            'success': True,
            'stats': {
                'total_sessions': total_sessions,
                'completed_sessions': completed_sessions,
                'active_sessions': total_sessions - completed_sessions,
                'total_ratings': total_ratings,
                'avg_per_session': round(total_ratings / max(total_sessions, 1), 1),
                'ratings_by_stage': ratings_by_stage_dict,
                'ratings_by_criterion': ratings_by_criterion_dict,
                'average_by_criterion': avg_by_criterion_dict
            },
            'top_samples': top_samples,
            'recent_sessions': recent_sessions_data,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

@admin_bp.route('/dashboard-data', methods=['GET'])
def get_dashboard_data():
    """Optimized endpoint for dashboard - returns all needed data in one call with caching"""
    data = get_cached_dashboard_data()
    return jsonify(data), 200 if data.get('success') else 500

@admin_bp.route('/stats', methods=['GET'])
def get_stats():
    """Get overall survey statistics"""
    try:
        total_sessions = Session.query.count()
        completed_sessions = Session.query.filter_by(is_completed=True).count()
        total_ratings = Rating.query.count()
        
        # Ratings by stage
        ratings_by_stage = db.session.query(Rating.stage, func.count(Rating.id)).group_by(Rating.stage).all()
        
        # Ratings by criterion
        ratings_by_criterion = db.session.query(Rating.criterion, func.count(Rating.id)).group_by(Rating.criterion).all()
        
        # Average ratings by criterion
        avg_by_criterion = db.session.query(Rating.criterion, func.avg(Rating.rating)).group_by(Rating.criterion).all()
        
        return jsonify({
            'success': True,
            'stats': {
                'total_sessions': total_sessions,
                'completed_sessions': completed_sessions,
                'active_sessions': total_sessions - completed_sessions,
                'total_ratings': total_ratings,
                'ratings_by_stage': {stage: count for stage, count in ratings_by_stage},
                'ratings_by_criterion': {criterion: count for criterion, count in ratings_by_criterion},
                'average_by_criterion': {criterion: float(avg) for criterion, avg in avg_by_criterion}
            }
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@admin_bp.route('/sessions', methods=['GET'])
def list_sessions():
    """List all sessions with pagination"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        sessions_query = Session.query.order_by(Session.created_at.desc())
        paginated = sessions_query.paginate(page=page, per_page=per_page, error_out=False)
        
        return jsonify({
            'success': True,
            'sessions': [s.to_dict() for s in paginated.items],
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': paginated.total,
                'pages': paginated.pages
            }
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@admin_bp.route('/ratings', methods=['GET'])
def list_ratings():
    """List ratings with filters"""
    try:
        session_id = request.args.get('session_id')
        sample_id = request.args.get('sample_id', type=int)
        stage = request.args.get('stage', type=int)
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        
        query = Rating.query
        if session_id:
            query = query.filter_by(session_id=session_id)
        if sample_id:
            query = query.filter_by(sample_id=sample_id)
        if stage:
            query = query.filter_by(stage=stage)
        
        paginated = query.order_by(Rating.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
        
        return jsonify({
            'success': True,
            'ratings': [r.to_dict() for r in paginated.items],
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': paginated.total,
                'pages': paginated.pages
            }
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@admin_bp.route('/export/csv', methods=['GET'])
def export_csv():
    """Export all ratings as CSV"""
    try:
        ratings = Rating.query.all()
        
        output = StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow(['ID', 'Session ID', 'Sample ID', 'Stage', 'Card Index', 'Criterion', 'Rating', 'Notes', 'Created At', 'Updated At'])
        
        # Data
        for rating in ratings:
            writer.writerow([
                rating.id,
                rating.session_id,
                rating.sample_id,
                rating.stage,
                rating.card_index,
                rating.criterion,
                rating.rating,
                rating.notes,
                rating.created_at.isoformat(),
                rating.updated_at.isoformat()
            ])
        
        return output.getvalue(), 200, {
            'Content-Disposition': 'attachment; filename=survey_ratings.csv',
            'Content-Type': 'text/csv'
        }
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@admin_bp.route('/export/json', methods=['GET'])
def export_json():
    """Export all ratings as JSON"""
    try:
        ratings = Rating.query.all()
        sessions = Session.query.all()
        
        return jsonify({
            'success': True,
            'sessions': [s.to_dict() for s in sessions],
            'ratings': [r.to_dict() for r in ratings]
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
