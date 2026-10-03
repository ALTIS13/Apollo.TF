#!/usr/bin/env bash
set -euo pipefail
export TF_PROOF_DB_NAME="apollo_tf_test_${TF_TEST_RUN_ID}"
export TF_PROOF_DB_MARKER="apollo.tf.integration-run:${TF_TEST_RUN_ID}"
psql -X --set ON_ERROR_STOP=1 --username tf_proof_bootstrap --dbname postgres <<'SQL'
\getenv db_name TF_PROOF_DB_NAME
\getenv db_marker TF_PROOF_DB_MARKER
\getenv migrator_password TF_PROOF_MIGRATOR_PASSWORD
\getenv runtime_password TF_PROOF_RUNTIME_PASSWORD
create role apollo_tf_migrator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'migrator_password';
create role apollo_tf_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'runtime_password';
create database :"db_name" owner apollo_tf_migrator;
comment on database :"db_name" is :'db_marker';
revoke all on database :"db_name" from public;
grant connect on database :"db_name" to apollo_tf_migrator, apollo_tf_runtime;
\connect :db_name
revoke all on schema public from public;
grant usage, create on schema public to apollo_tf_migrator;
grant usage on schema public to apollo_tf_runtime;
SQL
