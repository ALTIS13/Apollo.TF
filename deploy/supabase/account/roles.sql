-- Adapted from Supabase self-hosted/v0.8.0 docker/volumes/db/roles.sql.
-- The containing host directory is root-only. The file is mode 0444 because
-- Docker Compose ignores uid/gid/mode for file-backed secrets, while this SQL
-- is executed by the image's unprivileged postgres OS user during first boot.
\set authpass `cat /run/secrets/account_auth_db_password`

ALTER USER supabase_auth_admin WITH PASSWORD :'authpass';
\unset authpass
