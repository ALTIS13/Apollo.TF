import { z } from "zod";

export const TF_INTEGRATIONS_COMMAND_PATH = "/v1/commands";

const MAX_URL_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_COLLECTION_ITEMS = 50;
const MAX_OFFSET = 1_000_000;
const MAX_PLAYLIST_PART = 2_147_483_647;

const canonicalUuidSchema = z
  .string()
  .uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const boundedTextSchema = (max: number) => z.string().trim().min(1).max(max);
const identifierSchema = boundedTextSchema(MAX_IDENTIFIER_LENGTH);
const isPublicHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};
const nullableHttpsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URL_LENGTH)
  .url()
  .refine(isPublicHttpsUrl, {
    message:
      "Expected a public HTTPS URL without credentials, query, or fragment",
  })
  .nullable();
const paginationInputSchema = z
  .object({
    offset: z.number().finite().int().min(0).max(MAX_OFFSET),
    limit: z.number().finite().int().min(1).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

const spotifyCallbackUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.pathname === "/api/spotify/callback" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  }, "Expected an exact HTTPS Spotify callback URI");

const spotifyAuthorizationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      if (
        url.origin !== "https://accounts.spotify.com" ||
        url.pathname !== "/authorize" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== ""
      ) {
        return false;
      }

      const allowedKeys = new Set([
        "client_id",
        "response_type",
        "redirect_uri",
        "state",
        "scope",
        "show_dialog",
      ]);
      const seenKeys = new Set<string>();
      for (const [key, queryValue] of url.searchParams) {
        if (
          !allowedKeys.has(key) ||
          seenKeys.has(key) ||
          queryValue.length === 0
        ) {
          return false;
        }
        seenKeys.add(key);
      }

      return (
        seenKeys.has("client_id") &&
        url.searchParams.get("response_type") === "code" &&
        spotifyCallbackUriSchema.safeParse(url.searchParams.get("redirect_uri"))
          .success &&
        boundedTextSchema(8_192).safeParse(url.searchParams.get("state"))
          .success &&
        boundedTextSchema(1_024).safeParse(url.searchParams.get("scope"))
          .success &&
        (!seenKeys.has("show_dialog") ||
          ["true", "false"].includes(url.searchParams.get("show_dialog")!))
      );
    } catch {
      return false;
    }
  }, "Expected a bounded Spotify OAuth authorization URL");

export const tfIntegrationOperationSchema = z.enum([
  "spotify.oauth.authorize",
  "spotify.oauth.complete",
  "spotify.status",
  "spotify.disconnect",
  "spotify.liked.list",
  "spotify.playlists.list",
  "spotify.playlists.page",
  "spotify.playlist-tracks.list",
  "spotify.top-tracks.list",
  "spotify.albums.list",
  "spotify.album-tracks.list",
  "yandex.token.upsert",
  "yandex.status",
  "yandex.disconnect",
  "yandex.liked.list",
  "yandex.playlists.list",
  "yandex.playlist-tracks.list",
]);

const spotifyAuthorizeInputSchema = z
  .object({
    state: boundedTextSchema(8_192),
    callbackUri: spotifyCallbackUriSchema,
  })
  .strict();
const spotifyCompleteInputSchema = z
  .object({
    code: boundedTextSchema(8_192),
    callbackUri: spotifyCallbackUriSchema,
  })
  .strict();
const emptyInputSchema = z.object({}).strict();
const spotifyPlaylistTracksInputSchema = paginationInputSchema
  .extend({ playlistId: identifierSchema })
  .strict();
export const spotifyCatalogIdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
export const SPOTIFY_PLAYLIST_MAX_OFFSET = 100_000;
export const SPOTIFY_PLAYLIST_PAGE_SIZE = 50;
const playlistCatalogOffsetSchema = z.number().int().min(0).max(SPOTIFY_PLAYLIST_MAX_OFFSET);
const playlistCatalogLimitSchema = z.number().int().min(1).max(SPOTIFY_PLAYLIST_PAGE_SIZE);
const spotifyPlaylistsPageInputSchema = z.object({
  offset: playlistCatalogOffsetSchema,
  limit: playlistCatalogLimitSchema,
}).strict();
export const SPOTIFY_SAVED_ALBUMS_PAGE_SIZE = 10;
const savedAlbumsLimitSchema = z.number().int().min(1).max(SPOTIFY_SAVED_ALBUMS_PAGE_SIZE);
const spotifySavedAlbumsInputSchema = paginationInputSchema.extend({ limit: savedAlbumsLimitSchema }).strict();
const spotifyAlbumTracksInputSchema = paginationInputSchema
  .extend({ albumId: spotifyCatalogIdSchema })
  .strict();
