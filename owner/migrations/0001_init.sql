-- Private editor database (Cloudflare D1). Holds drafts, the last published copy of
-- each listing (for restore), change requests and an activity log. Public listing
-- data is ALSO kept in the Git repo (content/listings/*.json) so the site never
-- depends on this database to render.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  slug TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'draft',      -- draft | published | archived
  draft TEXT NOT NULL,                           -- JSON: fields + photos being edited
  live TEXT,                                     -- JSON: what is (or was last) on the website
  published_revision INTEGER,
  repo_sha TEXT,                                 -- blob sha of content/listings/<id>.json last seen
  last_commit TEXT,
  lock_until INTEGER,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS listings_slug ON listings(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  kind TEXT NOT NULL,              -- change | question
  page TEXT,
  message TEXT NOT NULL,
  photos INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received', -- received | working | done
  notified INTEGER NOT NULL DEFAULT 0,
  reply TEXT
);

CREATE TABLE IF NOT EXISTS idem (
  key TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  response TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  listing_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS events_actor_at ON events(actor, at);
