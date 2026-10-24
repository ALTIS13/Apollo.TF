# Apollo Account Supabase provenance

The staging topology is a reduced Auth-only adaptation of Supabase's Apache-2.0 self-hosted Docker release `self-hosted/v0.8.0`, resolved at repository commit `e1af732589cd468edb49500ebc04e4367d4c56ad` on 2026-09-05.

Only the official `supabase/postgres`, `supabase/gotrue`, and Envoy component versions from that tested release are used. The upstream database role initialization is retained in `roles.sql`; unrelated Studio, PostgREST, Realtime, Storage, Functions, Analytics, and pooler services are intentionally absent. Mailpit is a staging-only SMTP capture and is never a production mail relay.

Registry multi-platform manifest digests were resolved independently for all four images. Before a future update, review the upstream Docker changelog and use the recorded `.supabase-version` as the three-way-merge base. Supabase's updater does not back up PostgreSQL data.

No file in this directory contains a deployed password, private key, JWT, API key, or HomeNode secret path other than the documented operator-owned root.
