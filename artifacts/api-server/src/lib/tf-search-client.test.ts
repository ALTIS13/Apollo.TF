import { createSignedBodySignature } from "@workspace/module-runtime-contract";
import {
  TF_SEARCH_ARTIST_DISCOVERY_PATH,
  TF_SEARCH_COMMAND_PATH,
  TF_SEARCH_FREE_COMMAND_PATH,
  TF_SEARCH_SUGGESTIONS_PATH,
  type TfSearchArtistDiscoveryResponse,
  type TfSearchResponse,
  type TfSearchSuggestionsResponse,
} from "../../../../lib/tf-search-contract/src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HttpTfSearchClient,
  TfSearchUnavailableError,
  parseTfSearchClientConfig,
} from "./tf-search-client.js";

const SECRET = "s".repeat(32);
const FIRST_REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_REQUEST_ID = "20000000-0000-4000-8000-000000000002";
const FIRST_NONCE = Buffer.alloc(32, 1).toString("base64url");
const SECOND_NONCE = Buffer.alloc(32, 2).toString("base64url");
const NOW_MS = 1_753_337_100_000;
const SOURCE_REFERENCE_PATH = "/v1/source-reference";
const SOURCE_URL = "https://www.youtube.com/watch?v=AbCdEf01234";
const SOURCE_KEY = "youtube:AbCdEf01234";

function sourceReferenceResponse(requestId = FIRST_REQUEST_ID) {
  return {
    schemaVersion: 1,
    requestId,
    sourceKey: SOURCE_KEY,
    status: "known",
    reference: {
      artist: "Artist",
      title: "Track",
      type: "original",
      expectedDurationSeconds: 232,
      provenance: "catalog",
      observedAt: NOW_MS - 60_000,
      expiresAt: NOW_MS + 240_000,
    },
  };
}

function searchResponse(requestId: string): TfSearchResponse {
  return {
    schemaVersion: 1,
    requestId,
    query: "Artist Track",
    results: [
      {
        id: "yt_result",
        title: "Track",
        artist: "Artist",
        type: "original",
        duration: 180,
        source: "youtube",
        thumbnailUrl: null,
        quality: ["128", "320"],
        viewCount: 42,
        score: 91,
        sourceUrl: "https://www.youtube.com/watch?v=result",
      },
    ],
    cached: false,
    sources: ["yt", "sc", "bc", "dz"],
    fallbackAvailable: false,
    providerStatus: {
      yt: "ok",
      sc: "ok",
      bc: "ok",
      dz: "ok",
    },
  };
}

function suggestionsResponse(requestId: string): TfSearchSuggestionsResponse {
  return {
    schemaVersion: 1,
    requestId,
    suggestions: [{ artist: "Artist", title: "Track" }],
  };
}

function artistDiscoveryResponse(
  requestId: string,
): TfSearchArtistDiscoveryResponse {
  return {
    schemaVersion: 1,
    requestId,
    query: "Artist",
    results: searchResponse(requestId).results,
    sources: ["yt", "sc"],
    providerStatus: {
      yt: "ok",
      sc: "ok",
      bc: "skipped",
      dz: "skipped",
    },
  };
}

function client(
  fetchImplementation: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof HttpTfSearchClient>[0]> = {},
  now: () => number = () => NOW_MS,
) {
  const requestIds = [FIRST_REQUEST_ID, SECOND_REQUEST_ID];
  const nonces = [FIRST_NONCE, SECOND_NONCE];
  return new HttpTfSearchClient(
    {
      origin: "https://search.apollot.ru",
      internalAuthSecret: SECRET,
      timeoutMs: 250,
      ...overrides,
    },
    {
      fetch: fetchImplementation,
      now,
      randomUuid: () => requestIds.shift()!,
      randomNonce: () => nonces.shift()!,
    },
  );
}

