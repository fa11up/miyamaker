-- The radio's community station (api/_lib/station.ts). A removed track keeps its row, so it cannot simply be added back.
CREATE TABLE IF NOT EXISTS station_tracks (
  tx_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artwork_id TEXT,
  duration REAL,
  uploader TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX IF NOT EXISTS station_live ON station_tracks (removed_at, added_at);
CREATE INDEX IF NOT EXISTS station_uploader ON station_tracks (uploader, added_at);
