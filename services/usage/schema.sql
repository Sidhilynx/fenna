-- Anonymous usage counts from the Fenna apps. One row per install, app and day.
-- No IP address, name or content is stored. See PRIVACY.md#usage-counts.
CREATE TABLE IF NOT EXISTS pings (
  day      TEXT NOT NULL,   -- YYYY-MM-DD, the install's local date the counts are for
  id       TEXT NOT NULL,   -- random install id made on the person's computer
  app      TEXT NOT NULL,
  version  TEXT NOT NULL,
  os       TEXT NOT NULL,
  arch     TEXT NOT NULL,
  cli      TEXT NOT NULL,   -- JSON array
  counts   TEXT NOT NULL,   -- JSON object
  first    TEXT NOT NULL,   -- JSON object
  received TEXT NOT NULL,   -- server time, ISO
  PRIMARY KEY (day, id, app)
);
CREATE INDEX IF NOT EXISTS pings_id ON pings (id);
CREATE INDEX IF NOT EXISTS pings_app_day ON pings (app, day);

CREATE TABLE IF NOT EXISTS feedback (
  n        INTEGER PRIMARY KEY,
  received TEXT NOT NULL,
  id       TEXT NOT NULL,
  app      TEXT NOT NULL,
  version  TEXT NOT NULL,
  os       TEXT NOT NULL,
  rating   TEXT,            -- up | down | null
  text     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_id ON feedback (id, received);
