import { createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTrackStreamQueryOptions } from "@workspace/api-client-react";
import type { TrackResult, TrackSource, TrackType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  buildTfWebSocketUrl,
  createWebSocketTicket,
  reportTfAuthError,
  reportTfWebSocketRecovery,
  tfFetch,
  tfRequestInit,
  canUseTfProtectedActivity,
  captureTfSecurityGeneration,
  isCurrentTfSecurityGeneration,
  subscribeTfActivitySuspension,
  setTfPlaybackActive,
} from "@/lib/tf-session-client";
import { useTfAuth } from "@/auth/tf-auth";
import { TfWebSocketLifecycle } from "@/lib/tf-websocket";
import { successorWebSocketEnabled } from "@/lib/tf-successor-ws-config";
import { clearUpcoming, getNextQueueIndex, insertNext, moveUpcoming, reorderUpcoming, shuffleUpcomingIds } from "@/lib/queue-operations";
import type { RepeatMode } from "@/lib/queue-operations";
import { readQueueSnapshot, writeQueueSnapshot } from "@/lib/queue-persistence";

interface PlayerContextType {
  currentTrack: TrackResult | null;
  isPlaying: boolean;
  isLoading: boolean;
  progress: number;
  duration: number;
  volume: number;
  queue: TrackResult[];
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  playTrack: (track: TrackResult) => Promise<void>;
  playCollection: (tracks: readonly TrackResult[]) => Promise<void>;
  playFromQueue: (index: number) => Promise<void>;
  addToQueue: (track: TrackResult) => void;
  addNextToQueue: (track: TrackResult) => void;
  moveQueuedTrack: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  togglePlayPause: () => void;
  seekTo: (percentage: number) => void;
  seekBy: (seconds: number) => void;
  setVolume: (v: number) => void;
}

