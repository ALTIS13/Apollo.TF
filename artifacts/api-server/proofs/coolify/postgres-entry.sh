#!/usr/bin/env bash
set -euo pipefail
fail() { printf '%s\n' 'TF proof database execution gate rejected' >&2; exit 2; }
[[ ${TF_TEST_RUN_ID:-} =~ ^[a-z0-9][a-z0-9_]{6,30}[a-z0-9]$ ]] || fail
[[ ${TF_PROOF_EXECUTE:-} == "execute:${TF_TEST_RUN_ID}" ]] || fail
[[ ${TF_PROOF_SOURCE_REVISION:-} =~ ^[0-9a-f]{40}$ ]] || fail
[[ ${PGDATA:-} == /var/lib/postgresql/data/pgdata ]] || fail
[[ ${POSTGRES_USER:-} == tf_proof_bootstrap && ${POSTGRES_DB:-} == postgres ]] || fail
for key in POSTGRES_PASSWORD TF_PROOF_MIGRATOR_PASSWORD TF_PROOF_RUNTIME_PASSWORD; do
  [[ ${!key:-} =~ ^[0-9a-f]{64}$ ]] || fail
done
[[ $POSTGRES_PASSWORD != "$TF_PROOF_MIGRATOR_PASSWORD" && $POSTGRES_PASSWORD != "$TF_PROOF_RUNTIME_PASSWORD" && $TF_PROOF_MIGRATOR_PASSWORD != "$TF_PROOF_RUNTIME_PASSWORD" ]] || fail
# Never initialize over or reuse any existing cluster; each run gets fresh tmpfs.
[[ ! -e $PGDATA ]] || fail
unset DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE
exec /usr/local/bin/docker-entrypoint.sh postgres -c log_statement=none -c log_min_error_statement=panic
