-- ============================================================
-- Puffchat — run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Drop existing tables
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS rooms    CASCADE;

-- 2. Recreate with correct schema and DB-level constraints

CREATE TABLE rooms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        UNIQUE NOT NULL
                         CHECK (code ~ '^[A-Z2-9]{3}-[A-Z2-9]{3}$'),
  status     TEXT        NOT NULL DEFAULT 'waiting'
                         CHECK (status IN ('waiting', 'active')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content          TEXT        NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  sender_token     TEXT        NOT NULL CHECK (length(sender_token) BETWEEN 1 AND 100),
  reply_to_content TEXT        CHECK (reply_to_content IS NULL OR length(reply_to_content) <= 200),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrading an existing install? Run just this migration (skip the full setup above):
-- ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT
--   CHECK (reply_to_content IS NULL OR length(reply_to_content) <= 200);

-- 3. Index for fast code lookups and orphan cleanup
CREATE INDEX rooms_code_idx      ON rooms (code);
CREATE INDEX rooms_created_at_idx ON rooms (created_at);

-- 4. Replica identity — required for Realtime filters on non-PK columns
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE rooms    REPLICA IDENTITY FULL;

-- 5. Row-Level Security — tightened per-operation policies

ALTER TABLE rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- rooms: anyone can create a room, but only with status 'waiting'
CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (status = 'waiting');

-- rooms: read is open (code is the secret; 32^6 ≈ 1 billion possibilities)
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (true);

-- rooms: only allow updating status from 'waiting' → 'active'.
-- This is what enforces the atomic join: if two people race to join,
-- only the first UPDATE (where status is still 'waiting') succeeds.
CREATE POLICY rooms_update ON rooms
  FOR UPDATE USING   (status = 'waiting')
             WITH CHECK (status = 'active');

-- rooms: allow delete for cleanup (keepalive fetches, cancel button)
CREATE POLICY rooms_delete ON rooms
  FOR DELETE USING (true);

-- messages: only allow inserting into an active room
CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM rooms WHERE id = room_id AND status = 'active'
    )
  );

-- messages: read is open (scoped to a known room_id by the app)
CREATE POLICY messages_select ON messages
  FOR SELECT USING (true);

-- messages: allow delete for cleanup
CREATE POLICY messages_delete ON messages
  FOR DELETE USING (true);

-- 6. Realtime (required for live updates and presence)
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 7. Auto-cleanup of orphaned 'waiting' rooms older than 30 minutes.
--    Run this manually or set up a pg_cron job:
--
--    SELECT cron.schedule(
--      'cleanup-orphaned-rooms',
--      '*/15 * * * *',
--      $$DELETE FROM rooms WHERE status = 'waiting' AND created_at < NOW() - INTERVAL '30 minutes'$$
--    );
--
--    Requires pg_cron extension (available on Supabase Pro).
--    On free tier, run the DELETE manually from the SQL editor periodically.
