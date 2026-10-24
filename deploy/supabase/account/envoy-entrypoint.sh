#!/bin/sh
set -eu

publishable_key=$(cat /run/secrets/account_publishable_key)
if ! printf '%s' "$publishable_key" | grep -Eq '^sb_publishable_[A-Za-z0-9_-]{16,128}$'; then
  printf '%s\n' 'invalid account publishable key' >&2
  exit 1
fi

escaped_key=$(printf '%s' "$publishable_key" | sed 's/[|&\\]/\\&/g')
sed "s|__APOLLO_ACCOUNT_PUBLISHABLE_KEY__|$escaped_key|g" \
  /etc/apollo-account/envoy.template.yaml > /tmp/envoy.yaml

exec envoy -c /tmp/envoy.yaml --log-level warn