describe("parseTfSearchClientConfig", () => {
  it("loads a file-backed secret and accepts an exact HTTPS origin", async () => {
    const readSecret = vi.fn().mockResolvedValue(` ${SECRET}\n`);

    await expect(
      parseTfSearchClientConfig(
        {
          TF_SEARCH_ORIGIN: "https://search.apollot.ru",
          TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf-search",
        },
        readSecret,
      ),
    ).resolves.toEqual({
      origin: "https://search.apollot.ru",
      internalAuthSecret: SECRET,
      timeoutMs: 10_000,
    });
    expect(readSecret).toHaveBeenCalledWith("/run/secrets/tf-search");
  });

  it("allows HTTP only for an exact private service origin with the explicit flag", async () => {
    const readSecret = vi.fn().mockResolvedValue(SECRET);
    await expect(
      parseTfSearchClientConfig(
        {
          TF_SEARCH_ORIGIN: "http://tf-search:8080",
          TF_SEARCH_ALLOW_INSECURE_HTTP: "true",
          TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf-search",
        },
        readSecret,
      ),
    ).resolves.toMatchObject({ origin: "http://tf-search:8080" });

    for (const origin of [
      "http://tf-search:8080",
      "http://10.0.0.5:8080",
      "https://search.apollot.ru/",
      "https://user:pass@search.apollot.ru",
      "https://search.apollot.ru/path",
      "https://search.apollot.ru?query=1",
    ]) {
      await expect(
        parseTfSearchClientConfig(
          {
            TF_SEARCH_ORIGIN: origin,
            TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf-search",
          },
          readSecret,
        ),
      ).rejects.toThrow("invalid runtime configuration");
    }
  });

  it("rejects missing, inline, unreadable, and weak secrets", async () => {
    const base = {
      TF_SEARCH_ORIGIN: "https://search.apollot.ru",
      TF_SEARCH_INTERNAL_AUTH_SECRET: SECRET,
    };
    await expect(
      parseTfSearchClientConfig(base, vi.fn()),
    ).rejects.toThrow("invalid runtime configuration");
    await expect(
      parseTfSearchClientConfig(
        {
          ...base,
          TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf-search",
        },
        vi.fn().mockRejectedValue(new Error("private path")),
      ),
    ).rejects.toThrow("invalid runtime configuration");
    await expect(
      parseTfSearchClientConfig(
        {
          ...base,
          TF_SEARCH_INTERNAL_AUTH_SECRET_FILE: "/run/secrets/tf-search",
        },
        vi.fn().mockResolvedValue("weak"),
      ),
    ).rejects.toThrow("invalid runtime configuration");
  });
});

