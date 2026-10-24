#!/bin/sh

set +x
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

usage='usage: generate-account-keys-linux.sh --operator-parent ABSOLUTE_DIRECTORY --node-binary ABSOLUTE_FILE'
run_parent=
run_identity=
cleanup_pending=0

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

unsafe_permissions() {
  case $1 in
    ?????w???? | ????????w?) return 0 ;;
    *) return 1 ;;
  esac
}

require_safe_ancestry() {
  current=$1
  while :; do
    owner=$(/usr/bin/stat -c '%u' -- "$current") ||
      fail 'trusted path ancestry is unavailable'
    permissions=$(/usr/bin/stat -c '%A' -- "$current") ||
      fail 'trusted path ancestry is unavailable'
    [ "$owner" = '0' ] || fail 'trusted path ancestry must be root-owned'
    if unsafe_permissions "$permissions"; then
      fail 'trusted path ancestry must not be group/world writable'
    fi
    [ "$current" = '/' ] && break
    current=${current%/*}
    [ -n "$current" ] || current=/
  done
}

require_safe_file() {
  candidate=$1
  executable=$2
  case $candidate in
    /*) ;;
    *) fail 'trusted executable/source paths must be absolute' ;;
  esac
  [ -f "$candidate" ] || fail 'trusted executable/source file is unavailable'
  [ ! -L "$candidate" ] || fail 'trusted executable/source file must not be a symlink'
  canonical=$(/usr/bin/realpath -e -- "$candidate") ||
    fail 'trusted executable/source file is unavailable'
  [ "$canonical" = "$candidate" ] ||
    fail 'trusted executable/source path must be canonical and contain no symlink'
  [ "$(/usr/bin/stat -c '%u:%g' -- "$candidate")" = '0:0' ] ||
    fail 'trusted executable/source file must be owned by root:root'
  permissions=$(/usr/bin/stat -c '%A' -- "$candidate") ||
    fail 'trusted executable/source file metadata is unavailable'
  if unsafe_permissions "$permissions"; then
    fail 'trusted executable/source file must not be group/world writable'
  fi
  if [ "$executable" = 'yes' ]; then
    [ -x "$candidate" ] || fail 'trusted executable is not executable'
  fi
  require_safe_ancestry "${candidate%/*}"
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$cleanup_pending" = '1' ]; then
    current_identity=
    if [ -d "$run_parent" ] && [ ! -L "$run_parent" ]; then
      current_identity=$(/usr/bin/stat -c '%d:%i' -- "$run_parent" 2>/dev/null || true)
    fi
    case $run_parent in
      "$operator_parent"/account-keys-run.*) safe_name=yes ;;
      *) safe_name=no ;;
    esac
    if [ "$safe_name" = 'yes' ] &&
      [ "$current_identity" = "$run_identity" ] &&
      [ "$(/usr/bin/stat -c '%u:%g %a' -- "$run_parent" 2>/dev/null || true)" = '0:0 700' ]; then
      /usr/bin/rm -rf -- "$run_parent"
    else
      printf '%s\n' 'generation failed; refusing automatic cleanup of an unverified path' >&2
    fi
  fi
  exit "$status"
}

[ "$(/usr/bin/id -u)" = '0' ] || fail 'key generation wrapper must run as root'
[ "$#" -eq 4 ] || fail "$usage"
[ "$1" = '--operator-parent' ] || fail "$usage"
operator_parent=$2
[ "$3" = '--node-binary' ] || fail "$usage"
node_binary=$4

case $operator_parent in
  /*) ;;
  *) fail 'operator parent must be an absolute path' ;;
esac
case $operator_parent in
  /tmp | /tmp/* | /var/tmp | /var/tmp/* | /dev/shm | /dev/shm/* | /run/user | /run/user/*)
    fail 'shared temporary locations are not trusted operator parents'
    ;;
esac
[ -d "$operator_parent" ] || fail 'operator parent is unavailable'
[ ! -L "$operator_parent" ] || fail 'operator parent must not be a symlink'
canonical_parent=$(/usr/bin/realpath -e -- "$operator_parent") ||
  fail 'operator parent is unavailable'
[ "$canonical_parent" = "$operator_parent" ] ||
  fail 'operator parent must be canonical and contain no symlink'
[ "$(/usr/bin/stat -c '%u:%g %a' -- "$operator_parent")" = '0:0 700' ] ||
  fail 'operator parent must be owned by root:root with mode 0700'
require_safe_ancestry "${operator_parent%/*}"

case $0 in
  */*) ;;
  *) fail 'invoke the wrapper by an explicit path' ;;
esac
[ ! -L "$0" ] || fail 'wrapper source must not be a symlink'
wrapper_path=$(/usr/bin/realpath -e -- "$0") || fail 'wrapper source is unavailable'
require_safe_file "$wrapper_path" yes
helper_path=${wrapper_path%/*}/generate-account-keys.mjs
require_safe_file "$helper_path" no
require_safe_file "$node_binary" yes

umask 077
run_parent=$(/usr/bin/mktemp -d -- "$operator_parent/account-keys-run.XXXXXXXXXX") ||
  fail 'could not create an exclusive run parent'
/usr/bin/chmod 700 -- "$run_parent"
[ "$(/usr/bin/stat -c '%u:%g %a' -- "$run_parent")" = '0:0 700' ] ||
  fail 'exclusive run parent ownership or mode is invalid'
run_identity=$(/usr/bin/stat -c '%d:%i' -- "$run_parent") ||
  fail 'exclusive run parent identity is unavailable'
cleanup_pending=1
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

output_path=$run_parent/generated
/usr/bin/env -i \
  HOME=/root \
  PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  "$node_binary" "$helper_path" --output-directory "$output_path"

[ -d "$output_path" ] || fail 'key generation did not publish its output directory'
[ ! -L "$output_path" ] || fail 'key generation published an invalid output path'
[ "$(/usr/bin/realpath -e -- "$output_path")" = "$output_path" ] ||
  fail 'key generation published a noncanonical output path'
[ "$(/usr/bin/stat -c '%u:%g %a' -- "$output_path")" = '0:0 700' ] ||
  fail 'key generation output ownership or mode is invalid'

cleanup_pending=0
trap - EXIT HUP INT TERM
printf '%s\n' "$output_path"
