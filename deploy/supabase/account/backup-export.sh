#!/bin/sh
set -eu

usage() {
  printf '%s\n' \
    'usage: backup-export.sh --backup-root PATH --secret-directory PATH --source-resource NAME --source-git-commit 40_HEX' >&2
  exit 2
}

backup_root=
secret_directory=
source_resource=
source_git_commit=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-root)
      [ "$#" -ge 2 ] || usage
      backup_root=$2
      shift 2
      ;;
    --secret-directory)
      [ "$#" -ge 2 ] || usage
      secret_directory=$2
      shift 2
      ;;
    --source-resource)
      [ "$#" -ge 2 ] || usage
      source_resource=$2
      shift 2
      ;;
    --source-git-commit)
      [ "$#" -ge 2 ] || usage
      source_git_commit=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -n "$backup_root" ] && [ -n "$secret_directory" ] && \
  [ -n "$source_resource" ] && [ -n "$source_git_commit" ] || usage
case "$source_resource" in
  *[!a-z0-9-]* | -* | *-)
    printf '%s\n' 'source resource must use lowercase letters, digits, and interior hyphens' >&2
    exit 2
    ;;
esac
[ "${#source_resource}" -ge 3 ] && [ "${#source_resource}" -le 63 ] || {
  printf '%s\n' 'source resource length must be between 3 and 63 characters' >&2
  exit 2
}
case "$source_git_commit" in
  *[!0-9a-f]*)
    printf '%s\n' 'source Git commit must be exactly 40 lowercase hexadecimal characters' >&2
    exit 2
    ;;
esac
[ "${#source_git_commit}" -eq 40 ] || {
  printf '%s\n' 'source Git commit must be exactly 40 lowercase hexadecimal characters' >&2
  exit 2
}
[ -d "$backup_root" ] && [ ! -L "$backup_root" ] || {
  printf '%s\n' 'backup root must be an existing non-symlink directory' >&2
  exit 2
}
[ -d "$secret_directory" ] && [ ! -L "$secret_directory" ] || {
  printf '%s\n' 'secret directory must be an existing non-symlink directory' >&2
  exit 2
}

backup_root=$(realpath -e "$backup_root")
secret_directory=$(realpath -e "$secret_directory")
[ "$backup_root" != / ] && [ "$secret_directory" != / ] || {
  printf '%s\n' 'backup root and secret directory must not be the filesystem root' >&2
  exit 2
}

if [ "$(uname -s)" = Linux ]; then
  [ "$(id -u)" -eq 0 ] || {
    printf '%s\n' 'backup export must run as root on Linux' >&2
    exit 2
  }
  [ "$(stat -c '%u:%g:%a' "$backup_root")" = '0:0:700' ] || {
    printf '%s\n' 'backup root must be root:root mode 0700' >&2
    exit 2
  }
  [ "$(stat -c '%u:%g:%a' "$secret_directory")" = '0:0:700' ] || {
    printf '%s\n' 'secret directory must be root:root mode 0700' >&2
    exit 2
  }
fi

secret_names='account_postgres_password
account_auth_db_password
account_legacy_jwt_secret
account_jwt_keys
account_publishable_key'

printf '%s\n' "$secret_names" | while IFS= read -r name; do
  source_path=$secret_directory/$name
  [ -f "$source_path" ] && [ ! -L "$source_path" ] || {
    printf '%s\n' "$name must be a regular non-symlink file" >&2
    exit 2
  }
  awk 'length($0) == 0 { exit 1 } END { if (NR != 1) exit 1 }' "$source_path" || {
    printf '%s\n' "$name must contain exactly one non-empty line" >&2
    exit 2
  }
  if [ "$(uname -s)" = Linux ] && \
    [ "$(stat -c '%u:%g:%a' "$source_path")" != '0:0:444' ]; then
    printf '%s\n' "$name must be root:root mode 0444" >&2
    exit 2
  fi
done

command -v node >/dev/null 2>&1 || {
  printf '%s\n' 'node is required to derive public signing-key metadata' >&2
  exit 1
}
signing_metadata=$(node - "$secret_directory/account_jwt_keys" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const keys = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(keys)) throw new Error("JWT_KEYS is not an array");
const key = keys.find(
  (candidate) =>
    candidate?.kty === "EC" &&
    candidate?.crv === "P-256" &&
    candidate?.alg === "ES256" &&
    typeof candidate?.kid === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(candidate.kid) &&
    typeof candidate?.d === "string" &&
    typeof candidate?.x === "string" &&
    typeof candidate?.y === "string",
);
if (key === undefined) throw new Error("no private ES256 P-256 signing key");
const publicJwk = JSON.stringify({
  crv: key.crv,
  kty: key.kty,
  x: key.x,
  y: key.y,
});
const thumbprint = createHash("sha256")
  .update(publicJwk)
  .digest("base64url");