describe("HttpTfSearchClient", () => {
  it("signs the account-scoped free-text command at its own internal path", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { requestId: string };
      return new Response(JSON.stringify({ ...searchResponse(body.requestId), query: "night music" }), { status: 200 });
    });
    const result = await client(fetchImplementation).freeSearch({
      accountId: "11111111-1111-4111-8111-111111111111",
      query: "night music", mode: "auto", sources: ["yt", "sc", "bc", "dz"], maxResults: 20,
    });
    expect(result.query).toBe("night music");
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(`https://search.apollot.ru${TF_SEARCH_FREE_COMMAND_PATH}`);
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString())).toMatchObject({
      requestId: FIRST_REQUEST_ID,
      accountId: "11111111-1111-4111-8111-111111111111",
      query: "night music",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-apollo-internal-signature")).toBe(createSignedBodySignature({
      method: "POST", path: TF_SEARCH_FREE_COMMAND_PATH,
      timestamp: String(Math.floor(NOW_MS / 1_000)), nonce: FIRST_NONCE,
      rawBody, secret: SECRET,
    }));
  });
  it("sends an exact signed search command without browser or account context", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          requestId: string;
        };
        return new Response(JSON.stringify(searchResponse(body.requestId)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const gateway = client(fetchImplementation);

    const first = await gateway.search({
      artist: "Artist",
      title: "Track",
      mode: "auto",
      sources: ["yt", "sc", "bc", "dz"],
      maxResults: 20,
    });
    await gateway.search({
      artist: "Artist",
      title: "Track",
      mode: "manual",
      sources: ["yt"],
      maxResults: 3,
    });

    expect(first.requestId).toBe(FIRST_REQUEST_ID);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://search.apollot.ru${TF_SEARCH_COMMAND_PATH}`,
    );
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString("utf8"))).toEqual({
      schemaVersion: 1,
      requestId: FIRST_REQUEST_ID,
      artist: "Artist",
      title: "Track",
      mode: "auto",
      sources: ["yt", "sc", "bc", "dz"],
      maxResults: 20,
    });
    const headers = new Headers(init?.headers);
    expect([...headers.keys()].sort()).toEqual([
      "content-type",
      "x-apollo-internal-nonce",
      "x-apollo-internal-signature",
      "x-apollo-internal-timestamp",
    ]);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-apollo-internal-timestamp")).toBe(
      String(Math.floor(NOW_MS / 1_000)),
    );
    expect(headers.get("x-apollo-internal-nonce")).toBe(FIRST_NONCE);
    expect(headers.get("x-apollo-internal-signature")).toBe(
      createSignedBodySignature({
        method: "POST",
        path: TF_SEARCH_COMMAND_PATH,
        timestamp: String(Math.floor(NOW_MS / 1_000)),
        nonce: FIRST_NONCE,
        rawBody,
        secret: SECRET,
      }),
    );
    const serialized = JSON.stringify({
      body: JSON.parse(rawBody.toString("utf8")),
      headers: Object.fromEntries(headers),
    });
    for (const forbidden of [
      "cookie",
      "csrf",
      "account",
      "session",
      "installation",
      "entitlement",
      "authorization",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }

    const secondBody = JSON.parse(
      String(fetchImplementation.mock.calls[1]![1]?.body),
    ) as { requestId: string };
    const secondHeaders = new Headers(
      fetchImplementation.mock.calls[1]![1]?.headers,
    );
    expect(secondBody.requestId).toBe(SECOND_REQUEST_ID);
    expect(secondHeaders.get("x-apollo-internal-nonce")).toBe(SECOND_NONCE);
  });

  it("signs suggestions on their exact path and validates the response ID", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          requestId: string;
        };
        return new Response(
          JSON.stringify(suggestionsResponse(body.requestId)),
          { status: 200 },
        );
      },
    );
    const gateway = client(fetchImplementation);

    await expect(gateway.suggestions(FIRST_REQUEST_ID, "artist", 5)).resolves.toEqual(
      suggestionsResponse(FIRST_REQUEST_ID),
    );
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://search.apollot.ru${TF_SEARCH_SUGGESTIONS_PATH}`,
    );
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString("utf8"))).toEqual({
      schemaVersion: 1,
      requestId: FIRST_REQUEST_ID,
      accountId: FIRST_REQUEST_ID,
      query: "artist",
      limit: 5,
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-apollo-internal-signature")).toBe(
      createSignedBodySignature({
        method: "POST",
        path: TF_SEARCH_SUGGESTIONS_PATH,
        timestamp: String(Math.floor(NOW_MS / 1_000)),
        nonce: FIRST_NONCE,
        rawBody,
        secret: SECRET,
      }),
    );
  });

  it("signs a strict artist-only discovery command without a title field", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          requestId: string;
        };
        return new Response(
          JSON.stringify(artistDiscoveryResponse(body.requestId)),
          { status: 200 },
        );
      },
    );
    const gateway = client(fetchImplementation);

    await expect(
      gateway.discoverArtist({
        artist: "Artist",
        sources: ["yt", "sc"],
        limitPerSource: 6,
      }),
    ).resolves.toEqual(artistDiscoveryResponse(FIRST_REQUEST_ID));

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://search.apollot.ru${TF_SEARCH_ARTIST_DISCOVERY_PATH}`,
    );
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString("utf8"))).toEqual({
      schemaVersion: 1,
      requestId: FIRST_REQUEST_ID,
      artist: "Artist",
      sources: ["yt", "sc"],
      limitPerSource: 6,
    });
    expect(rawBody.toString("utf8")).not.toContain("title");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-apollo-internal-signature")).toBe(
      createSignedBodySignature({
        method: "POST",
        path: TF_SEARCH_ARTIST_DISCOVERY_PATH,
        timestamp: String(Math.floor(NOW_MS / 1_000)),
        nonce: FIRST_NONCE,
        rawBody,
        secret: SECRET,
      }),
    );
  });

  it.each([
    ["transport", () => Promise.reject(new Error("network"))],
    [
      "401",
      () =>
        Promise.resolve(
          new Response('{"error":"unauthorized"}', { status: 401 }),
        ),
    ],
    [
      "malformed JSON",
      () => Promise.resolve(new Response("{", { status: 200 })),
    ],
    [
      "invalid schema",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ...searchResponse(FIRST_REQUEST_ID),
              internal: "leak",
            }),
            { status: 200 },
          ),
        ),
    ],
    [
      "request ID mismatch",
      () =>
        Promise.resolve(
          new Response(JSON.stringify(searchResponse(SECOND_REQUEST_ID)), {
            status: 200,
          }),
        ),
    ],
    [
      "5xx",
      () =>
        Promise.resolve(
          new Response('{"error":"search_unavailable"}', { status: 503 }),
        ),
    ],
  ])("maps %s failures to one typed unavailable error without retry", async (
    _label,
    response,
  ) => {
    const fetchImplementation = vi.fn<typeof fetch>(response);
    const gateway = client(fetchImplementation);

    const error = await gateway
      .search({
        artist: "Artist",
        title: "Track",
        mode: "auto",
        sources: ["yt", "sc", "bc", "dz"],
        maxResults: 20,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TfSearchUnavailableError);
    expect(error).toMatchObject({ code: "search_unavailable" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("aborts a bounded request and maps the timeout without retry", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const gateway = client(fetchImplementation, { timeoutMs: 10 });

    await expect(
      gateway.search({
        artist: "Artist",
        title: "Track",
        mode: "auto",
        sources: ["yt", "sc", "bc", "dz"],
        maxResults: 20,
      }),
    ).rejects.toMatchObject({ code: "search_unavailable" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("HttpTfSearchClient.sourceReference", () => {
  it("dispatches an account-scoped signed lookup and returns the fresh source-bound reference", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify(sourceReferenceResponse()), { status: 200 },
    ));
    const gateway = client(fetchImplementation);
    const result = await gateway.sourceReference?.({ accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL });

    expect(result).toEqual(sourceReferenceResponse());
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(`https://search.apollot.ru${SOURCE_REFERENCE_PATH}`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const rawBody = Buffer.from(String(init?.body));
    expect(JSON.parse(rawBody.toString("utf8"))).toEqual({
      schemaVersion: 1, requestId: FIRST_REQUEST_ID,
      accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
    });
    const headers = new Headers(init?.headers);
    expect([...headers.keys()].sort()).toEqual([
      "content-type", "x-apollo-internal-nonce", "x-apollo-internal-signature", "x-apollo-internal-timestamp",
    ]);
    expect(headers.get("x-apollo-internal-signature")).toBe(createSignedBodySignature({
      method: "POST", path: SOURCE_REFERENCE_PATH,
      timestamp: String(Math.floor(NOW_MS / 1_000)), nonce: FIRST_NONCE,
      rawBody, secret: SECRET,
    }));
  });

  it.each(["known", "unknown", "ambiguous"] as const)(
    "correlates %s results to the canonical source despite YouTube URL aliases and tracking",
    async (status) => {
      const response = status === "known" ? sourceReferenceResponse() : {
        schemaVersion: 1, requestId: FIRST_REQUEST_ID, sourceKey: SOURCE_KEY, status,
      };
      const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)));
      const result = await client(fetchImplementation).sourceReference({
        accountId: FIRST_REQUEST_ID, sourceUrl: "https://youtu.be/AbCdEf01234?utm_source=fixture",
      });
      expect(result).toEqual(response);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it.each(["known", "unknown", "ambiguous"] as const)(
    "rejects %s lookup results bound to a different source",
    async (status) => {
      const response = status === "known" ? sourceReferenceResponse() : {
        schemaVersion: 1, requestId: FIRST_REQUEST_ID, sourceKey: SOURCE_KEY, status,
      };
      const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)));
      await expect(client(fetchImplementation).sourceReference({
        accountId: FIRST_REQUEST_ID, sourceUrl: "https://www.youtube.com/watch?v=ZyXwVu98765",
      })).rejects.toBeInstanceOf(TfSearchUnavailableError);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["future observation", { observedAt: NOW_MS + 1, expiresAt: NOW_MS + 60_000 }],
    ["exact expiry", { observedAt: NOW_MS - 60_000, expiresAt: NOW_MS }],
    ["expired", { observedAt: NOW_MS - 60_000, expiresAt: NOW_MS - 1 }],
    ["zero lifetime", { observedAt: NOW_MS, expiresAt: NOW_MS }],
    ["negative lifetime", { observedAt: NOW_MS, expiresAt: NOW_MS - 1 }],
    ["excessive lifetime", { observedAt: NOW_MS - 1, expiresAt: NOW_MS + 300_000 }],
    ["fractional observation", { observedAt: NOW_MS - 0.5, expiresAt: NOW_MS + 60_000 }],
    ["fractional expiry", { observedAt: NOW_MS, expiresAt: NOW_MS + 60_000.5 }],
  ] as const)("fails closed for known evidence with %s", async (_label, times) => {
    const response = sourceReferenceResponse();
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ...response, reference: { ...response.reference, ...times },
    })));
    await expect(client(fetchImplementation).sourceReference({
      accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
    })).rejects.toMatchObject({ code: "search_unavailable" });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("accepts observation at the current instant with the full five-minute lifetime", async () => {
    const response = sourceReferenceResponse();
    const reference = { ...response.reference, observedAt: NOW_MS, expiresAt: NOW_MS + 300_000 };
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...response, reference })));
    await expect(client(fetchImplementation).sourceReference({
      accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
    })).resolves.toEqual({ ...response, reference });
  });

  it("checks freshness on response receipt rather than only when dispatching", async () => {
    let now = NOW_MS;
    const response = sourceReferenceResponse();
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      now += 100;
      return new Response(JSON.stringify({
        ...response, reference: { ...response.reference, observedAt: NOW_MS, expiresAt: NOW_MS + 100 },
      }));
    });
    await expect(client(fetchImplementation, {}, () => now).sourceReference({
      accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
    })).rejects.toBeInstanceOf(TfSearchUnavailableError);
  });

  it.each([
    ["HTTP 503", () => new Response("{}", { status: 503 })],
    ["malformed JSON", () => new Response("{")],
    ["request ID mismatch", () => new Response(JSON.stringify(sourceReferenceResponse(SECOND_REQUEST_ID)))],
    ["unknown fields", () => new Response(JSON.stringify({ ...sourceReferenceResponse(), extra: "untrusted" }))],
    ["known without reference", () => new Response(JSON.stringify({
      schemaVersion: 1, requestId: FIRST_REQUEST_ID, sourceKey: SOURCE_KEY, status: "known",
    }))],
    ["unknown with reference", () => new Response(JSON.stringify({ ...sourceReferenceResponse(), status: "unknown" }))],
    ["oversized content length", () => new Response("{}", { headers: { "content-length": "1048577" } })],
    ["oversized streamed body", () => new Response(" ".repeat(1024 * 1024 + 1))],
  ] as const)("preserves dispatch rejection for %s without retry", async (_label, makeResponse) => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => makeResponse());
    await expect(client(fetchImplementation).sourceReference({
      accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
    })).rejects.toBeInstanceOf(TfSearchUnavailableError);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid account", { accountId: "invalid", sourceUrl: SOURCE_URL }],
    ["unsupported origin", { accountId: FIRST_REQUEST_ID, sourceUrl: "https://attacker.invalid/track" }],
    ["HTTP source", { accountId: FIRST_REQUEST_ID, sourceUrl: "http://www.youtube.com/watch?v=AbCdEf01234" }],
    ["ambiguous video", { accountId: FIRST_REQUEST_ID, sourceUrl: "https://www.youtube.com/watch?v=AbCdEf01234&v=ZyXwVu98765" }],
    ["caller metadata", { accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL, artist: "Browser Hint" }],
  ] as const)("rejects %s before sending any lookup", async (_label, input) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(client(fetchImplementation).sourceReference(input)).rejects.toBeInstanceOf(TfSearchUnavailableError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  describe("source-reference deadline", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function heldFetch() {
      const requests: Array<{ readonly signal: AbortSignal | null | undefined; readonly resolve: (response: Response) => void }> = [];
      const implementation = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        requests.push({ signal, resolve });
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
      return { implementation, requests };
    }

    it("allows a source reference after twelve seconds despite the ordinary ten-second budget", async () => {
      const fixture = heldFetch();
      const result = client(fixture.implementation, { timeoutMs: 10_000 }).sourceReference({
        accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(12_000);
      fixture.requests[0]!.resolve(new Response(JSON.stringify(sourceReferenceResponse())));

      expect(await result).toEqual(sourceReferenceResponse());
      expect(fixture.requests[0]!.signal?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("actually aborts its own twenty-second default deadline without retry", async () => {
      const fixture = heldFetch();
      const result = client(fixture.implementation, { timeoutMs: 10_000 }).sourceReference({
        accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(fixture.requests[0]!.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.requests[0]!.signal?.aborted).toBe(true);
      expect(await result).toBeInstanceOf(TfSearchUnavailableError);
      expect(fixture.implementation).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([1, 30_000])("honors a bounded explicit source-reference deadline of %s ms", async (sourceReferenceTimeoutMs) => {
      const fixture = heldFetch();
      const result = client(fixture.implementation, { timeoutMs: 10_000, sourceReferenceTimeoutMs }).sourceReference({
        accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(sourceReferenceTimeoutMs - 1);
      expect(fixture.requests[0]!.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.requests[0]!.signal?.aborted).toBe(true);
      expect(await result).toBeInstanceOf(TfSearchUnavailableError);
      expect(fixture.implementation).toHaveBeenCalledOnce();
    });

    it.each([0, -1, 30_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects an invalid source-reference deadline %s before fetching",
      (sourceReferenceTimeoutMs) => {
        const fixture = heldFetch();
        expect(() => client(fixture.implementation, { sourceReferenceTimeoutMs }))
          .toThrow("invalid TF search client configuration");
        expect(fixture.implementation).not.toHaveBeenCalled();
      },
    );

    it("keeps ordinary search on its original deadline alongside a longer source lookup", async () => {
      const fixture = heldFetch();
      const gateway = client(fixture.implementation, { timeoutMs: 10_000, sourceReferenceTimeoutMs: 20_000 });
      const lookup = gateway.sourceReference({ accountId: FIRST_REQUEST_ID, sourceUrl: SOURCE_URL })
        .catch((error: unknown) => error);
      const search = gateway.search({ artist: "Artist", title: "Track", mode: "manual", sources: ["yt"], maxResults: 1 })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await search).toBeInstanceOf(TfSearchUnavailableError);
      expect(fixture.requests[1]!.signal?.aborted).toBe(true);
      expect(fixture.requests[0]!.signal?.aborted).toBe(false);
      fixture.requests[0]!.resolve(new Response(JSON.stringify(sourceReferenceResponse())));
      expect(await lookup).toEqual(sourceReferenceResponse());
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
