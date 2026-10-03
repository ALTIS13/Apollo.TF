import { useEffect, useLayoutEffect, useRef } from "react";
import type { TrackResult } from "@workspace/api-client-react";
import {
  canUseTfProtectedActivity, captureTfSecurityGeneration, isCurrentTfSecurityGeneration,
  subscribeTfActivitySuspension, tfRequestInit, type TfBrowserSession,
} from "@/lib/tf-session-client";

interface MediaSessionPlayer {
  track: TrackResult | null;
  session: TfBrowserSession | null;
  active: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  duration: number;
  progress: number;
  hasNext: boolean;
  hasPrevious: boolean;
  play: () => void;
  pause: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekTo: (percentage: number) => void;
  seekBy: (seconds: number) => void;
}

const actions: readonly MediaSessionAction[] = ["play", "pause", "nexttrack", "previoustrack", "seekto", "seekforward", "seekbackward"];

function optional(operation: () => void) {
  try { operation(); } catch { /* Browser support differs by operation. */ }
}

function clearMediaSession(media: MediaSession) {
  for (const action of actions) optional(() => media.setActionHandler(action, null));
  optional(() => { media.metadata = null; });
  optional(() => { media.playbackState = "none"; });
  optional(() => media.setPositionState());
}

function artwork(url: string | null | undefined): MediaImage[] {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? [{ src: parsed.href }] : [];
  } catch { return []; }
}

export function usePlayerMediaSession(player: MediaSessionPlayer) {
  const generation = captureTfSecurityGeneration();
  const current = useRef({ player, generation });
  useLayoutEffect(() => { current.current = { player, generation }; });
  const allowed = player.active && player.session !== null &&
    player.session.entitlements.includes("tf.search") && canUseTfProtectedActivity(player.session);
  const selected = player.track !== null;
  const seekable = Number.isFinite(player.duration) && player.duration > 0 && !player.isLoading;

  useEffect(() => {
    const media = navigator.mediaSession;
    if (media) return () => clearMediaSession(media);
    return undefined;
  }, []);

  useEffect(() => {
    const media = navigator.mediaSession;
    if (!media) return;
    let mounted = true;
    const live = (): MediaSessionPlayer | undefined => {
      const latest = current.current;
      if (!mounted || latest.generation !== generation || !isCurrentTfSecurityGeneration(generation)) return;
      const value = latest.player;
      if (!value.active || !value.track || !value.session ||
          !value.session.entitlements.includes("tf.search") || !canUseTfProtectedActivity(value.session)) {
        clearMediaSession(media);
        try { tfRequestInit(); } catch { /* Publish a local expiry without making a request. */ }
        return;
      }
      return value;
    };
    const register = (action: MediaSessionAction, enabled: boolean,
      operation: (value: MediaSessionPlayer, details: MediaSessionActionDetails) => void | Promise<void>) => {
      optional(() => media.setActionHandler(action, enabled ? (details) => {
        const value = live();
        if (value) {
          try { void Promise.resolve(operation(value, details)).catch(() => {}); } catch { /* Existing player recovery owns action errors. */ }
        }
      } : null));
    };
    if (allowed && selected) {
      register("play", true, (value) => { if (!value.isLoading) value.play(); });
      register("pause", true, (value) => value.pause());
      register("nexttrack", player.hasNext, (value) => value.next());
      register("previoustrack", player.hasPrevious, (value) => value.previous());
      register("seekto", seekable, (value, details) => {
        if (value.isLoading || !Number.isFinite(value.duration) || value.duration <= 0 ||
            typeof details.seekTime !== "number" || !Number.isFinite(details.seekTime)) return;
        value.seekTo(Math.max(0, Math.min(details.seekTime, value.duration)) / value.duration * 100);
      });
      for (const action of ["seekforward", "seekbackward"] as const) register(action, seekable, (value, details) => {
        const offset = details.seekOffset ?? 10;
        if (value.isLoading || !Number.isFinite(value.duration) || value.duration <= 0 || !Number.isFinite(offset) || offset < 0) return;
        value.seekBy(action === "seekbackward" ? -offset : offset);
      });
    } else clearMediaSession(media);
    const unsubscribe = subscribeTfActivitySuspension(() => clearMediaSession(media));
    return () => {
      mounted = false; unsubscribe();
      for (const action of actions) optional(() => media.setActionHandler(action, null));
    };
  }, [generation, allowed, selected, player.hasNext, player.hasPrevious, seekable]);

  useEffect(() => {
    const media = navigator.mediaSession;
    if (!media) return;
    if (!allowed || !player.track || !isCurrentTfSecurityGeneration(generation)) {
      clearMediaSession(media);
      return;
    }
    optional(() => {
      media.metadata = typeof MediaMetadata === "function" ? new MediaMetadata({
        title: player.track!.title, artist: player.track!.artist, artwork: artwork(player.track!.thumbnailUrl),
      }) : null;
    });
    optional(() => { media.playbackState = player.isPlaying ? "playing" : "paused"; });
  }, [generation, allowed, player.track?.title, player.track?.artist, player.track?.thumbnailUrl, player.isPlaying]);

  useEffect(() => {
    const media = navigator.mediaSession;
    if (!media) return;
    if (!allowed || !selected || !seekable || !isCurrentTfSecurityGeneration(generation)) {
      optional(() => media.setPositionState());
      return;
    }
    optional(() => media.setPositionState({ duration: player.duration, playbackRate: 1,
      position: Number.isFinite(player.progress) ? Math.max(0, Math.min(player.progress, player.duration)) : 0,
    }));
  }, [generation, allowed, selected, seekable, player.duration, player.progress, player.isPlaying]);
}
