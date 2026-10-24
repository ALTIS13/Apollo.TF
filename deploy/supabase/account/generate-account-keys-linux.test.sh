#!/bin/sh

set -eu

synthetic_secret='c3ludGhldGljLWFwb2xsby1rZXktdGVzdC0wMDAx'
script_path=$0
script_directory=$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd -P)
source_wrapper=$script_directory/generate-account-keys-linux.sh
source_helper=$script_directory/generate-account-keys.mjs

fail() {
  printf '%s\n' "test failed: $1" >&2
  exit 1
}

expect_failure_without_secret() {
  stdout_path=$1
  stderr_path=$2
  shift 2
  if printf '%s\n' "$synthetic_secret" | "$@" >"$stdout_path" 2>"$stderr_path"; then
    fail 'command unexpectedly succeeded'
  fi
  if grep -F "$synthetic_secret" "$stdout_path" "$stderr_path" >/dev/null; then
    fail 'diagnostics disclosed the synthetic secret'
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  test_root=$HOME/.apollo-account-keygen-wrapper-nonroot.$$
  cleanup_nonroot() {
    case $test_root in
      "$HOME"/.apollo-account-keygen-wrapper-nonroot.*) rm -rf -- "$test_root" ;;
      *) fail 'refusing unsafe non-root cleanup path' ;;
    esac
  }
  trap cleanup_nonroot EXIT HUP INT TERM
  mkdir -m 700 -- "$test_root"
  mkdir -m 700 -- "$test_root/operator"
  expect_failure_without_secret \
    "$test_root/stdout" "$test_root/stderr" \
    "$source_wrapper" \
    --operator-parent "$test_root/operator" \
    --node-binary /usr/bin/node
  grep -F 'must run as root' "$test_root/stderr" >/dev/null ||
    fail 'non-root rejection diagnostic was absent'
  printf '%s\n' 'wrapper non-root tests: 1 passed'
  exit 0
fi

test_root=/root/.apollo-account-keygen-wrapper-root.$$
shared_parent=/tmp/apollo-account-keygen-wrapper-root.$$
cleanup_root() {
  case $test_root in
    /root/.apollo-account-keygen-wrapper-root.*) rm -rf -- "$test_root" ;;
    *) fail 'refusing unsafe root test cleanup path' ;;
  esac
  case $shared_parent in
    /tmp/apollo-account-keygen-wrapper-root.*) rm -rf -- "$shared_parent" ;;
    *) fail 'refusing unsafe shared-parent cleanup path' ;;
  esac
}
trap cleanup_root EXIT HUP INT TERM
mkdir -m 700 -- "$test_root"
cp -- "$source_wrapper" "$source_helper" "$test_root/"
chmod 700 -- "$test_root/generate-account-keys-linux.sh"
chmod 600 -- "$test_root/generate-account-keys.mjs"
chown root:root -- \
  "$test_root/generate-account-keys-linux.sh" \
  "$test_root/generate-account-keys.mjs"

wrapper=$test_root/generate-account-keys-linux.sh
helper=$test_root/generate-account-keys.mjs
operator_parent=$test_root/operator
success_node=$test_root/synthetic-node-success
failure_node=$test_root/synthetic-node-failure
argument_log=$test_root/node-arguments
mkdir -m 700 -- "$operator_parent"

cat >"$success_node" <<EOF
#!/bin/sh
set -eu
printf '%s\n' "\$@" >'$argument_log'
test "\$1" = '$helper'
test "\$2" = '--output-directory'
test "\$#" -eq 3
IFS= read -r received_secret
test "\$received_secret" = '$synthetic_secret'
mkdir -m 700 -- "\$3"
for name in account_legacy_jwt_secret account_jwt_keys account_publishable_key; do
  : >"\$3/\$name"
  chmod 600 -- "\$3/\$name"
