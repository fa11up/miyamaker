-- The per-mint reveal (api/_lib/reveal.ts): each minted token of a registered drop gets a random piece of art once its
-- block is confirmed; the art itself is in the REVEAL R2 bucket and is served only for assigned tokens.

-- One row per drop served from /reveal/<slug>/. address and deploy_block are null until the drop exists (its address
-- is not known before it is created). minted / assigned count tokens 1..n and only move forward (compare-and-set).
CREATE TABLE IF NOT EXISTS reveal_collections (
  slug TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  supply INTEGER NOT NULL,
  provenance_hash TEXT NOT NULL,
  -- The cover every token shows until it is assigned.
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cover_image TEXT NOT NULL,
  address TEXT,
  deploy_block INTEGER,
  last_scanned_block INTEGER,
  minted INTEGER NOT NULL DEFAULT 0,
  assigned INTEGER NOT NULL DEFAULT 0,
  -- The cron's lock, so overlapping runs don't both ask the RPC. Correctness doesn't rest on it.
  lock_until INTEGER NOT NULL DEFAULT 0,
  -- Who moved the counters last (a random id per write): a write's rows go in only if its own compare-and-set won.
  writer TEXT,
  -- The last error the cron hit for this drop, for the admin status.
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Every piece's hashes from provenance.json, and whether its files are in R2 and on Arweave.
CREATE TABLE IF NOT EXISTS reveal_pieces (
  slug TEXT NOT NULL,
  piece INTEGER NOT NULL,
  image_sha256 TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL,
  image_loaded INTEGER NOT NULL DEFAULT 0,
  metadata_loaded INTEGER NOT NULL DEFAULT 0,
  ar_image TEXT,
  ar_metadata TEXT,
  PRIMARY KEY (slug, piece)
);

-- Transfers from 0x0, from blocks at least CONFIRMATIONS deep.
CREATE TABLE IF NOT EXISTS reveal_mints (
  slug TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (slug, token_id)
);

-- Final once written. A piece is given once per drop.
CREATE TABLE IF NOT EXISTS reveal_assignments (
  slug TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  piece INTEGER NOT NULL,
  seed_block INTEGER NOT NULL,
  seed_block_hash TEXT NOT NULL,
  seed TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  -- When OpenSea was asked to fetch the token's metadata again (0 = not yet).
  refreshed_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, token_id),
  UNIQUE (slug, piece)
);
CREATE INDEX IF NOT EXISTS reveal_assignments_refresh ON reveal_assignments (slug, refreshed_at);
