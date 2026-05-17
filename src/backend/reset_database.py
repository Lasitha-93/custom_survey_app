"""
Reset Database Script - Clears all survey app tables
Run this before starting backend during local testing for a fresh database
"""

import psycopg2
from psycopg2 import sql
import os
from pathlib import Path

def reset_database():
    """Drop all survey app tables (idempotent - safe to run multiple times)"""
    
    # Read database credentials from .env
    env_path = Path(__file__).parent / '.env'
    if not env_path.exists():
        print("❌ .env file not found")
        print("   Expected at:", env_path)
        return False
    
    # Parse .env
    db_url = None
    with open(env_path) as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                db_url = line.split('=', 1)[1].strip()
                break
    
    if not db_url:
        print("❌ DATABASE_URL not found in .env")
        return False
    
    # Parse connection string: postgresql://user:password@host:port/database
    try:
        # Remove postgresql:// prefix
        conn_str = db_url.replace('postgresql://', '')
        user_pass, host_db = conn_str.split('@')
        user, password = user_pass.split(':')
        host_port, database = host_db.split('/')
        host, port = host_port.split(':')
        
        print(f"Connecting to: {host}:{port}/{database} (user: {user})")
    except Exception as e:
        print(f"❌ Failed to parse DATABASE_URL: {e}")
        return False
    
    # Connect and drop tables
    try:
        conn = psycopg2.connect(
            host=host,
            port=int(port),
            database=database,
            user=user,
            password=password
        )
        cursor = conn.cursor()
        
        print("\n[1] Dropping tables...")
        
        # Tables to drop (in reverse order of dependencies)
        tables = [
            'finalist_selections',
            'stage_best_images',
            'ratings',
            'demographics',
            'sessions',
            'article_metadata'
        ]
        
        dropped_count = 0
        for table in tables:
            try:
                cursor.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
                dropped_count += 1
                print(f"    ✓ Dropped table: {table}")
            except Exception as e:
                print(f"    ⚠ Could not drop {table}: {e}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"\n✅ Successfully dropped {dropped_count} tables")
        print("\nNext steps:")
        print("   1. Start backend: python app.py")
        print("   2. Backend will auto-create all tables")
        print("   3. Database is now fresh and ready for testing")
        
        return True
        
    except psycopg2.OperationalError as e:
        print(f"❌ Database connection failed: {e}")
        print("\n   Check that:")
        print("      - PostgreSQL service is running")
        print("      - .env DATABASE_URL is correct")
        print("      - Database and user exist")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == '__main__':
    print("=" * 60)
    print("Survey App - Database Reset Script")
    print("=" * 60)
    print()
    
    response = input("⚠️  This will DROP ALL survey app tables. Continue? (y/n): ")
    if response.lower() != 'y':
        print("Cancelled.")
        exit(0)
    
    success = reset_database()
    exit(0 if success else 1)
