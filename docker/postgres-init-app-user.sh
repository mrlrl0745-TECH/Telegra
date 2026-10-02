#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER must be set}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set}"
: "${POSTGRES_BOT_USER:?POSTGRES_BOT_USER must be set}"
: "${POSTGRES_BOT_PASSWORD:?POSTGRES_BOT_PASSWORD must be set}"

psql_args=(--no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")
ensure_login_role() {
  local role_name="$1"
  local role_password="$2"
  local role_exists
  role_exists="$(psql "${psql_args[@]}" --tuples-only --no-align --set=role_name="$role_name" <<'SQL'
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name');
SQL
)"
  if [[ "$role_exists" == "t" ]]; then
    psql "${psql_args[@]}" --set=role_name="$role_name" --set=role_password="$role_password" <<'SQL'
ALTER ROLE :"role_name" WITH LOGIN PASSWORD :'role_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
SQL
  else
    psql "${psql_args[@]}" --set=role_name="$role_name" --set=role_password="$role_password" <<'SQL'
CREATE ROLE :"role_name" WITH LOGIN PASSWORD :'role_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
SQL
  fi
}

ensure_login_role "$POSTGRES_APP_USER" "$POSTGRES_APP_PASSWORD"
ensure_login_role "$POSTGRES_BOT_USER" "$POSTGRES_BOT_PASSWORD"

psql "${psql_args[@]}" \
  --set=app_user="$POSTGRES_APP_USER" \
  --set=bot_user="$POSTGRES_BOT_USER" \
  --set=app_db="$POSTGRES_DB" \
  --set=admin_user="$POSTGRES_USER" <<'SQL'
GRANT CONNECT, CREATE ON DATABASE :"app_db" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
GRANT CONNECT ON DATABASE :"app_db" TO :"bot_user";
GRANT USAGE ON SCHEMA public TO :"bot_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
SQL