process.stdout.write(
  `signing_kid=${key.kid}\nsigning_public_jwk_thumbprint=${thumbprint}`,
);
NODE
) || {
  printf '%s\n' 'could not derive public signing-key metadata' >&2
  exit 2
}

containers=$(docker ps \
  --filter 'label=io.apollo.account.stack=staging' \
  --filter 'label=io.apollo.account.component=account-db' \
  --filter "label=io.apollo.account.resource=$source_resource" \
  --filter "label=io.apollo.account.source-commit=$source_git_commit" \
  --format '{{.ID}}')
set -- $containers
[ "$#" -eq 1 ] || {
  printf '%s\n' 'expected exactly one running Apollo Account staging database container' >&2
  exit 1
}
database_container=$1
source_image=$(docker inspect --format '{{.Config.Image}}' "$database_container")
postgres_data_volume=$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' \
  "$database_container")
postgres_config_volume=$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/etc/postgresql-custom"}}{{.Name}}{{end}}{{end}}' \
  "$database_container")
expected_data_volume=$source_resource-postgres-v1
expected_config_volume=$source_resource-db-config-v1
[ "$postgres_data_volume" = "$expected_data_volume" ] || {
  printf '%s\n' 'database data volume does not match the explicit source resource' >&2
  exit 1
}
[ "$postgres_config_volume" = "$expected_config_volume" ] || {
  printf '%s\n' 'database config volume does not match the explicit source resource' >&2
  exit 1
}
postgres_version_record=$(docker exec "$database_container" \
  psql --username=postgres --dbname=postgres --tuples-only --no-align \
  --command="SELECT current_setting('server_version_num') || '|' || current_setting('server_version')")
postgres_server_version_num=${postgres_version_record%%|*}
postgres_server_version=${postgres_version_record#*|}
case "$postgres_server_version_num" in
  17[0-9][0-9][0-9][0-9]) ;;
  *)
    printf '%s\n' 'source PostgreSQL must report a version in major 17' >&2
    exit 1
    ;;
esac
[ "$postgres_server_version" != "$postgres_version_record" ] && \
  [ -n "$postgres_server_version" ] || {
  printf '%s\n' 'source PostgreSQL version record is malformed' >&2
  exit 1
}
line_feed='
'
carriage_return=$(printf '\r')
case "$postgres_server_version" in
  *"$line_feed"* | *"$carriage_return"*)
    printf '%s\n' 'source PostgreSQL version contains an invalid line break' >&2
    exit 1
    ;;
esac

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
work=$backup_root/.incomplete-$timestamp-$$
final=$backup_root/$timestamp
case "$work" in
  "$backup_root"/.incomplete-*) ;;
  *) printf '%s\n' 'unsafe backup work path' >&2; exit 70 ;;
esac
[ ! -e "$work" ] && [ ! -e "$final" ] || {
  printf '%s\n' 'backup destination collision' >&2
  exit 1
}

cleanup() {
  if [ -d "$work" ]; then
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT HUP INT TERM
umask 077
mkdir "$work"
mkdir "$work/secrets"

docker exec "$database_container" \
  pg_dump --format=custom \
    --username=postgres --dbname=postgres --file=- > "$work/postgres.dump"
[ -s "$work/postgres.dump" ] || {
  printf '%s\n' 'logical PostgreSQL dump is empty' >&2
  exit 1
}
docker exec "$database_container" \
  tar --create --file=- --directory=/etc/postgresql-custom . \
  > "$work/postgresql-custom.tar"
[ -s "$work/postgresql-custom.tar" ] || {
  printf '%s\n' 'PostgreSQL custom configuration archive is empty' >&2
  exit 1
}

printf '%s\n' "$secret_names" | while IFS= read -r name; do
  cp "$secret_directory/$name" "$work/secrets/$name"
  chmod 0400 "$work/secrets/$name"
done

{
  printf 'format=apollo-account-logical-v2\n'
  printf 'created_at=%s\n' "$timestamp"
  printf 'source_resource=%s\n' "$source_resource"
  printf 'source_git_commit=%s\n' "$source_git_commit"
  printf 'source_container_id=%s\n' "$database_container"
  printf 'source_image=%s\n' "$source_image"
  printf 'database=postgres\n'
  printf 'postgres_server_version_num=%s\n' "$postgres_server_version_num"
  printf 'postgres_server_version=%s\n' "$postgres_server_version"
  printf 'postgres_data_volume=%s\n' "$postgres_data_volume"
  printf 'postgres_config_volume=%s\n' "$postgres_config_volume"
  printf '%s\n' "$signing_metadata"
} > "$work/MANIFEST"

(
  cd "$work"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | \
    while IFS= read -r path; do sha256sum "$path"; done > SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
find "$work" -type d -exec chmod 0700 {} \;
find "$work" -type f -exec chmod 0400 {} \;
mv "$work" "$final"
trap - EXIT HUP INT TERM
printf 'backup ready: %s\n' "$final"