const spotifyTopTracksInputSchema = z
  .object({ timeRange: z.enum(["short_term", "medium_term", "long_term"]) })
  .strict();
const yandexTokenInputSchema = z
  .object({ token: z.string().min(10).max(8_192) })
  .strict();
const yandexPlaylistTracksInputSchema = paginationInputSchema
  .extend({
    uid: z.number().finite().int().min(1).max(MAX_PLAYLIST_PART),
    kind: z.number().finite().int().min(1).max(MAX_PLAYLIST_PART),
  })
  .strict();

const commandBaseSchema = {
  schemaVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
};

const tfIntegrationsCommandObjectSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.oauth.authorize"),
      input: spotifyAuthorizeInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.oauth.complete"),
      input: spotifyCompleteInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.status"),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.disconnect"),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.liked.list"),
      input: paginationInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.playlists.list"),
      input: emptyInputSchema,
    })
    .strict(),
  z.object({
    ...commandBaseSchema,
    operation: z.literal("spotify.playlists.page"),
    input: spotifyPlaylistsPageInputSchema,
  }).strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.playlist-tracks.list"),
      input: spotifyPlaylistTracksInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("spotify.top-tracks.list"),
      input: spotifyTopTracksInputSchema,
    })
    .strict(),
  z.object({
    ...commandBaseSchema,
    operation: z.literal("spotify.albums.list"),
    input: spotifySavedAlbumsInputSchema,
  }).strict(),
  z.object({
    ...commandBaseSchema,
    operation: z.literal("spotify.album-tracks.list"),
    input: spotifyAlbumTracksInputSchema,
  }).strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.token.upsert"),
      input: yandexTokenInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.status"),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.disconnect"),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.liked.list"),
      input: paginationInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.playlists.list"),
      input: emptyInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseSchema,
      operation: z.literal("yandex.playlist-tracks.list"),
      input: yandexPlaylistTracksInputSchema,
    })
    .strict(),
]);

const normalizedTrackObjectSchema = z
  .object({
    id: identifierSchema,
    title: boundedTextSchema(500),
    artist: boundedTextSchema(300),
    album: boundedTextSchema(500),
    duration: z.number().finite().int().min(0).max(86_400),
    thumbnailUrl: nullableHttpsUrlSchema,
    providerUrl: nullableHttpsUrlSchema.unwrap(),
  })
  .strict();

const spotifyPlaylistObjectSchema = z
  .object({
    id: identifierSchema,
    name: boundedTextSchema(500),
    description: z.string().trim().max(4_096),
    trackCount: z.number().finite().int().min(0).max(MAX_OFFSET),
    thumbnailUrl: nullableHttpsUrlSchema,
    owner: boundedTextSchema(500),
  })
  .strict();

const yandexPlaylistObjectSchema = z
  .object({
    uid: z.number().finite().int().min(1).max(MAX_PLAYLIST_PART),
    kind: z.number().finite().int().min(1).max(MAX_PLAYLIST_PART),
    title: boundedTextSchema(500),
    description: z.string().trim().max(4_096),
    trackCount: z.number().finite().int().min(0).max(MAX_OFFSET),
    thumbnailUrl: nullableHttpsUrlSchema,
    owner: boundedTextSchema(500),
  })
  .strict();

const connectedAccountSchema = <
  TProvider extends "spotify" | "yandex",
  TAccount extends z.ZodTypeAny,
>(
  provider: TProvider,
  account: TAccount,
) =>
  z
    .object({
      provider: z.literal(provider),
      connected: z.literal(true),
      account,
    })
    .strict();

const disconnectedAccountSchema = (provider: "spotify" | "yandex") =>
  z
    .object({ provider: z.literal(provider), connected: z.literal(false) })
    .strict();

