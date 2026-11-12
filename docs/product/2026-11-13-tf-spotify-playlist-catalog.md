# Spotify playlist catalog paging

The Web playlist catalog reads one bounded page from the connected user's [Spotify playlist endpoint](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists) per page action. This is separate from choosing a track range within a playlist. The legacy TF list route and its signed operation are kept for older consumers.

The adapter uses Spotify's documented limit of 50 and maximum offset of 100,000. It computes the next offset from upstream slots consumed, not from the number of rows it can show or from the provider's next URL. In the `items` profile, [Spotify can omit contents](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide#playlist) for followed playlists the user does not own or collaborate on. Those rows are not offered as importable. An empty visible page can still have a next page; at the provider offset cap the last valid page is retained without a next link. The reported total is Spotify's total slots, not an estimate of readable playlists. The catalog is not a frozen snapshot; concurrent edits at Spotify can move rows between requests.

The page is scoped to the TF account, installation and connected Spotify account. It does not request audio, change provider permissions or create a draft. The existing explicit range preview and confirmation still govern draft writes. Keep `429` handling and reconnect behavior unchanged. Enable the updated Web client only once both the TF API and integrations images support the new operation; do not treat the additive command as support from an older image.

## Verification

- 13 contract, 80 provider/service, 57 API and policy, and 111 focused Web checks passed. API, integrations and Web builds passed. An earlier broader Web run timed out in `retries a broken stream from the position chosen after its failure`; the same case passed in the focused rerun. This is not a full-workspace green claim.
- Chrome on the final production Web build read offsets `0, 50, 100, 150, 200, 250, 280` from a loopback fixture. Offset 250 returned no readable rows and still offered Next. The user could open the playlist at offset 280, return to page 7, and go Back to the cached empty page 6 without another request. The receipt recorded one playlist detail read, no writes, and no unexpected requests. The fixture was stopped.
- Static REA analysis of the integrations `index.mjs` parsed one file without errors (`ev_ea145520c8645fa15f19594e423c941cf497ea90b10b180093bc280a699c88ae`, SHA-256 `1c5622976971f32502d0512fb0175cd8cfdb5f1ed2a1e35e72d027d219f08453`). The artifact contains the new operation and offset path. This is not provider or registry evidence.

This source change does not activate a Spotify application, verify live OAuth scopes or promote the frozen TF runtime candidate.
