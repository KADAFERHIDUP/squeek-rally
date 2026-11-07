-- Squeek Orbit shared server (Cloudflare D1 / SQLite)
CREATE TABLE IF NOT EXISTS rounds (
  round INTEGER PRIMARY KEY,         -- Squeekchain round (600 s from genesis 1793735400)
  work INTEGER,                      -- wheel turns settled on-chain for this round; NULL when a settlement spans rounds with work
  tx TEXT,                           -- Sepolia settlement transaction
  settled_at INTEGER,                -- unix ms of the settlement block
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL, name TEXT NOT NULL,
  score INTEGER NOT NULL, distance INTEGER NOT NULL,
  seeds INTEGER NOT NULL, coins INTEGER NOT NULL, gems INTEGER NOT NULL,
  duration INTEGER NOT NULL, multiplier INTEGER NOT NULL, skin TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_score ON runs (score DESC);
CREATE INDEX IF NOT EXISTS runs_client ON runs (client);
CREATE TABLE IF NOT EXISTS cheers (
  day TEXT NOT NULL, client TEXT NOT NULL, name TEXT NOT NULL,
  count INTEGER NOT NULL, last_at INTEGER NOT NULL,
  PRIMARY KEY (day, client)
);
CREATE TABLE IF NOT EXISTS votes (
  round INTEGER NOT NULL, client TEXT NOT NULL, choice TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (round, client)
);
CREATE TABLE IF NOT EXISTS hits (
  key TEXT PRIMARY KEY, win INTEGER NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wheel (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  running INTEGER NOT NULL, speed REAL NOT NULL, today_m REAL, fetched_at INTEGER NOT NULL
);
