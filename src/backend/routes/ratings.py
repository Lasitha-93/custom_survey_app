from flask import Blueprint, request, jsonify
from models import db, Rating, Session
from datetime import datetime
from sqlalchemy.exc import IntegrityError

ratings_bp = Blueprint('ratings', __name__)

@ratings_bp.route('/', methods=['POST'])
def create_rating():
    """Create or update a rating"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['session_id', 'sample_id', 'stage', 'card_index', 'criterion', 'rating']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields'
            }), 400
        
        # Validate session exists
        session = Session.query.get(data['session_id'])
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404
        
        # Try to find existing rating
        existing_rating = Rating.query.filter_by(
            session_id=data['session_id'],
            sample_id=data['sample_id'],
            stage=data['stage'],
            card_index=data['card_index'],
            criterion=data['criterion']
        ).first()
        
        if existing_rating:
            # Update existing rating
            existing_rating.rating = data['rating']
            existing_rating.notes = data.get('notes')
            existing_rating.image_model = data.get('image_model')
            existing_rating.caption_model = data.get('caption_model')
            existing_rating.image_path = data.get('image_path')
            existing_rating.caption_text = data.get('caption_text')
            existing_rating.updated_at = datetime.utcnow()
            rating = existing_rating
        else:
            # Create new rating
            rating = Rating(
                session_id=data['session_id'],
                sample_id=data['sample_id'],
                stage=data['stage'],
                card_index=data['card_index'],
                criterion=data['criterion'],
                rating=data['rating'],
                notes=data.get('notes'),
                image_model=data.get('image_model'),
                caption_model=data.get('caption_model'),
                image_path=data.get('image_path'),
                caption_text=data.get('caption_text')
            )
            db.session.add(rating)
        
        # Update session timestamp
        session.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'rating': rating.to_dict()
        }), 201 if not existing_rating else 200
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': 'Rating already exists'
        }), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@ratings_bp.route('/<int:rating_id>', methods=['GET'])
def get_rating(rating_id):
    """Get a specific rating"""
    try:
        rating = Rating.query.get(rating_id)
        if not rating:
            return jsonify({
                'success': False,
                'error': 'Rating not found'
            }), 404
        
        return jsonify({
            'success': True,
            'rating': rating.to_dict()
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@ratings_bp.route('/<int:rating_id>', methods=['PUT'])
def update_rating(rating_id):
    """Update a rating"""
    try:
        rating = Rating.query.get(rating_id)
        if not rating:
            return jsonify({
                'success': False,
                'error': 'Rating not found'
            }), 404
        
        data = request.get_json()
        
        if 'rating' in data:
            rating.rating = data['rating']
        if 'notes' in data:
            rating.notes = data['notes']
        
        rating.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'rating': rating.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@ratings_bp.route('/<int:rating_id>', methods=['DELETE'])
def delete_rating(rating_id):
    """Delete a rating"""
    try:
        rating = Rating.query.get(rating_id)
        if not rating:
            return jsonify({
                'success': False,
                'error': 'Rating not found'
            }), 404
        
        db.session.delete(rating)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Rating deleted'
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@ratings_bp.route('/session/<session_id>/sample/<int:sample_id>/stage/<int:stage>', methods=['GET'])
def get_stage_ratings(session_id, sample_id, stage):
    """Get all ratings for a specific stage of a sample"""
    try:
        ratings = Rating.query.filter_by(
            session_id=session_id,
            sample_id=sample_id,
            stage=stage
        ).all()
        
        return jsonify({
            'success': True,
            'ratings': [r.to_dict() for r in ratings]
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
