-- Survey Tool SQLite Database Schema
-- For storing user ratings and feedback

-- Create tables for ratings collection

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ratings (
    rating_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    sample_id INTEGER NOT NULL,
    pipeline INTEGER NOT NULL,
    card_index INTEGER NOT NULL,
    image_model TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES users(session_id),
    UNIQUE(session_id, sample_id, pipeline, card_index)
);

CREATE TABLE IF NOT EXISTS survey_progress (
    progress_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    current_sample_index INTEGER DEFAULT 0,
    current_pipeline INTEGER DEFAULT 1,
    total_completed_samples INTEGER DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES users(session_id)
);

-- Indexes for performance
CREATE INDEX idx_ratings_session ON ratings(session_id);
CREATE INDEX idx_ratings_sample ON ratings(sample_id);
CREATE INDEX idx_progress_session ON survey_progress(session_id);

-- Sample queries
-- Get all ratings for a session
-- SELECT * FROM ratings WHERE session_id = 'session_123' ORDER BY created_at;

-- Get progress for a user
-- SELECT * FROM survey_progress WHERE session_id = 'session_123';

-- Get average rating per image model across all sessions
-- SELECT image_model, AVG(rating) as avg_rating, COUNT(*) as count FROM ratings GROUP BY image_model;

-- Get average rating per pipeline
-- SELECT pipeline, AVG(rating) as avg_rating FROM ratings GROUP BY pipeline;
