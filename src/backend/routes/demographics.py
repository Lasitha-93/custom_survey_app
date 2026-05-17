from flask import Blueprint, request, jsonify
from models import db, Demographic, Session
from datetime import datetime
from sqlalchemy.exc import IntegrityError

demographics_bp = Blueprint('demographics', __name__)

@demographics_bp.route('/', methods=['POST'])
def create_demographic():
    """Create demographic data for a new user"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['session_id', 'age', 'occupation', 'education', 'ai_experience', 'ai_stance']
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
        
        # Check if demographics already exist for this session
        existing_demo = Demographic.query.filter_by(session_id=data['session_id']).first()
        if existing_demo:
            return jsonify({
                'success': False,
                'error': 'Demographics already exist for this session'
            }), 400
        
        # Create new demographic record
        demographic = Demographic(
            session_id=data['session_id'],
            age=data['age'],
            occupation=data['occupation'],
            education=data['education'],
            ai_experience=data['ai_experience'],
            ai_stance=data['ai_stance']
        )
        
        db.session.add(demographic)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Demographics saved successfully',
            'demographic': demographic.to_dict()
        }), 201
        
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': 'Demographic data conflict. Demographics may already exist for this session.'
        }), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@demographics_bp.route('/<session_id>', methods=['GET'])
def get_demographic(session_id):
    """Retrieve demographic data for a session"""
    try:
        demographic = Demographic.query.filter_by(session_id=session_id).first()
        
        if not demographic:
            return jsonify({
                'success': False,
                'error': 'Demographics not found for this session'
            }), 404
        
        return jsonify({
            'success': True,
            'demographic': demographic.to_dict()
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@demographics_bp.route('/<session_id>', methods=['PUT'])
def update_demographic(session_id):
    """Update demographic data (in case of correction)"""
    try:
        demographic = Demographic.query.filter_by(session_id=session_id).first()
        
        if not demographic:
            return jsonify({
                'success': False,
                'error': 'Demographics not found for this session'
            }), 404
        
        data = request.get_json()
        
        # Update fields if provided
        if 'age' in data:
            demographic.age = data['age']
        if 'occupation' in data:
            demographic.occupation = data['occupation']
        if 'education' in data:
            demographic.education = data['education']
        if 'ai_experience' in data:
            demographic.ai_experience = data['ai_experience']
        if 'ai_stance' in data:
            demographic.ai_stance = data['ai_stance']
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Demographics updated successfully',
            'demographic': demographic.to_dict()
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
