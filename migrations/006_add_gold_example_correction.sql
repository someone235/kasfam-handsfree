-- Add correction field for BAD gold examples
-- Stores the correct rejection reason that should have been given
ALTER TABLE tweets ADD COLUMN goldExampleCorrection TEXT DEFAULT NULL;
