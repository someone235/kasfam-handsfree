-- add updatedAt column to track when tweets are updated with decisions
ALTER TABLE tweets ADD COLUMN updatedAt TEXT DEFAULT NULL;

