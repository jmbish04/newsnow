-- Migration: Create article agent tables
-- Created: 2025-12-19
-- Description: Creates tables for article ingestion, AI analysis, collections, and tagging

-- Articles table: stores individual articles with AI analysis
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  author TEXT,
  published_date TEXT,
  time_roi TEXT, -- AI analysis of time investment vs. value (slop vs. deep work)
  ranking INTEGER DEFAULT 0, -- Numerical score (1-100) from AI
  status TEXT DEFAULT 'processing' CHECK(status IN ('processing', 'unread', 'read', 'archived', 'error')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Article tags: categorization and topics
CREATE TABLE IF NOT EXISTS article_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)), -- Boolean for soft delete
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Article-tag mapping: many-to-many relationship
CREATE TABLE IF NOT EXISTS article_tag_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0, -- AI confidence score (0.0-1.0)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES article_tags(id) ON DELETE CASCADE,
  UNIQUE(article_id, tag_id)
);

-- R2 object storage references: PDFs, Markdown, JSON metadata
CREATE TABLE IF NOT EXISTS article_r2_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL CHECK(file_type IN ('pdf', 'md', 'json')),
  file_size INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Collections: user-defined interest categories
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT, -- Used by AI to understand user interests
  color TEXT, -- Optional hex color for UI
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Collection items: many-to-many relationship with articles
CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  notes TEXT, -- User notes about why this article fits this collection
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  UNIQUE(collection_id, article_id)
);

-- Feedback history: track user interactions for AI training
CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  feedback_type TEXT NOT NULL CHECK(feedback_type IN ('upvote', 'downvote', 'saved', 'archived', 'tag_added', 'tag_removed')),
  feedback_data TEXT, -- JSON data for additional context
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_ranking ON articles(ranking DESC);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_article_tag_map_article ON article_tag_map(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tag_map_tag ON article_tag_map(tag_id);
CREATE INDEX IF NOT EXISTS idx_article_r2_article ON article_r2_objects(article_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_article ON collection_items(article_id);
CREATE INDEX IF NOT EXISTS idx_article_feedback_article ON article_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_article_feedback_created ON article_feedback(created_at DESC);