done
EOF
cat >"$failure_node" <<EOF
#!/bin/sh
set -eu
IFS= read -r received_secret
test "\$received_secret" = '$synthetic_secret'
exit 42
EOF
chmod 700 -- "$success_node" "$failure_node"
chown root:root -- "$success_node" "$failure_node"

weak_parent=$test_root/weak-parent
mkdir -m 755 -- "$weak_parent"
expect_failure_without_secret \
  "$test_root/weak.stdout" "$test_root/weak.stderr" \
  "$wrapper" --operator-parent "$weak_parent" --node-binary "$success_node"
test -z "$(find "$weak_parent" -mindepth 1 -maxdepth 1 -print -quit)" ||
  fail 'weak parent was changed'

strong_target=$test_root/strong-target
symlink_parent=$test_root/symlink-parent
mkdir -m 700 -- "$strong_target"
ln -s -- "$strong_target" "$symlink_parent"
expect_failure_without_secret \
  "$test_root/symlink.stdout" "$test_root/symlink.stderr" \
  "$wrapper" --operator-parent "$symlink_parent" --node-binary "$success_node"
test -z "$(find "$strong_target" -mindepth 1 -maxdepth 1 -print -quit)" ||
  fail 'symlink target was changed'

mkdir -m 700 -- "$shared_parent"
expect_failure_without_secret \
  "$test_root/shared.stdout" "$test_root/shared.stderr" \
  "$wrapper" --operator-parent "$shared_parent" --node-binary "$success_node"
test -z "$(find "$shared_parent" -mindepth 1 -maxdepth 1 -print -quit)" ||
  fail 'shared temporary parent was changed'

existing_run=$operator_parent/account-keys-run.EXISTING
mkdir -m 700 -- "$existing_run"
printf '%s\n' 'preserve' >"$existing_run/sentinel"
printf '%s\n' "$synthetic_secret" |
  "$wrapper" --operator-parent "$operator_parent" --node-binary "$success_node" \
  >"$test_root/first.stdout" 2>"$test_root/first.stderr"
first_output=$(cat "$test_root/first.stdout")
test -z "$(cat "$test_root/first.stderr")" || fail 'success wrote diagnostics'
test "$(cat "$existing_run/sentinel")" = 'preserve' || fail 'existing run was changed'
case $first_output in
  "$operator_parent"/account-keys-run.*/generated) ;;
  *) fail 'output escaped the trusted operator parent' ;;
esac
test "$(stat -c '%u:%g %a' "$(dirname -- "$first_output")")" = '0:0 700' ||
  fail 'run parent ownership or mode is wrong'
test "$(stat -c '%u:%g %a' "$first_output")" = '0:0 700' ||
  fail 'output ownership or mode is wrong'
test "$(find "$first_output" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 3 ||
  fail 'synthetic node did not receive the output path'
grep -F "$synthetic_secret" "$argument_log" >/dev/null &&
  fail 'secret appeared in child arguments'
grep -F "$synthetic_secret" "$test_root/first.stdout" "$test_root/first.stderr" >/dev/null &&
  fail 'secret appeared in wrapper output'

printf '%s\n' "$synthetic_secret" |
  "$wrapper" --operator-parent "$operator_parent" --node-binary "$success_node" \
  >"$test_root/second.stdout" 2>"$test_root/second.stderr"
second_output=$(cat "$test_root/second.stdout")
test "$second_output" != "$first_output" || fail 'two invocations reused a run parent'

before_failure=$(find "$operator_parent" -mindepth 1 -maxdepth 1 -type d | wc -l)
expect_failure_without_secret \
  "$test_root/failure.stdout" "$test_root/failure.stderr" \
  "$wrapper" --operator-parent "$operator_parent" --node-binary "$failure_node"
after_failure=$(find "$operator_parent" -mindepth 1 -maxdepth 1 -type d | wc -l)
test "$after_failure" -eq "$before_failure" || fail 'failed invocation retained a run parent'

printf '%s\n' 'wrapper root-isolation tests: 6 passed'
