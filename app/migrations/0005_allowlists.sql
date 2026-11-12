-- Allowlists pasted in the Launch window, saved so the proof route (api/_lib/allowlist.ts) can answer for them.
-- Keyed by the Merkle root the server works out from the addresses itself; body is only the addresses, lowercase and
-- sorted, as a JSON array (the tree is built again when the list is read). Lists from scripts/allowlist-snapshot.mts
-- ship with the build instead (public/allowlists/<root>.json) and are not stored here. client_hash is the hashed client
-- key (as in 0003_hardening.sql) for the per-client daily cap. Without this table, saving a list says it couldn't.
CREATE TABLE IF NOT EXISTS allowlists (
  root TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  client_hash TEXT
);
CREATE INDEX IF NOT EXISTS allowlists_created ON allowlists (created_at);
CREATE INDEX IF NOT EXISTS allowlists_client ON allowlists (client_hash, created_at);
