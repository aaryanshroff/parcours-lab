ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS messages jsonb DEFAULT '[]'::jsonb;
