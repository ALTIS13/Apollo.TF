import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackResult } from "@workspace/api-client-react";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { writeQueueSnapshot } from "@/lib/queue-persistence";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import { TfSessionBoundary } from "./TfSessionBoundary";

const track: TrackResult = {
  id: "yt_media_a", title: "First recording", artist: "Artist", duration: 200,
  source: "youtube", type: "original", thumbnailUrl: "https://images.example/first.jpg",
  quality: [], score: 0,
};
const second: TrackResult = { ...track, id: "yt_media_b", title: "Second recording", thumbnailUrl: null };
let player: ReturnType<typeof usePlayer>;
let auth: TfAuthContextValue;
let media: MediaSessionDouble;
let streamRequests: string[];
let streamReply: (() => Promise<Response>) | null;
let playCompletion: Promise<void> | null;

class AudioDouble extends EventTarget {
  static current: AudioDouble;
  currentTime = 0;
  duration = 200;
  src = "";
  volume = 0.8;
  paused = true;
  constructor() { super(); AudioDouble.current = this; }
  async play() { this.paused = false; this.dispatchEvent(new Event("play")); await playCompletion; }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")); } }
  load() { this.paused = true; }
}

class MetadataDouble {
  title: string;
  artist: string;
  artwork: readonly MediaImage[];
  constructor(value: MediaMetadataInit) {
    this.title = value.title ?? "";
    this.artist = value.artist ?? "";
    this.artwork = value.artwork ?? [];
  }
}

class MediaSessionDouble {
  metadata: MetadataDouble | null = null;
  playbackState: MediaSessionPlaybackState = "none";
  position: MediaPositionState | undefined;
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  unsupported = new Set<MediaSessionAction>();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    if (this.unsupported.has(action)) throw new DOMException("Unavailable", "NotSupportedError");
    if (handler) this.handlers.set(action, handler);
    else this.handlers.delete(action);
  }
  setPositionState(position?: MediaPositionState) { this.position = position; }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Apollo-TF-Session-Profile": "renewal-v1" },
});

function Probe() { player = usePlayer(); auth = useTfAuth(); return <span>{auth.status}</span>; }

async function flush() {
  await act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); });
}

async function setup() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={cache}>
      <TfAuthProvider><TfSessionBoundary><PlayerProvider><Probe /></PlayerProvider></TfSessionBoundary></TfAuthProvider>
    </QueryClientProvider>,
  );
  await flush();
  expect(auth.status).toBe("authenticated");
  return view;
}