const spotifyConnectedAccountSchema = connectedAccountSchema(
  "spotify",
  z
    .object({
      id: identifierSchema,
      displayName: boundedTextSchema(500),
    })
    .strict(),
);
const yandexConnectedAccountSchema = connectedAccountSchema(
  "yandex",
  z
    .object({
      id: identifierSchema,
      login: boundedTextSchema(500),
      displayName: boundedTextSchema(500),
    })
    .strict(),
);
const spotifyAccountSummaryObjectSchema = z.union([
  spotifyConnectedAccountSchema,
  disconnectedAccountSchema("spotify"),
]);
const yandexAccountSummaryObjectSchema = z.union([
  yandexConnectedAccountSchema,
  disconnectedAccountSchema("yandex"),
]);

const tracksPageSchema = z
  .object({
    offset: z.number().finite().int().min(0).max(MAX_OFFSET),
    limit: z.number().finite().int().min(1).max(MAX_COLLECTION_ITEMS),
    total: z.number().finite().int().min(0).max(MAX_OFFSET),
    tracks: z.array(normalizedTrackObjectSchema).max(MAX_COLLECTION_ITEMS),
  })
  .strict();
const albumPageBounds = tracksPageSchema.pick({ offset: true, limit: true, total: true });
const spotifyAlbumObjectSchema = normalizedTrackObjectSchema
  .pick({ title: true, artist: true, thumbnailUrl: true, providerUrl: true })
  .extend({ id: spotifyCatalogIdSchema, trackCount: z.number().int().min(0).max(MAX_OFFSET) })
  .strict()
  .refine((album) => album.providerUrl === `https://open.spotify.com/album/${album.id}`, "Expected exact Spotify album link");
const spotifyAlbumTrackObjectSchema = normalizedTrackObjectSchema
  .pick({ title: true, artist: true, duration: true, providerUrl: true })
  .extend({
    id: spotifyCatalogIdSchema,
    discNumber: z.number().int().min(1).max(MAX_OFFSET),
    trackNumber: z.number().int().min(1).max(MAX_OFFSET),
  })
  .strict()
  .refine((track) => track.providerUrl === `https://open.spotify.com/track/${track.id}`, "Expected exact Spotify track link");
const spotifyAlbumsPageSchema = albumPageBounds
  .extend({ limit: savedAlbumsLimitSchema, albums: z.array(spotifyAlbumObjectSchema).max(SPOTIFY_SAVED_ALBUMS_PAGE_SIZE) }).strict();
const spotifyAlbumTracksPageSchema = albumPageBounds
  .extend({ tracks: z.array(spotifyAlbumTrackObjectSchema).max(MAX_COLLECTION_ITEMS) }).strict();
const spotifyPlaylistsResultSchema = z
  .object({
    playlists: z.array(spotifyPlaylistObjectSchema).max(MAX_COLLECTION_ITEMS),
    total: z.number().finite().int().min(0).max(MAX_OFFSET),
  })
  .strict();
const spotifyPlaylistsPageSchema = spotifyPlaylistsResultSchema
  .extend({
    ...spotifyPlaylistsPageInputSchema.shape,
    nextOffset: playlistCatalogOffsetSchema.nullable(),
  })
  .refine(({ offset, limit, total, nextOffset, playlists }) => {
    const readableCount = playlists.length;
    return readableCount <= Math.min(limit, Math.max(0, total - offset)) &&
      (nextOffset === null ||
        (nextOffset > offset && nextOffset < total &&
          nextOffset >= offset + readableCount && nextOffset <= offset + limit));
  }, "Invalid Spotify playlist page");
const yandexPlaylistsResultSchema = z
  .object({
    playlists: z.array(yandexPlaylistObjectSchema).max(MAX_COLLECTION_ITEMS),
    total: z.number().finite().int().min(0).max(MAX_OFFSET),
  })
  .strict();
const tracksResultSchema = z
  .object({
    tracks: z.array(normalizedTrackObjectSchema).max(MAX_COLLECTION_ITEMS),
  })
  .strict();
const connectedSpotifyResultSchema = z
  .object({ account: spotifyConnectedAccountSchema })
  .strict();
const connectedYandexResultSchema = z
  .object({ account: yandexConnectedAccountSchema })
  .strict();
const spotifyStatusResultSchema = z
  .object({ account: spotifyAccountSummaryObjectSchema })
  .strict();
const yandexStatusResultSchema = z
  .object({ account: yandexAccountSummaryObjectSchema })
  .strict();
const disconnectResultSchema = z.object({ ok: z.literal(true) }).strict();
const spotifyAuthorizationResultSchema = z
  .object({ authorizationUrl: spotifyAuthorizationUrlSchema })
  .strict();

