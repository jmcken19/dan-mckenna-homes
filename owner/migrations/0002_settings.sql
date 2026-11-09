-- Homepage slideshow (and future site-wide settings): draft + last published copy.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  draft TEXT NOT NULL,
  live TEXT,
  repo_sha TEXT,
  last_commit TEXT,
  lock_until INTEGER,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
