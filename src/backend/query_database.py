#!/usr/bin/env python
"""
Query database to verify data is being stored correctly
Run this during/after survey to check if stage best images are saving
"""

from app import create_app
from models import db, Session, Rating, StageBestImage, FinalistSelection

def query_database():
    """Show all data in database"""
    
    app = create_app()
    
    with app.app_context():
        print("\n" + "=" * 80)
        print("📊 DATABASE INSPECTION")
        print("=" * 80)
        
        # Sessions
        print("\n📌 SESSIONS:")
        sessions = Session.query.all()
        print(f"   Total: {len(sessions)}")
        for session in sessions[-3:]:  # Show last 3
            print(f"   - {session.id[:8]}... | Sample {session.last_sample_index} | Stage {session.last_stage} | Completed: {session.is_completed}")
        
        # Ratings
        print("\n⭐ RATINGS:")
        ratings = Rating.query.all()
        print(f"   Total: {len(ratings)}")
        by_sample = {}
        for r in ratings:
            if r.sample_id not in by_sample:
                by_sample[r.sample_id] = {'total': 0, 'stages': set()}
            by_sample[r.sample_id]['total'] += 1
            by_sample[r.sample_id]['stages'].add(r.stage)
        
        for sample_id, data in list(by_sample.items())[-3:]:  # Last 3 samples
            print(f"   - Sample {sample_id}: {data['total']} ratings across stages {sorted(data['stages'])}")
        
        # Stage Best Images (NEW)
        print("\n🎯 STAGE BEST IMAGES (NEW - THIS IS WHAT WE NEED): ⭐")
        stage_best = StageBestImage.query.all()
        print(f"   Total: {len(stage_best)}")
        if stage_best:
            print("\n   Details:")
            for sb in stage_best[-10:]:  # Show last 10
                print(f"   - Session {sb.session_id[:8]}... | Sample {sb.sample_id} | Stage {sb.stage} | Best Card: {sb.best_card_index} | Avg Rating: {sb.average_rating:.2f}")
        else:
            print("   ⚠️  NO STAGE BEST IMAGES SAVED YET")
            print("   (They should appear after you complete stages 1-5)")
        
        # Finalist Selections
        print("\n🏆 FINALIST SELECTIONS (Stage 6 choices):")
        finalists = FinalistSelection.query.all()
        print(f"   Total: {len(finalists)}")
        for f in finalists[-3:]:  # Last 3
            print(f"   - Session {f.session_id[:8]}... | Sample {f.sample_id} | Selected Card {f.selected_card_index} from Stage {f.selected_stage}")
        
        print("\n" + "=" * 80)
        print("✅ DATABASE INSPECTION COMPLETE")
        print("=" * 80 + "\n")

if __name__ == '__main__':
    try:
        query_database()
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
