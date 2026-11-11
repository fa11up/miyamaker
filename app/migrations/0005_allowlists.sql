-- Allowlists pasted in the Launch window, saved so the proof route (api/_lib/allowlist.ts) can answer for them.
-- Keyed by the Merkle root the server works out from the addresses itself; body is the OpenZeppelin StandardMerkleTree
-- dump (format 'standard-v1') as JSON. Lists from scripts/allowlist-snapshot.mts ship with the build instead
-- (public/allowlists/<root>.json) and are not stored here. Without this table, saving a list says it couldn't.
CREATE TABLE IF NOT EXISTS allowlists (
  root TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS allowlists_created ON allowlists (created_at);