interface PlayerSyncState {
  type: "player_state";
  track: {
    id: string;
    title: string;
    artist: string;
    thumbnailUrl: string | null;
    duration: number;
    source?: string;
  } | null;
  position: number;
  isPlaying: boolean;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

function playbackErrorDescription(error: unknown): string {
  const data = typeof error === "object" && error !== null && "data" in error
    ? error.data
    : null;
  const code = typeof data === "object" && data !== null && "error" in data
    ? data.error
    : null;
  if (code === "preview_rejected")
    return "Источник содержит только фрагмент трека. Выберите другую запись.";
  if (code === "duration_unverified")
    return "Не удалось проверить длительность записи. Попробуйте другой источник.";
  return "Не удалось загрузить трек.";
}

function isUnavailableTrackSource(error: unknown): boolean {
  if (error instanceof Error && error.message === "No stream URL") return true;
  if (typeof error !== "object" || error === null || !("status" in error) || !("data" in error)) return false;
  const data = error.data;
  const code = typeof data === "object" && data !== null && "error" in data ? data.error : null;
  return (error.status === 422 && code === "preview_rejected") ||
    (error.status === 503 && code === "duration_unverified") ||
    ((error.status === 500 || error.status === 502) && code === "stream_error");
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { session, status, webSocketRecoveryBudget } = useTfAuth();
  const [currentTrack, setCurrentTrack] = useState<TrackResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  const [queue, setQueue] = useState<TrackResult[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [queueHydrated, setQueueHydrated] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadGeneration = useRef(0);
  const appliedLoadGeneration = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const suspendedPosition = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentTrackRef = useRef<TrackResult | null>(null);
  const isPlayingRef = useRef(false);
  const progressRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const queueRef = useRef<TrackResult[]>([]);
  const queueIndexRef = useRef(0);
  const queueIdsRef = useRef<number[]>([]);
  const originalOrderRef = useRef<number[]>([]);
  const nextQueueIdRef = useRef(0);
  const repeatModeRef = useRef<RepeatMode>("off");
  const shuffleEnabledRef = useRef(false);
  const hydratedIdentityRef = useRef<string | null>(null);
  const restoredAwaitingPlaybackRef = useRef(false);

  const playTrackRef = useRef<(track: TrackResult, originLive?: () => boolean) => Promise<void>>(async () => {});
  const playNextRef = useRef<(reason: "ended" | "next") => Promise<void>>(async () => {});

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);

  // ── Audio element setup ───────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    audioRef.current = new Audio();
    audioRef.current.volume = 0.8; // matches initial volume state

    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      if (!canUseTfProtectedActivity()) {
        // A sleeping tab may receive a media event before its delayed deadline timer.
        try { tfRequestInit(); } catch { /* publishes the local deadline, without a request */ }
        audio.pause(); return;
      }
      setProgress(audio.currentTime);
    };
    const handleDurationChange = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      void playNextRef.current("ended");
    };
    const handlePlay = () => {
      if (!canUseTfProtectedActivity()) { audio.pause(); return; }
      setTfPlaybackActive(true); setIsPlaying(true);
    };
    const handlePause = () => { setTfPlaybackActive(false); setIsPlaying(false); };
    const unsubscribe = subscribeTfActivitySuspension(() => {
      loadGeneration.current += 1;
      if (suspendedPosition.current === null) suspendedPosition.current = audio.currentTime;
      setProgress(suspendedPosition.current);
      audio.pause(); audio.src = ""; audio.load(); setIsLoading(false);
    });

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      mountedRef.current = false; loadGeneration.current += 1; unsubscribe(); setTfPlaybackActive(false);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    const identity = `${session.accountId}:${session.installationId}`;
    if (hydratedIdentityRef.current === identity) return;
    hydratedIdentityRef.current = identity;
    let restored = null;
    try { restored = readQueueSnapshot(window.localStorage, session); } catch { /* storage may be disabled */ }
    if (restored) {
      const ids = restored.queue.map(() => ++nextQueueIdRef.current);
      queueRef.current = restored.queue;
      queueIdsRef.current = ids;
      originalOrderRef.current = ids;
      queueIndexRef.current = restored.index;
      setQueue(restored.queue);
      setQueueIndex(restored.index);
      if (restored.index >= 0) {
        const track = restored.queue[restored.index];
        currentTrackRef.current = track;
        restoredAwaitingPlaybackRef.current = true;
        suspendedPosition.current = restored.positionSeconds;
        progressRef.current = restored.positionSeconds;
        setCurrentTrack(track);
        setProgress(restored.positionSeconds);
        setDuration(track.duration);
      }
    }
    setQueueHydrated(true);
  }, [session?.accountId, session?.installationId, status]);

  useEffect(() => {
    if (!queueHydrated || status !== "authenticated" || !session || !canUseTfProtectedActivity()) return;
    try {
      writeQueueSnapshot(
        window.localStorage,
        session,
        queue,
        currentTrack ? queueIndex : -1,
        Number.isFinite(progress) ? progress : 0,
      );
    } catch { /* storage may be disabled */ }
  }, [queueHydrated, session?.accountId, session?.installationId, status, queue, queueIndex, currentTrack?.id, Math.floor(progress / 5)]);

  // ── Internal load helper (no toggle check, no queue reset) ────────────────

  const _loadTrack = useCallback(async (track: TrackResult, originLive?: () => boolean) => {
    if (!audioRef.current || !canUseTfProtectedActivity() || originLive?.() === false) return;
    const load = ++loadGeneration.current, security = captureTfSecurityGeneration();
    appliedLoadGeneration.current = null;
    const live = () => mountedRef.current && load === loadGeneration.current && isCurrentTfSecurityGeneration(security) && canUseTfProtectedActivity() && originLive?.() !== false;
    const resumePosition = currentTrackRef.current?.id === track.id ? suspendedPosition.current : null;
    suspendedPosition.current = null;
    try {
      setIsLoading(true);
      setCurrentTrack(track);
      setIsPlaying(false);
      setProgress(0);
      setDuration(track.duration || 0);
      audioRef.current.pause();
      audioRef.current.src = "";
      const params = {
        ...(track.source === "deezer" ? { artist: track.artist, title: track.title } : {}),
        ...(Number.isInteger(track.duration) && track.duration >= 1 && track.duration <= 86_400
          ? { expectedDurationSeconds: track.duration }
          : {}),
      };
      const res = await queryClient.fetchQuery(getGetTrackStreamQueryOptions(track.id, params, {
        request: tfRequestInit({ method: "GET" }),
      }));
      if (!live()) return;
      if (!res.streamUrl) throw new Error("No stream URL");
      audioRef.current.src = res.streamUrl;
      if (resumePosition !== null) { audioRef.current.currentTime = resumePosition; setProgress(resumePosition); }
      await audioRef.current.play();
      if (!live()) return;
      appliedLoadGeneration.current = load;
      restoredAwaitingPlaybackRef.current = false;
      setIsPlaying(true);
      void tfFetch<void>("/tracks/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id, artist: track.artist, title: track.title }),
      }).catch(() => {});
    } catch (err) {
      if (!live()) return;
      reportTfAuthError(err);
      setCurrentTrack(null);
      setIsPlaying(false);
      toast({ title: "Ошибка воспроизведения", description: playbackErrorDescription(err), variant: "destructive" });
      if (live() && isUnavailableTrackSource(err)) return "recoverable" as const;
    } finally {
      if (mountedRef.current && load === loadGeneration.current) setIsLoading(false);
    }
    return undefined;
  }, [queryClient, toast]);

  const _loadTrackRef = useRef(_loadTrack);
  _loadTrackRef.current = _loadTrack;

  // ── Public API ────────────────────────────────────────────────────────────

  const playTrack = useCallback(async (track: TrackResult, originLive?: () => boolean) => {
    if (!audioRef.current || !canUseTfProtectedActivity() || originLive?.() === false) return;
    if (currentTrack?.id === track.id) {
      togglePlayPause();
      return;
    }
    // Replace queue with this track
    setQueue([track]);
    setQueueIndex(0);
    queueRef.current = [track];
    queueIndexRef.current = 0;
    const id = ++nextQueueIdRef.current;
    queueIdsRef.current = [id];
    originalOrderRef.current = [id];
    await _loadTrackRef.current(track, originLive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  playTrackRef.current = playTrack;

  const playCollection = useCallback(async (tracks: readonly TrackResult[]) => {
    if (!audioRef.current || !canUseTfProtectedActivity() || tracks.length === 0) return;
    const ids = tracks.map(() => ++nextQueueIdRef.current);
    originalOrderRef.current = ids;
    const shuffledIds = shuffleEnabledRef.current ? shuffleUpcomingIds(ids, 0) : ids;
    const nextQueue = reorderUpcoming(tracks, ids, 0, shuffledIds);
    queueRef.current = nextQueue.queue;
    queueIdsRef.current = nextQueue.ids;
    queueIndexRef.current = 0;
    setQueue(nextQueue.queue);
    setQueueIndex(0);
    await _loadTrackRef.current(nextQueue.queue[0]);
  }, []);

  const playFromQueue = useCallback(async (index: number) => {
    if (!canUseTfProtectedActivity()) return;
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    queueIndexRef.current = index;
    setQueueIndex(index);
    await _loadTrackRef.current(q[index]);
  }, []);

  const advance = useCallback(async (reason: "ended" | "next") => {
    if (!canUseTfProtectedActivity()) return;
    const q = queueRef.current;
    let nextIdx = getNextQueueIndex(q.length, queueIndexRef.current, repeatModeRef.current, reason);
    for (let attempted = 0; nextIdx !== null && attempted < q.length; attempted++) {
      if (!canUseTfProtectedActivity() || queueRef.current !== q) return;
      queueIndexRef.current = nextIdx;
      setQueueIndex(nextIdx);
      const priorLoad = loadGeneration.current;
      const result = await _loadTrackRef.current(q[nextIdx]);
      if (reason !== "ended" || result !== "recoverable" || loadGeneration.current !== priorLoad + 1 ||
          queueRef.current !== q || !canUseTfProtectedActivity()) return;
      nextIdx = getNextQueueIndex(q.length, nextIdx, repeatModeRef.current, "next");
    }
  }, []);

  playNextRef.current = advance;
  const playNext = useCallback(() => advance("next"), [advance]);

  const cycleRepeatMode = useCallback(() => {
    const next = repeatModeRef.current === "off" ? "all" : repeatModeRef.current === "all" ? "one" : "off";
    repeatModeRef.current = next;
    setRepeatMode(next);
  }, []);

  const toggleShuffle = useCallback(() => {
    const enabled = !shuffleEnabledRef.current;
    shuffleEnabledRef.current = enabled;
    setShuffleEnabled(enabled);
    const ids = queueIdsRef.current;
    const index = currentTrackRef.current ? queueIndexRef.current : -1;
    const first = Math.max(0, index + 1);
    const upcoming = new Set(ids.slice(first));
    const orderedIds = enabled
      ? shuffleUpcomingIds(ids, index)
      : [...ids.slice(0, first), ...originalOrderRef.current.filter((id) => upcoming.has(id))];
    const updated = reorderUpcoming(queueRef.current, ids, index, orderedIds);
    queueRef.current = updated.queue;
    queueIdsRef.current = updated.ids;
    setQueue(updated.queue);
  }, []);

  const playPrev = useCallback(async () => {
    if (!canUseTfProtectedActivity()) return;
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    // Restart if >3s into track
    if (progressRef.current > 3 && audioRef.current) {
      audioRef.current.currentTime = 0;
      setProgress(0);
      return;
    }
    const prevIdx = idx - 1;
    if (prevIdx < 0) return;
    queueIndexRef.current = prevIdx;
    setQueueIndex(prevIdx);
    await _loadTrackRef.current(q[prevIdx]);
  }, []);

  const addToQueue = useCallback((track: TrackResult) => {
    const id = ++nextQueueIdRef.current;
    originalOrderRef.current = [...originalOrderRef.current, id];
    queueIdsRef.current = [...queueIdsRef.current, id];
    queueRef.current = [...queueRef.current, track];
    setQueue(queueRef.current);
  }, []);

  const addNextToQueue = useCallback((track: TrackResult) => {
    const index = currentTrackRef.current ? queueIndexRef.current : -1;
    const id = ++nextQueueIdRef.current;
    const currentId = queueIdsRef.current[index];
    const originalIndex = currentId === undefined ? -1 : originalOrderRef.current.indexOf(currentId);
    originalOrderRef.current = insertNext(originalOrderRef.current, originalIndex, id);
    queueIdsRef.current = insertNext(queueIdsRef.current, index, id);
    const updated = insertNext(queueRef.current, index, track);
    queueRef.current = updated;
    setQueue(updated);
  }, []);

  const moveQueuedTrack = useCallback((from: number, to: number) => {
    const index = currentTrackRef.current ? queueIndexRef.current : -1;
    const updated = moveUpcoming(queueRef.current, index, from, to);
    if (updated === queueRef.current) return;
    queueIdsRef.current = [...moveUpcoming(queueIdsRef.current, index, from, to)];
    if (!shuffleEnabledRef.current) originalOrderRef.current = [...queueIdsRef.current];
    queueRef.current = [...updated];
    setQueue(queueRef.current);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    // Compute new queue and side-effects before state update to avoid async calls inside updater
    const prev = queueRef.current;
    const updated = prev.filter((_, i) => i !== index);
    const removedId = queueIdsRef.current[index];
    queueIdsRef.current = queueIdsRef.current.filter((_, i) => i !== index);
    originalOrderRef.current = originalOrderRef.current.filter((id) => id !== removedId);
    const curIdx = queueIndexRef.current;

    queueRef.current = updated;
    setQueue(updated);

    if (updated.length === 0) {
      // Queue fully emptied — stop playback
      queueIndexRef.current = 0;
      setQueueIndex(0);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      setCurrentTrack(null);
      setIsPlaying(false);
      setProgress(0);
    } else if (index === curIdx) {
      // Removed the currently playing track — start the next available track
      const nextIdx = Math.min(curIdx, updated.length - 1);
      queueIndexRef.current = nextIdx;
      setQueueIndex(nextIdx);
      // Async load happens outside state updater for clearer state flow
      _loadTrackRef.current(updated[nextIdx]);
    } else if (index < curIdx) {
      // Removed a track before the current one — shift index down
      const newIdx = curIdx - 1;
      queueIndexRef.current = newIdx;
      setQueueIndex(newIdx);
    }
    // index > curIdx: no adjustment needed
  }, []);

  const clearQueue = useCallback(() => {
    const updated = clearUpcoming(queueRef.current, queueIndexRef.current, currentTrackRef.current !== null);
    const removed = new Set(queueIdsRef.current.slice(updated.length));
    queueIdsRef.current = queueIdsRef.current.slice(0, updated.length);
    originalOrderRef.current = originalOrderRef.current.filter((id) => !removed.has(id));
    queueRef.current = [...updated];
    setQueue(queueRef.current);
    if (currentTrackRef.current !== null) return;
    queueIndexRef.current = 0;
    setQueueIndex(0);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    setCurrentTrack(null);
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current || !currentTrackRef.current || !canUseTfProtectedActivity()) return;
    if (suspendedPosition.current !== null) { void _loadTrackRef.current(currentTrackRef.current); return; }
    if (isPlayingRef.current) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {
        toast({ title: "Ошибка", description: "Стрим истёк. Запустите трек снова.", variant: "destructive" });
        setIsPlaying(false);
      });
    }
  }, [toast]);

  const seekTo = useCallback((percentage: number) => {
    if (!audioRef.current || !duration) return;
    const time = (percentage / 100) * duration;
    audioRef.current.currentTime = time;
    setProgress(time);
  }, [duration]);

  const seekBy = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, audioRef.current.duration || 0));
    audioRef.current.currentTime = newTime;
    setProgress(newTime);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  // ── WebSocket sync ────────────────────────────────────────────────────────

  const wsRef = useRef<WebSocket | null>(null);
  const wsEpoch = useRef(0);
  const wsSecurityGeneration = captureTfSecurityGeneration();
  const suppressSendUntilRef = useRef<number>(0);

  const handleWsMessage = useCallback((event: MessageEvent, isCurrent: () => boolean) => {
    if (!canUseTfProtectedActivity() || !isCurrent()) return;
    const epoch = wsEpoch.current, security = captureTfSecurityGeneration();
    const originLive = () => isCurrent() && epoch === wsEpoch.current && isCurrentTfSecurityGeneration(security) && canUseTfProtectedActivity();
    try {
      const msg = JSON.parse(event.data) as PlayerSyncState;
      if (msg.type !== "player_state") return;
      if (!msg.track) return;

      const local = currentTrackRef.current;

      if (local?.id === msg.track.id && suspendedPosition.current !== null) {
        if (!msg.isPlaying) {
          suspendedPosition.current = msg.position;
          setProgress(msg.position);
          return;
        }
        suppressSendUntilRef.current = Date.now() + 10_000;
        const work = _loadTrackRef.current(local, originLive);
        const load = loadGeneration.current;
        work.then(() => {
          if (!originLive() || load !== loadGeneration.current || appliedLoadGeneration.current !== load) return;
          if (audioRef.current) {
            audioRef.current.currentTime = msg.position;
            setProgress(msg.position);
          }
        }).catch(() => {});
        return;
      }

      if (local?.id !== msg.track.id) {
        suppressSendUntilRef.current = Date.now() + 10_000;
        const validSources = ["youtube", "soundcloud"];
        const remoteTrack: TrackResult = {
          id: msg.track.id,
          title: msg.track.title,
          artist: msg.track.artist,
          thumbnailUrl: msg.track.thumbnailUrl ?? null,
          duration: msg.track.duration,
          source: (validSources.includes(msg.track.source ?? "") ? msg.track.source : "youtube") as TrackSource,
          type: "original" as TrackType,
          quality: [],
          score: 0,
        };
        const targetPosition = msg.position;
        const targetIsPlaying = msg.isPlaying;
        const work = playTrackRef.current(remoteTrack, originLive);
        const load = loadGeneration.current;
        work.then(() => {
            if (!originLive() || load !== loadGeneration.current || appliedLoadGeneration.current !== load) return;
            if (targetPosition > 1 && audioRef.current) {
              audioRef.current.currentTime = targetPosition;
              setProgress(targetPosition);
            }
            if (!targetIsPlaying && audioRef.current) audioRef.current.pause();
          })
          .catch(() => {});
        return;
      }

      applyingRemoteRef.current = true;
      try {
        if (msg.isPlaying && !isPlayingRef.current) {
          audioRef.current?.play().catch(() => {});
        } else if (!msg.isPlaying && isPlayingRef.current) {
          audioRef.current?.pause();
        }
        const drift = Math.abs(progressRef.current - msg.position);
        if (drift > 5 && audioRef.current) {
          audioRef.current.currentTime = msg.position;
          setProgress(msg.position);
        }
      } finally {
        applyingRemoteRef.current = false;
      }
    } catch {}
  }, []);

  useEffect(() => {
    const successor = session?.renewalProfile === "renewal-v1";
    if ((successor && !successorWebSocketEnabled()) || status !== "authenticated") return;
    wsEpoch.current += 1;
    const lifecycle = new TfWebSocketLifecycle({
      successor,
      recoveryBudget: successor ? webSocketRecoveryBudget : undefined,
      onRetryableError: reportTfWebSocketRecovery,
      createTicket: createWebSocketTicket,
      buildUrl: buildTfWebSocketUrl,
      createSocket: (url) => {
        const socket = new WebSocket(url);
        wsRef.current = socket;
        return socket;
      },
      onMessage: handleWsMessage,
      onTerminalError: (error) => {
        wsRef.current = null;
        reportTfAuthError(error);
        toast({
          title: "Синхронизация недоступна",
          description: "Обновите авторизацию Apollo TF и повторите попытку.",
          variant: "destructive",
        });
      },
    });
    lifecycle.start();
    const unsubscribe = subscribeTfActivitySuspension(() => { wsEpoch.current += 1; lifecycle.stop(); wsRef.current = null; });

    return () => {
      unsubscribe();
      wsEpoch.current += 1;
      lifecycle.stop();
      wsRef.current = null;
    };
  }, [handleWsMessage, toast, session?.renewalProfile, status, wsSecurityGeneration, webSocketRecoveryBudget]);

  const sendWsState = useCallback(() => {
    if (!canUseTfProtectedActivity()) return;
    if (restoredAwaitingPlaybackRef.current) return;
    if (applyingRemoteRef.current) return;
    if (Date.now() < suppressSendUntilRef.current) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const track = currentTrackRef.current;
    const msg: PlayerSyncState = {
      type: "player_state",
      track: track ? { id: track.id, title: track.title, artist: track.artist, thumbnailUrl: track.thumbnailUrl ?? null, duration: track.duration ?? 0, source: track.source } : null,
      position: progressRef.current,
      isPlaying: isPlayingRef.current,
    };
    try { ws.send(JSON.stringify(msg)); } catch {}
  }, []);

  useEffect(() => { sendWsState(); }, [currentTrack?.id, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  const positionSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentTrack) return;
    if (positionSendTimerRef.current) clearTimeout(positionSendTimerRef.current);
    positionSendTimerRef.current = setTimeout(sendWsState, 1000);
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PlayerContext.Provider
      value={{
        currentTrack, isPlaying, isLoading, progress, duration, volume,
        queue, queueIndex, repeatMode, shuffleEnabled, cycleRepeatMode, toggleShuffle,
        playTrack, playCollection, playFromQueue, addToQueue, addNextToQueue, moveQueuedTrack, removeFromQueue, clearQueue,
        playNext, playPrev,
        togglePlayPause, seekTo, seekBy, setVolume,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === undefined) throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
}