const responseBaseSchema = {
  schemaVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
};

const tfIntegrationsSuccessResponseObjectSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.oauth.authorize"),
        result: spotifyAuthorizationResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.oauth.complete"),
        result: connectedSpotifyResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.status"),
        result: spotifyStatusResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.disconnect"),
        result: disconnectResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.liked.list"),
        result: tracksPageSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.playlists.list"),
        result: spotifyPlaylistsResultSchema,
      })
      .strict(),
    z.object({
      ...responseBaseSchema,
      operation: z.literal("spotify.playlists.page"),
      result: spotifyPlaylistsPageSchema,
    }).strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.playlist-tracks.list"),
        result: tracksPageSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("spotify.top-tracks.list"),
        result: tracksResultSchema,
      })
      .strict(),
    z.object({
      ...responseBaseSchema,
      operation: z.literal("spotify.albums.list"),
      result: spotifyAlbumsPageSchema,
    }).strict(),
    z.object({
      ...responseBaseSchema,
      operation: z.literal("spotify.album-tracks.list"),
      result: spotifyAlbumTracksPageSchema,
    }).strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.token.upsert"),
        result: connectedYandexResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.status"),
        result: yandexStatusResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.disconnect"),
        result: disconnectResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.liked.list"),
        result: tracksPageSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.playlists.list"),
        result: yandexPlaylistsResultSchema,
      })
      .strict(),
    z
      .object({
        ...responseBaseSchema,
        operation: z.literal("yandex.playlist-tracks.list"),
        result: tracksPageSchema,
      })
      .strict(),
  ],
);

export const TF_INTEGRATIONS_MAX_RETRY_AFTER_SECONDS = 86_400;

const otherIntegrationErrorCodeSchema = z.enum([
  "not_connected",
  "provider_rejected",
  "provider_unavailable",
  "storage_unavailable",
  "invalid_provider_response",
]);

export const tfIntegrationErrorCodeSchema = z.enum([
  ...otherIntegrationErrorCodeSchema.options,
  "provider_rate_limited",
]);

const tfIntegrationsErrorResponseObjectSchema = z
  .object({
    ...responseBaseSchema,
    operation: tfIntegrationOperationSchema,
    error: z.discriminatedUnion("code", [
      z.object({ code: otherIntegrationErrorCodeSchema }).strict(),
      z
        .object({
          code: z.literal(tfIntegrationErrorCodeSchema.enum.provider_rate_limited),
          retryAfterSeconds: z
            .number()
            .int()
            .min(0)
            .max(TF_INTEGRATIONS_MAX_RETRY_AFTER_SECONDS)
            .optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export type TfIntegrationOperation = z.infer<
  typeof tfIntegrationOperationSchema
>;
export type NormalizedTrack = z.infer<typeof normalizedTrackObjectSchema>;
export type SpotifyPlaylist = z.infer<typeof spotifyPlaylistObjectSchema>;
export type SpotifyPlaylistsPage = z.infer<typeof spotifyPlaylistsPageSchema>;
export type SpotifyAlbumsPage = z.infer<typeof spotifyAlbumsPageSchema>;
export type SpotifyAlbumTracksPage = z.infer<typeof spotifyAlbumTracksPageSchema>;
export type YandexPlaylist = z.infer<typeof yandexPlaylistObjectSchema>;
export type TfIntegrationsAccountSummary =
  | z.infer<typeof spotifyAccountSummaryObjectSchema>
  | z.infer<typeof yandexAccountSummaryObjectSchema>;
export type TfIntegrationsCommand = z.infer<
  typeof tfIntegrationsCommandObjectSchema
>;
export type TfIntegrationsSuccessResponse = z.infer<
  typeof tfIntegrationsSuccessResponseObjectSchema
>;
export type TfIntegrationsErrorResponse = z.infer<
  typeof tfIntegrationsErrorResponseObjectSchema
>;

export const tfIntegrationsCommandSchema: z.ZodType<TfIntegrationsCommand> =
  tfIntegrationsCommandObjectSchema;
export const tfIntegrationsSuccessResponseSchema: z.ZodType<TfIntegrationsSuccessResponse> =
  tfIntegrationsSuccessResponseObjectSchema;
export const tfIntegrationsErrorResponseSchema: z.ZodType<TfIntegrationsErrorResponse> =
  tfIntegrationsErrorResponseObjectSchema;
