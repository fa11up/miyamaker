-- Shared state and abuse limits (api/_lib/sharedstate.ts, station.ts, publicaccess.ts). The code works without this
-- migration (falling back to what it did before), so it can run before or after a deploy; run it first anyway.

-- One copy for every data centre of answers that cost quota to refresh (miyatv's YouTube and Kick lookups), with the
-- refresh lock. at = 0 is a row made only to hold the lock.
CREATE TABLE IF NOT EXISTS shared_state (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0
);

-- Signed words already used (SHA-256 of wallet and message), kept a little past the 10 minutes they are accepted, so a
-- copied request cannot be sent again. Shared by the station and public access.
CREATE TABLE IF NOT EXISTS used_signatures (
  hash TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS used_signatures_at ON used_signatures (at);

-- Who added a row, as a hashed client key (IP, IPv6 by /64), for the per-client daily caps. No addresses are stored.
ALTER TABLE station_tracks ADD COLUMN client_hash TEXT;
CREATE INDEX IF NOT EXISTS station_client ON station_tracks (client_hash, added_at);
ALTER TABLE public_access_tapes ADD COLUMN client_hash TEXT;
CREATE INDEX IF NOT EXISTS public_access_client ON public_access_tapes (client_hash, submitted_at);
