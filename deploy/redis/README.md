# TF production Redis inputs

`deploy/coolify/apollo-tf.compose.yml` keeps TF Redis private and persistent and
expects four operator-created files below `TF_SECRET_DIRECTORY`:

- `tf_redis_acl`: Redis ACL file with `default` disabled and separate
  `tf-auth`, `tf-cache`, and `tf-health` users. The health user needs only
  `PING`; application users receive only the command/key permissions required
  by the accepted TF stores.
- `tf_redis_health_password`: the generated password belonging to the
  `tf-health` ACL entry. The healthcheck reads it from the mount; it is not a
  Compose environment value or command argument.
- `tf_auth_redis_url`: exact authenticated `redis:`/`rediss:` URL for
  `tf-redis:6379/1`.
- `tf_cache_redis_url`: exact authenticated `redis:`/`rediss:` URL for
  `tf-redis:6379/0`.

The URL files are raw UTF-8 with no trailing newline, whitespace, query, or
fragment. Keep each regular, non-symlink file at mode `0400` for its mounted
UID. The named `apollo-tf-redis-v1` volume retains AOF data; Redis has no host
port and is not shared with Platform or Quasar.

Renewal activation is one Compose overlay, never a set of hand-applied
variables:

```text
docker compose --env-file <reviewed-release-env> \
  -f deploy/coolify/apollo-tf.compose.yml \
  -f deploy/coolify/apollo-tf.production-binding.compose.yml config
```

The release publisher's optional `--tf-successor-ws-enabled true|false`
selection is baked into the immutable Web image and emitted as
`TF_SUCCESSOR_WS_ENABLED` for the API overlay. Omission means `false`.
