from flask import Blueprint, request, jsonify
from models import db, Rating, FinalistSelection, StageBestImage
from sqlalchemy import func

finalists_bp = Blueprint('finalists', __name__)

@finalists_bp.route('/best-images/<session_id>/<int:sample_id>', methods=['GET'])
def get_best_images(session_id, sample_id):
    """
    Get the best-rated image from each stage (1-5) based on average of 3 criteria.
    Returns: List of 5 objects with stage, card_index, average_rating, and metadata
    """
    try:
        best_images = []
        
        # For each stage 1-5, find the image (card) with highest average rating
        for stage in range(1, 6):
            # Get all ratings for this stage/sample
            ratings = Rating.query.filter_by(
                session_id=session_id,
                sample_id=sample_id,
                stage=stage
            ).all()
            
            if not ratings:
                # If no ratings for this stage, skip
                continue
            
            # Group ratings by card_index
            card_ratings = {}
            card_metadata = {}  # Store metadata from first rating of each card
            for rating in ratings:
                # Only consider first 3 criteria (a, b, c) - skip 'd' (Source Guess)
                if rating.criterion in ['a', 'b', 'c']:
                    if rating.card_index not in card_ratings:
                        card_ratings[rating.card_index] = []
                        # Store metadata from this rating
                        card_metadata[rating.card_index] = {
                            'image_model': rating.image_model,
                            'caption_model': rating.caption_model,
                            'image_path': rating.image_path,
                            'caption_text': rating.caption_text
                        }
                    card_ratings[rating.card_index].append(rating.rating)
            
            # Calculate average for each card
            if card_ratings:
                best_card = max(
                    card_ratings.items(),
                    key=lambda x: sum(x[1]) / len(x[1])
                )
                card_index, ratings_list = best_card
                avg_rating = sum(ratings_list) / len(ratings_list)
                
                # Get metadata for the best card
                metadata = card_metadata.get(card_index, {})
                
                best_images.append({
                    'stage': stage,
                    'card_index': card_index,
                    'average_rating': round(avg_rating, 2),
                    'image_model': metadata.get('image_model'),
                    'caption_model': metadata.get('caption_model'),
                    'image_path': metadata.get('image_path'),
                    'caption_text': metadata.get('caption_text')
                })
        
        return jsonify({
            'success': True,
            'best_images': best_images
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@finalists_bp.route('/', methods=['POST'])
def save_finalist_selection():
    """
    Save user's selection of best image from finalists
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['session_id', 'sample_id', 'selected_card_index', 'selected_stage']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields'
            }), 400
        
        # Check if selection already exists
        existing = FinalistSelection.query.filter_by(
            session_id=data['session_id'],
            sample_id=data['sample_id']
        ).first()
        
        if existing:
            # Update existing selection
            existing.selected_card_index = data['selected_card_index']
            existing.selected_stage = data['selected_stage']
            existing.image_model = data.get('image_model')
            existing.caption_model = data.get('caption_model')
            existing.image_path = data.get('image_path')
            existing.caption_text = data.get('caption_text')
            db.session.commit()
        else:
            # Create new selection
            selection = FinalistSelection(
                session_id=data['session_id'],
                sample_id=data['sample_id'],
                selected_card_index=data['selected_card_index'],
                selected_stage=data['selected_stage'],
                image_model=data.get('image_model'),
                caption_model=data.get('caption_model'),
                image_path=data.get('image_path'),
                caption_text=data.get('caption_text')
            )
            db.session.add(selection)
            db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Finalist selection saved successfully',
            'selection': existing.to_dict() if existing else selection.to_dict()
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@finalists_bp.route('/<session_id>/<int:sample_id>', methods=['GET'])
def get_finalist_selection(session_id, sample_id):
    """
    Retrieve user's finalist selection for a sample
    """
    try:
        selection = FinalistSelection.query.filter_by(
            session_id=session_id,
            sample_id=sample_id
        ).first()
        
        if not selection:
            return jsonify({
                'success': False,
                'error': 'Finalist selection not found'
            }), 404
        
        return jsonify({
            'success': True,
            'selection': selection.to_dict()
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@finalists_bp.route('/stage-best-images/', methods=['POST'])
def save_stage_best_image():
    """
    Save the best-rated image for a specific stage.
    Called after user completes each stage (1-5).
    
    Request body:
    {
        'session_id': str,
        'sample_id': int,
        'stage': int (1-5),
        'best_card_index': int (0-6),
        'average_rating': float
    }
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['session_id', 'sample_id', 'stage', 'best_card_index', 'average_rating']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields: ' + ', '.join(required_fields)
            }), 400
        
        # Check if record already exists
        existing = StageBestImage.query.filter_by(
            session_id=data['session_id'],
            sample_id=data['sample_id'],
            stage=data['stage']
        ).first()
        
        if existing:
            # Update existing record
            existing.best_card_index = data['best_card_index']
            existing.average_rating = data['average_rating']
            existing.image_model = data.get('image_model')
            existing.caption_model = data.get('caption_model')
            existing.image_path = data.get('image_path')
            existing.caption_text = data.get('caption_text')
            db.session.commit()
            record = existing
        else:
            # Create new record
            best_image = StageBestImage(
                session_id=data['session_id'],
                sample_id=data['sample_id'],
                stage=data['stage'],
                best_card_index=data['best_card_index'],
                average_rating=data['average_rating'],
                image_model=data.get('image_model'),
                caption_model=data.get('caption_model'),
                image_path=data.get('image_path'),
                caption_text=data.get('caption_text')
            )
            db.session.add(best_image)
            db.session.commit()
            record = best_image
        
        return jsonify({
            'success': True,
            'message': 'Stage best image saved successfully',
            'stage_best_image': record.to_dict()
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@finalists_bp.route('/stage-best-images/<session_id>/<int:sample_id>', methods=['GET'])
def get_stage_best_images(session_id, sample_id):
    """
    Retrieve all stored best images for each stage (1-5) for a sample.
    Used when user resumes survey to load previously calculated best images.
    
    Returns: List of StageBestImage records with stage, card_index, average_rating
    """
    try:
        best_images = StageBestImage.query.filter_by(
            session_id=session_id,
            sample_id=sample_id
        ).order_by(StageBestImage.stage).all()
        
        return jsonify({
            'success': True,
            'best_images': [bi.to_dict() for bi in best_images]
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
