-- Add generated_email column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS generated_email TEXT;
