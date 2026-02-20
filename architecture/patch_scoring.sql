-- Add scoring columns to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS match_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS match_reason TEXT;
