import type { ChildProcess, SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tfSearchResponseSchema } from "@workspace/tf-search-contract";
import { inspectSourceMetadata } from "./source-metadata.js";

const fixture = vi.hoisted(() => ({
  script: "",
  spawn: vi.fn(),
  children: [] as { child: ChildProcess; closed: Promise<void> }[],
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: fixture.spawn,
}));

const url = "https://www.youtube.com/watch?v=Ap0ll0Tf001";
const metadata = {
  _type: "video", title: "Track (2011 Remaster)", artist: "Artist", uploader: "Channel",
  duration: 29.6, webpage_url: url, is_live: false, was_live: false, live_status: "not_live",
};
const responseEnvelope = (track: unknown) => ({
  schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", query: "source inspection",
  results: [track], cached: false, sources: ["yt", "sc", "bc"], fallbackAvailable: false,
  providerStatus: { yt: "ok", sc: "ok", bc: "ok", dz: "skipped" },
});
const output = (value: unknown): string => `process.stdout.write(${JSON.stringify(JSON.stringify(value))});`;
const hanging = 'process.stdout.write("ready"); setInterval(() => {}, 1000);';

beforeEach(async () => {
  fixture.script = output(metadata);
  fixture.spawn.mockReset();
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  fixture.spawn.mockImplementation((_command: string, _args: readonly string[], options: SpawnOptions) => {
    const child = actual.spawn(process.execPath, ["-e", fixture.script], options);
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    fixture.children.push({ child, closed });
    return child;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const { child, closed } of fixture.children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
});

describe("direct source metadata inspector", () => {
  it.each([
    ["https://youtu.be/Ap0ll0Tf001?si=share", url, "youtube", "yt", "^youtube$"],
    ["https://music.youtube.com/%65mbed/%41p0ll0Tf001", url, "youtube", "yt", "^youtube$"],
    ["https://m.soundcloud.com/Artist/tr%61ck?in=playlist&secret_token=fixture", "https://soundcloud.com/Artist/track", "soundcloud", "sc", "^soundcloud$"],
    ["https://artist.bandcamp.com/track/tr%61ck?campaign=fixture", "https://artist.bandcamp.com/track/track", "bandcamp", "bc", "^bandcamp$"],
  ])("inspects only the selected supported source, including canonical alias %s", async (selected, webpage, source, prefix, extractor) => {
    fixture.script = output({ ...metadata, webpage_url: webpage });
    const track = await inspectSourceMetadata(selected);
    expect(track).toMatchObject({
      id: `${prefix}_${Buffer.from(selected).toString("base64url")}`, sourceUrl: selected,
      source, title: metadata.title, artist: "Artist", duration: 30,
      thumbnailUrl: null, viewCount: null, quality: ["unknown"], score: 0,
    });
    expect(tfSearchResponseSchema.safeParse(responseEnvelope(track)).success).toBe(true);
    expect(fixture.spawn.mock.calls[0]?.[1]).toEqual([
      "--ignore-config", "--no-plugin-dirs", "--simulate", "--dump-single-json", "--no-playlist",
      "--no-cache-dir", "--no-warnings", "--retries", "0", "--extractor-retries", "0",
      "--socket-timeout", "5", "--use-extractors", extractor, "--", selected,
    ]);
  });

  it("uses an isolated child environment, no shell or stdin, and drains untrusted stderr", async () => {
    vi.stubEnv("TF_SEARCH_INTERNAL_AUTH_SECRET", "fixture-only-secret");
    fixture.script = `process.stderr.write("untrusted-stderr".repeat(100000), () => {
      process.stdout.write(JSON.stringify({ ...${JSON.stringify(metadata)},
        artist: process.env.TF_SEARCH_INTERNAL_AUTH_SECRET || process.env.PYTHONIOENCODING }));
    });`;
    const track = await inspectSourceMetadata(url);
    expect(track?.artist).toBe("utf-8");
    expect(fixture.spawn.mock.calls[0]?.[0]).toBe("yt-dlp");
    const options = fixture.spawn.mock.calls[0]?.[2] as SpawnOptions;
    expect(options.shell).toBe(false);
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(Object.keys(options.env ?? {}).every((key) => [
      "PATH", "HOME", "XDG_CACHE_HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "PYTHONIOENCODING",
    ].includes(key))).toBe(true);
  });

  it("prefers structured artist without replacing the full clean/live/remix/remaster title", async () => {
    fixture.script = output({ ...metadata, title: "Track (Live Remix, Clean, 2011 Remaster)", track: "Track", uploader: "Wrong Channel" });
    expect(await inspectSourceMetadata(url)).toMatchObject({
      title: "Track (Live Remix, Clean, 2011 Remaster)", artist: "Artist", type: "remix", duration: 30,
    });
  });

  it("retains an unknown uploader identity instead of inferring a performer from the title", async () => {
    const { artist: _, ...entry } = metadata;
    fixture.script = output({ ...entry, title: "Artist - Track (Clean)", uploader: "Unrelated Channel" });
    expect(await inspectSourceMetadata(url)).toMatchObject({ artist: "Unrelated Channel", title: "Artist - Track (Clean)" });
  });

  it.each([
    ["absent", "Track (Demo)"], ["null", "Track (Preview)"],
  ])("rejects explicit title markers before discarding %s identity", async (identity, title) => {
    const { artist: _, uploader: __, ...entry } = metadata;
    fixture.script = output({ ...entry, title, ...(identity === "null" ? { artist: null, uploader: null } : {}) });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
  });

  it.each(["title", "artist/uploader"])("returns no observation when %s identity is absent", async (missing) => {
    const entry: Record<string, unknown> = { ...metadata };
    for (const field of missing.split("/")) delete entry[field];
    fixture.script = output(entry);
    expect(await inspectSourceMetadata(url)).toBeUndefined();
    expect(fixture.spawn).toHaveBeenCalledOnce();
  });

  it("represents a missing duration as unknown zero without inventing a full length", async () => {
    const { duration: _, ...entry } = metadata;
    fixture.script = output(entry);
    expect(await inspectSourceMetadata(url)).toMatchObject({ duration: 0, quality: ["unknown"] });
  });

  it("treats optional JSON-null metadata as absent without weakening strict source fields", async () => {
    const nullable = { duration: null, is_live: null, was_live: null, live_status: null };
    fixture.script = output({ ...metadata, ...nullable, artist: null });
    expect(await inspectSourceMetadata(url)).toMatchObject({
      title: metadata.title, artist: "Channel", duration: 0, quality: ["unknown"],
    });
    fixture.script = output({ ...metadata, ...nullable, title: null, artist: null, uploader: null });
    expect(await inspectSourceMetadata(url)).toBeUndefined();
    for (const field of ["webpage_url", "_type"]) {
      fixture.script = output({ ...metadata, [field]: null });
      await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
    }
  });

  it.each([
    { title: "x".repeat(501) }, { artist: { name: "Artist" } }, { uploader: "x".repeat(301) },
    { duration: "30" }, { duration: -1 }, { duration: 86_401 },
  ])("rejects malformed present metadata: %j", async (change) => {
    fixture.script = output({ ...metadata, ...change });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
  });

  it.each([
    "[]", `${JSON.stringify(metadata)}\n${JSON.stringify(metadata)}`,
    JSON.stringify(metadata).replace('"duration":29.6', '"duration":1e309'),
  ])("requires one finite JSON metadata object: %s", async (raw) => {
    fixture.script = `process.stdout.write(${JSON.stringify(raw)});`;
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
  });

  it("rejects invalid canonical HTTPS input before spawning without exposing it", async () => {
    await expect(inspectSourceMetadata("https://user:fixture-secret@youtube.com/watch?v=Ap0ll0Tf001"))
      .rejects.toMatchObject({ message: "source_metadata_invalid_source" });
    expect(fixture.spawn).not.toHaveBeenCalled();
  });

  it.each([
    "https://youtube.com/playlist?list=one", "https://soundcloud.com/artist/sets/playlist",
    "https://api-v2.soundcloud.com/tracks/123?client_id=fixture", "https://artist.bandcamp.com/album/one",
    "https://www.deezer.com/track/123",
  ])("does not spawn for unsupported allowed source/path %s", async (selected) => {
    expect(await inspectSourceMetadata(selected)).toBeUndefined();
    expect(fixture.spawn).not.toHaveBeenCalled();
  });

  it.each([undefined, "https://youtube.com/watch?v=BaW_jenozKc"])("rejects missing or mismatched webpage identity %s", async (webpage_url) => {
    fixture.script = output({ ...metadata, webpage_url });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
  });

  it.each([
    { _type: "playlist", entries: [] }, { _type: "url_transparent", url: "https://example.test/redirect" },
    { is_live: true }, { was_live: true }, { live_status: "is_upcoming" },
  ])("does not admit playlist, redirect or live extraction: %j", async (change) => {
    fixture.script = output({ ...metadata, ...change });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_invalid_metadata" });
  });

  it("requires successful exit even when valid JSON precedes untrusted stderr", async () => {
    fixture.script = `${output(metadata)} process.stderr.write("fixture-sensitive-stderr"); process.exitCode = 1;`;
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_process" });
  });

  it("sanitizes synchronous spawn failure", async () => {
    fixture.spawn.mockImplementationOnce(() => { throw new Error("fixture-sensitive-spawn-detail"); });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_process" });
  });

  it("sanitizes asynchronous executable failure", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    fixture.spawn.mockImplementationOnce((_command: string, _args: readonly string[], options: SpawnOptions) => {
      const child = actual.spawn("tf-source-metadata-missing-fixture-executable", [], options);
      fixture.children.push({ child, closed: new Promise<void>((resolve) => child.once("close", () => resolve())) });
      return child;
    });
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_process" });
  });

  it("kills extraction when stdout exceeds one MiB", async () => {
    fixture.script = "process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 65)); setInterval(() => {}, 1000);";
    await expect(inspectSourceMetadata(url)).rejects.toMatchObject({ message: "source_metadata_output_limit" });
    expect(fixture.children[0]?.child.killed).toBe(true);
  });

  it("kills at the eight-second deadline and ignores late child events after settlement", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fixture.script = hanging;
    let settled = false;
    const outcome = inspectSourceMetadata(url).then(() => "resolved", (error: unknown) => error);
    void outcome.then(() => { settled = true; });
    expect(fixture.children).toHaveLength(1);
    const child = fixture.children[0]!.child;
    await once(child.stdout!, "data");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ message: "source_metadata_timeout" });
    expect(child.killed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await fixture.children[0]!.closed;
    child.emit("error", new Error("late-sensitive-detail"));
    child.emit("close", 0);
    child.stdout!.emit("data", Buffer.from(JSON.stringify(metadata)));
    expect(await outcome).toMatchObject({ message: "source_metadata_timeout" });
  });

  it("does not spawn an already-aborted inspection", async () => {
    const controller = new AbortController();
    controller.abort(new Error("fixture-sensitive-abort"));
    await expect(inspectSourceMetadata(url, { signal: controller.signal })).rejects.toMatchObject({ message: "source_metadata_aborted" });
    expect(fixture.spawn).not.toHaveBeenCalled();
  });

  it("kills an in-flight inspection on abort without exposing the abort reason", async () => {
    fixture.script = hanging;
    const controller = new AbortController();
    const outcome = inspectSourceMetadata(url, { signal: controller.signal }).then(() => "resolved", (error: unknown) => error);
    expect(fixture.children).toHaveLength(1);
    const child = fixture.children[0]!.child;
    await once(child.stdout!, "data");
    controller.abort(new Error("fixture-sensitive-abort"));
    expect(await outcome).toMatchObject({ message: "source_metadata_aborted" });
    expect(child.killed).toBe(true);
  });
});
