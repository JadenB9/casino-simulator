-- Casino Simulator: a password per name. Ships in the site repo as
-- database/migrations/016_casino_passwords.sql.
--
-- Additive only: two nullable columns on casino_accounts and nothing else. The site's staging
-- environment points at this same database. Every account that exists when this runs keeps
-- NULL in both, meaning "no password yet"; the first login that brings a password sets it and
-- the name is claimed from then on. New accounts get theirs when they are created.
--
-- pass_hash is "pbkdf2:<iterations>:<hex>" (PBKDF2-HMAC-SHA256, 32 bytes, the format the site's
-- own API uses), so the iteration count can change later without another migration.
-- pass_salt is the account's own random 16-byte salt, hex. Neither ever leaves the Worker.
ALTER TABLE casino_accounts ADD COLUMN pass_hash TEXT;
ALTER TABLE casino_accounts ADD COLUMN pass_salt TEXT;
