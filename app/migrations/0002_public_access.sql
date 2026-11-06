-- miyatv's public access channel (api/_lib/publicaccess.ts). A removed tape keeps its row, so it cannot simply be sent in again.
CREATE TABLE IF NOT EXISTS public_access_tapes (
  video_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  submitter TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  approved_at INTEGER,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX IF NOT EXISTS public_access_state ON public_access_tapes (removed_at, approved_at, submitted_at);
CREATE INDEX IF NOT EXISTS public_access_submitter ON public_access_tapes (submitter, submitted_at);
