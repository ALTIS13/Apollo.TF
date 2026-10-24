import { describe, expect, it } from "vitest";
import {
  canonicalSourceKey,
  TF_SOURCE_REFERENCE_PATH,
  tfSourceReferenceCommandSchema,
  tfSourceReferenceResponseSchema,
} from "./source-reference";

const video = "BaW_jenozKc";
const requestId = "10000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: 1, requestId, accountId: requestId,
  sourceUrl: `https://www.youtube.com/watch?v=${video}`,
};
const reference = {
  artist: "Artist", title: "Track (2011 Remaster)", type: "original",
  expectedDurationSeconds: 210, provenance: "catalog", observedAt: 1_000, expiresAt: 301_000,
};
const known = { schemaVersion: 1, requestId, sourceKey: `youtube:${video}`, status: "known", reference };

describe("private source reference contract", () => {
  it("is available through the additive package subpath", async () => {
    const subpath = await import("@workspace/tf-search-contract/source-reference");
    expect(subpath.TF_SOURCE_REFERENCE_PATH).toBe("/v1/source-reference");
    expect(TF_SOURCE_REFERENCE_PATH).toBe(subpath.TF_SOURCE_REFERENCE_PATH);
  });

  it.each([
    `https://youtube.com/watch?v=${video}&utm_source=share`,
    `https://www.youtube.com/watch?feature=shared&v=${video}`,
    `https://m.youtube.com/watch?v=${video}&t=10`,
    `https://youtu.be/${video}?si=tracking`,
    `https://www.youtube.com/shorts/${video}`,
    `https://youtube.com/embed/${video}?autoplay=1`,
    `https://youtube.com/live/${video}`,
  ])("uses one video identity for %s", (url) => {
    expect(canonicalSourceKey(url)).toBe(`youtube:${video}`);
  });

  it.each([
    ["https://m.soundcloud.com/Artist/Track?in=playlist&secret_token=s-test&unknown_campaign=test", "https://soundcloud.com/Artist/Track"],
    ["https://artist.bandcamp.com/track/Track?download=1&unknown_campaign=test", "https://artist.bandcamp.com/track/Track"],
  ])("removes tracking without merging meaningful path case: %s", (url, clean) => {
    expect(canonicalSourceKey(url)).toBe(canonicalSourceKey(clean));
    expect(canonicalSourceKey(clean)).not.toBe(canonicalSourceKey(clean.replace("/Track", "/track")));
  });

  it.each([
    ["https://soundcloud.com/artist/%54r%61ck%2d%5f%7e%2e%31", "soundcloud:https://soundcloud.com/artist/Track-_~.1"],
    ["https://artist.bandcamp.com/track/%54r%61ck%2d%5f%7e%2e%31", "bandcamp:https://artist.bandcamp.com/track/Track-_~.1"],
    ["https://soundcloud.com/artist/%d0%a2%d1%80%d0%b5%d0%ba", "soundcloud:https://soundcloud.com/artist/%D0%A2%D1%80%D0%B5%D0%BA"],
    ["https://artist.bandcamp.com/track/%d0%a2%d1%80%d0%b5%d0%ba", "bandcamp:https://artist.bandcamp.com/track/%D0%A2%D1%80%D0%B5%D0%BA"],
    ["https://youtu.be/%42aW_jenozKc", "youtube:BaW_jenozKc"],
    ["https://youtube.com/%73horts/%42aW_jenozKc", "youtube:BaW_jenozKc"],
    ["https://youtube.com/w%61tch?v=BaW_jenozKc", "youtube:BaW_jenozKc"],
  ])("binds equivalent pathname escape spelling to the same source: %s", (url, key) => {
    expect(canonicalSourceKey(url)).toBe(key);
  });

  it.each([
    ["https://soundcloud.com/artist/tr%2fack%3fpart%23tag", "soundcloud:https://soundcloud.com/artist/tr%2Fack%3Fpart%23tag"],
    ["https://artist.bandcamp.com/track/tr%2fack%3fpart%23tag", "bandcamp:https://artist.bandcamp.com/track/tr%2Fack%3Fpart%23tag"],
  ])("keeps escaped routing delimiters inside the track slug: %s", (url, key) => {
    expect(canonicalSourceKey(url)).toBe(key);
  });

  it("retains meaningful query values in deterministic provider URL identities", () => {
    const url = "https://soundcloud.com/resolve?secret_token=s-one&b=2&a=1";
    expect(canonicalSourceKey(url)).toBe(canonicalSourceKey("https://soundcloud.com/resolve?a=1&b=2&secret_token=s-one"));
    expect(canonicalSourceKey(url)).not.toBe(canonicalSourceKey(url.replace("s-one", "s-two")));
    expect(canonicalSourceKey("https://youtube.com/playlist?list=one")).not.toBe(canonicalSourceKey("https://youtube.com/playlist?list=two"));
  });

  it("shares SoundCloud numeric track identity across API aliases without inventing a slug mapping", () => {
    const key = canonicalSourceKey("https://api.soundcloud.com/tracks/123?client_id=one");
    expect(key).toBe(canonicalSourceKey("https://api-v2.soundcloud.com/tracks/123?client_id=two&extra=tracking"));
    expect(key).not.toBe(canonicalSourceKey("https://api.soundcloud.com/tracks/456"));
    expect(key).not.toBe(canonicalSourceKey("https://soundcloud.com/Artist/123"));
  });

  it("rejects conflicting numeric identifiers on a SoundCloud API track URL", () => {
    expect(canonicalSourceKey("https://api.soundcloud.com/tracks/123?track_id=456")).toBeUndefined();
  });

  it("rejects a canonical identity that exceeds the private response bound after URL encoding", () => {
    expect(canonicalSourceKey(`https://soundcloud.com/Artist/${"\u4e00".repeat(3_000)}`)).toBeUndefined();
  });

  it.each([
    `http://youtube.com/watch?v=${video}`,
    `https://user:pass@youtube.com/watch?v=${video}`,
    `https://youtube.com:444/watch?v=${video}`,
    `https://youtube.com/watch?v=${video}#fragment`,
    `https://youtube.com.evil.test/watch?v=${video}`,
    "https://127.0.0.1/track",
    `https://youtube.com/watch?v=${video}&v=dQw4w9WgXcQ`,
    `https://youtube.com/shorts/${video}?v=dQw4w9WgXcQ`,
    `https://youtu.be/${video}?v=dQw4w9WgXcQ`,
    "https://youtube.com/watch?v=invalid",
    "https://youtube.com/embed/invalid",
  ])("rejects forbidden or ambiguous source identity: %s", (url) => {
    expect(canonicalSourceKey(url)).toBeUndefined();
  });

  it("requires account correlation and forbids lookup-supplied recording metadata", () => {
    expect(tfSourceReferenceCommandSchema.parse(command)).toEqual(command);
    const { accountId: _, ...withoutAccount } = command;
    expect(tfSourceReferenceCommandSchema.safeParse(withoutAccount).success).toBe(false);
    expect(tfSourceReferenceCommandSchema.safeParse({ ...command, expectedDurationSeconds: 210 }).success).toBe(false);
  });

  it("accepts a known reference with an explicit bounded lifetime", () => {
    expect(tfSourceReferenceResponseSchema.parse(known)).toEqual(known);
  });

  it.each([
    { ...known, reference: undefined },
    { ...known, status: "unknown" },
    { ...known, status: "ambiguous" },
    { ...known, reference: { ...reference, expiresAt: 1_000 } },
    { ...known, reference: { ...reference, expiresAt: 301_001 } },
    { ...known, reference: { ...reference, observedAt: -1 } },
    { ...known, reference: { ...reference, expectedDurationSeconds: 0 } },
    { ...known, reference: { ...reference, expectedDurationSeconds: 210.5 } },
    { ...known, reference: { ...reference, issuer: "browser" } },
  ])("rejects invalid private reference state/lifetime: %j", (response) => {
    expect(tfSourceReferenceResponseSchema.safeParse(response).success).toBe(false);
  });
});
