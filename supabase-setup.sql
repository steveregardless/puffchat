-- ============================================================
-- Puffchat — run this in Supabase Dashboard → SQL Editor
-- ============================================================
-- NOTE: The tables were previously created from the UI without
-- the required columns. This migration drops them and recreates
-- them with the correct schema.
-- ============================================================

-- 1. Drop existing incomplete tables
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS rooms    CASCADE;

-- 2. Recreate with correct schema

CREATE TABLE rooms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        UNIQUE NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  sender_token TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Replica identity — required for Realtime filters on non-PK columns
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE rooms    REPLICA IDENTITY FULL;

-- 4. Row-Level Security (open — anonymous disposable app)

ALTER TABLE rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY rooms_all    ON rooms    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY messages_all ON messages FOR ALL USING (true) WITH CHECK (true);

-- 5. Realtime (required for live updates and presence)
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