async function action(action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) {
  const handler = media.handlers.get(action);
  expect(handler, `missing system ${action} command`).toBeTypeOf("function");
  await act(async () => { handler!({ action, ...details }); });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  clearTfSessionSecurityState();
  window.localStorage.clear();
  streamRequests = [];
  streamReply = null;
  playCompletion = null;
  media = new MediaSessionDouble();
  vi.stubGlobal("Audio", AudioDouble);
  vi.stubGlobal("MediaMetadata", MetadataDouble);
  vi.stubEnv("VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED", "false");
  Object.defineProperty(navigator, "mediaSession", { value: media, configurable: true });
  vi.stubGlobal("fetch", async (input: string) => {
    const path = new URL(input, "https://tf.apollot.ru").pathname;
    if (path.endsWith("/auth/me")) return json({
      accountId: "11111111-1111-4111-8111-111111111111",
      installationId: "22222222-2222-4222-8222-222222222222",
      entitlements: ["tf.search"], csrfToken: "a".repeat(42) + "A",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    if (path.endsWith("/stream")) {
      streamRequests.push(path);
      return streamReply ? streamReply() : json({ streamUrl: "https://media.example/test", expiresAt: null });
    }
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  Reflect.deleteProperty(navigator, "mediaSession");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("browser media session", () => {
  it("shows the active recording and explicit play/pause never toggle the opposite state", async () => {
    await setup();
    await act(async () => { await player.playTrack(track); });
    expect(media.metadata).toMatchObject({ title: "First recording", artist: "Artist", artwork: [{ src: "https://images.example/first.jpg" }] });
    expect(media.playbackState).toBe("playing");
    await action("play");
    expect(player.isPlaying).toBe(true);
    await action("pause");
    await action("pause");
    expect(player.isPlaying).toBe(false);
    expect(AudioDouble.current.paused).toBe(true);
    expect(media.playbackState).toBe("paused");
    await action("play");
    expect(player.isPlaying).toBe(true);
    expect(streamRequests).toHaveLength(1);
  });

  it("uses current queue/repeat semantics and drops unavailable next controls", async () => {
    await setup();
    await act(async () => { await player.playCollection([track, second]); });
    await action("nexttrack");
    expect(player.currentTrack?.id).toBe("yt_media_b");
    expect(media.metadata?.title).toBe("Second recording");
    expect(media.handlers.has("nexttrack")).toBe(false);
    await action("previoustrack");
    expect(player.currentTrack?.id).toBe("yt_media_a");
    await act(async () => { player.cycleRepeatMode(); });
    await action("nexttrack");
    await action("nexttrack");
    expect(player.currentTrack?.id).toBe("yt_media_a");
    expect(player.queue.map((value) => value.id)).toEqual(["yt_media_a", "yt_media_b"]);
  });

  it("publishes a valid position and clamps seek commands to the current recording", async () => {
    await setup();
    await act(async () => { await player.playTrack(track); });
    await action("seekto", { seekTime: 90 });
    expect(player.progress).toBe(90);
    expect(media.position).toMatchObject({ duration: 200, playbackRate: 1, position: 90 });
    await action("seekbackward");
    expect(player.progress).toBe(80);
    await action("seekforward", { seekOffset: 15 });
    expect(player.progress).toBe(95);
    await action("seekto", { seekTime: 900 });
    expect(AudioDouble.current.currentTime).toBe(200);
    await action("seekto", { seekTime: -9 });
    expect(player.progress).toBe(0);
    await action("seekto", { seekTime: Number.NaN });
    await action("seekforward", { seekOffset: Number.POSITIVE_INFINITY });
    await action("seekbackward", { seekOffset: -5 });
    expect(player.progress).toBe(0);
  });

  it("keeps the current recording visible while queue and previous-control availability change", async () => {
    await setup();
    await act(async () => { await player.playTrack(track); });
    await action("pause");
    act(() => { player.addToQueue(second); });
    expect(media.metadata?.title).toBe("First recording");
    expect(media.playbackState).toBe("paused");
    expect(media.handlers.has("nexttrack")).toBe(true);
    await action("seekto", { seekTime: 90 });
    expect(media.metadata?.title).toBe("First recording");
    expect(media.playbackState).toBe("paused");
    expect(media.handlers.has("previoustrack")).toBe(true);
  });

  it("clears system metadata synchronously and fences retained commands after access loss", async () => {
    await setup();
    await act(async () => { await player.playCollection([track, second]); });
    const oldNext = media.handlers.get("nexttrack")!;
    const oldPlay = media.handlers.get("play")!;
    expect(oldNext).toBeTypeOf("function");
    expect(oldPlay).toBeTypeOf("function");
    const before = streamRequests.length;
    act(() => { clearTfSessionSecurityState(); });
    expect(media.metadata).toBeNull();
    expect(media.playbackState).toBe("none");
    expect(media.position).toBeUndefined();
    expect(media.handlers.size).toBe(0);
    await act(async () => { oldNext({ action: "nexttrack" }); oldPlay({ action: "play" }); });
    await flush();
    expect(streamRequests).toHaveLength(before);
    expect(AudioDouble.current.paused).toBe(true);
  });

  it("pauses a pending stream load and ignores its late successful completion", async () => {
    await setup();
    let resolve!: (value: Response) => void;
    streamReply = () => new Promise<Response>((done) => { resolve = done; });
    let loading!: Promise<void>;
    act(() => { loading = player.playTrack(track); });
    await flush();
    expect(player.isLoading).toBe(true);
    await action("pause");
    resolve(json({ streamUrl: "https://media.example/late", expiresAt: null }));
    await act(async () => { await loading; });
    expect(player.isPlaying).toBe(false);
    expect(player.isLoading).toBe(false);
    expect(AudioDouble.current.src).toBe("");
    streamReply = null;
    await action("play");
    expect(player.isPlaying).toBe(true);
    expect(player.currentTrack?.id).toBe(track.id);
  });

  it("expires system commands in a sleeping tab before session timers can run", async () => {
    await setup();
    await act(async () => { await player.playCollection([track, second]); });
    const next = media.handlers.get("nexttrack")!;
    const before = streamRequests.length;
    vi.setSystemTime(Date.now() + 300_001);
    await act(async () => { next({ action: "nexttrack" }); });
    expect(streamRequests).toHaveLength(before);
    expect(media.metadata).toBeNull();
    expect(media.handlers.size).toBe(0);
    expect(AudioDouble.current.paused).toBe(true);
  });

  it("publishes pause while Audio.play is pending even when loading resets the native paused flag", async () => {
    await setup();
    let complete!: () => void;
    playCompletion = new Promise<void>((done) => { complete = done; });
    let loading!: Promise<void>;
    act(() => { loading = player.playTrack(track); });
    await flush();
    expect(player.isLoading).toBe(true);
    expect(media.playbackState).toBe("playing");
    await action("pause");
    expect(AudioDouble.current.paused).toBe(true);
    expect(player.isPlaying).toBe(false);
    expect(media.playbackState).toBe("paused");
    complete();
    await act(async () => { await loading; });
    expect(player.isPlaying).toBe(false);
    expect(AudioDouble.current.src).toBe("");
  });

  it("does not treat an intentional pause during a pending resume as a broken stream", async () => {
    await setup();
    await act(async () => { await player.playTrack(track); });
    await action("pause");
    let reject!: (reason: unknown) => void;
    playCompletion = new Promise<void>((_done, fail) => { reject = fail; });
    await action("play");
    await action("pause");
    await act(async () => { reject(new DOMException("Interrupted by pause", "AbortError")); });
    await flush();
    playCompletion = null;
    await action("play");
    expect(player.isPlaying).toBe(true);
    expect(streamRequests).toHaveLength(1);
  });

  it("preserves the restored target when pause interrupts its stream resolution", async () => {
    writeQueueSnapshot(window.localStorage, {
      accountId: "11111111-1111-4111-8111-111111111111",
      installationId: "22222222-2222-4222-8222-222222222222",
    }, [track], 0, 90);
    await setup();
    let resolve!: (value: Response) => void;
    streamReply = () => new Promise<Response>((done) => { resolve = done; });
    await action("play");
    expect(player.isLoading).toBe(true);
    await action("pause");
    resolve(json({ streamUrl: "https://media.example/restored", expiresAt: null }));
    await flush();
    streamReply = null;
    await action("play");
    expect(player.isPlaying).toBe(true);
    expect(AudioDouble.current.currentTime).toBe(90);
  });

  it("keeps a new recording at zero while an old audio position event arrives during its load", async () => {
    await setup();
    await act(async () => { await player.playCollection([track, second]); });
    await action("seekto", { seekTime: 90 });
    let resolve!: (value: Response) => void;
    streamReply = () => new Promise<Response>((done) => { resolve = done; });
    await action("nexttrack");
    act(() => { AudioDouble.current.dispatchEvent(new Event("timeupdate")); });
    expect(player.progress).toBe(0);
    await action("pause");
    resolve(json({ streamUrl: "https://media.example/second", expiresAt: null }));
    await flush();
    streamReply = null;
    await action("play");
    expect(AudioDouble.current.currentTime).toBe(0);
    expect(player.currentTrack?.id).toBe(second.id);
  });

  it("removes recording data and retained actions when the queue empties or the player unmounts", async () => {
    const view = await setup();
    await act(async () => { await player.playTrack(track); });
    const oldPlay = media.handlers.get("play")!;
    expect(oldPlay).toBeTypeOf("function");
    act(() => { player.removeFromQueue(0); });
    expect(media.metadata).toBeNull();
    expect(media.handlers.size).toBe(0);
    expect(media.position).toBeUndefined();
    await act(async () => { await player.playTrack(second); });
    view.unmount();
    expect(media.metadata).toBeNull();
    expect(media.playbackState).toBe("none");
    const before = streamRequests.length;
    await act(async () => { oldPlay({ action: "play" }); });
    expect(streamRequests).toHaveLength(before);
  });

  it("keeps normal playback working when Media Session or one optional operation is unavailable", async () => {
    Reflect.deleteProperty(navigator, "mediaSession");
    const view = await setup();
    await act(async () => { await player.playTrack(track); });
    expect(player.isPlaying).toBe(true);
    view.unmount();
    media.unsupported.add("seekto");
    Object.defineProperty(navigator, "mediaSession", { value: media, configurable: true });
    await setup();
    await act(async () => { await player.playTrack(second); });
    expect(media.metadata?.title).toBe("Second recording");
    await action("pause");
    expect(player.isPlaying).toBe(false);
  });
});
