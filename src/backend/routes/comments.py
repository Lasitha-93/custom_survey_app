from flask import Blueprint, request, jsonify
from models import db, CardComment, Session
from datetime import datetime
from sqlalchemy.exc import IntegrityError

comments_bp = Blueprint('comments', __name__)

MAX_COMMENT_LENGTH = 500


@comments_bp.route('/', methods=['POST'])
def upsert_comment():
    """Create, update, or delete a card comment (upsert by session_id+sample_id+stage+card_index)"""
    try:
        data = request.get_json()

        required_fields = ['session_id', 'sample_id', 'stage', 'card_index']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields'
            }), 400

        session = Session.query.get(data['session_id'])
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404

        comment_text = (data.get('comment_text') or '').strip()

        if len(comment_text) > MAX_COMMENT_LENGTH:
            return jsonify({
                'success': False,
                'error': f'Comment exceeds {MAX_COMMENT_LENGTH} character limit'
            }), 400

        existing_comment = CardComment.query.filter_by(
            session_id=data['session_id'],
            sample_id=data['sample_id'],
            stage=data['stage'],
            card_index=data['card_index']
        ).first()

        # Empty comment: delete existing row if present, otherwise no-op
        if not comment_text:
            if existing_comment:
                db.session.delete(existing_comment)
                db.session.commit()
            return jsonify({
                'success': True,
                'comment': None
            }), 200

        if existing_comment:
            existing_comment.comment_text = comment_text
            existing_comment.updated_at = datetime.utcnow()
            comment = existing_comment
            status_code = 200
        else:
            comment = CardComment(
                session_id=data['session_id'],
                sample_id=data['sample_id'],
                stage=data['stage'],
                card_index=data['card_index'],
                comment_text=comment_text
            )
            db.session.add(comment)
            status_code = 201

        db.session.commit()

        return jsonify({
            'success': True,
            'comment': comment.to_dict()
        }), status_code
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': 'Comment already exists'
        }), 409
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@comments_bp.route('/<session_id>', methods=['GET'])
def get_comments(session_id):
    """Get all card comments for a session (used to restore UI state on page reload)"""
    try:
        session = Session.query.get(session_id)
        if not session:
            return jsonify({
                'success': False,
                'error': 'Session not found'
            }), 404

        comments = CardComment.query.filter_by(session_id=session_id).all()

        return jsonify({
            'success': True,
            'comments': [c.to_dict() for c in comments]
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
