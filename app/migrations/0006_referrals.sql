-- Ref link stats (api/_lib/referrals.ts): the cron reads each mint transaction the reveal stored (reveal_mints) once,
-- and keeps the mints its ref tag credits. The payout script (scripts/referrals.mts) reads the chain itself; this is only
-- what the share box shows.

-- Every mint transaction already read, credited or not, so it is read once.
CREATE TABLE IF NOT EXISTS ref_txs (
  slug TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  PRIMARY KEY (slug, tx_hash)
);

-- One row per credited Minted event. paid and reward are decimal strings (base units): they outgrow SQLite's integers.
CREATE TABLE IF NOT EXISTS ref_mints (
  slug TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  referrer TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  token TEXT NOT NULL,
  paid TEXT NOT NULL,
  bps INTEGER NOT NULL,
  reward TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  PRIMARY KEY (slug, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ref_mints_referrer ON ref_mints (slug, referrer);
