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
import { clearUpcoming, insertNext, moveUpcoming } from "@/lib/queue-operations";

interface PlayerContextType {
  currentTrack: TrackResult | null;
  isPlaying: boolean;
  isLoading: boolean;
  progress: number;
  duration: number;
  volume: number;
  queue: TrackResult[];
  queueIndex: number;
  playTrack: (track: TrackResult) => Promise<void>;
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

  const playTrackRef = useRef<(track: TrackResult, originLive?: () => boolean) => Promise<void>>(async () => {});
  const playNextRef = useRef<() => Promise<void>>(async () => {});

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
      playNextRef.current();
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
    if (!currentTrack) return;
    tfFetch<void>("/tracks/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId: currentTrack.id,
        artist: currentTrack.artist,
        title: currentTrack.title,
      }),
    }).catch(() => {});
  }, [currentTrack?.id]);

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
      setIsPlaying(true);
    } catch (err) {
      if (!live()) return;
      reportTfAuthError(err);
      setCurrentTrack(null);
      setIsPlaying(false);
      toast({ title: "Ошибка воспроизведения", description: playbackErrorDescription(err), variant: "destructive" });
    } finally {
      if (mountedRef.current && load === loadGeneration.current) setIsLoading(false);
    }
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
    await _loadTrackRef.current(track, originLive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  playTrackRef.current = playTrack;

  const playFromQueue = useCallback(async (index: number) => {
    if (!canUseTfProtectedActivity()) return;
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    queueIndexRef.current = index;
    setQueueIndex(index);
    await _loadTrackRef.current(q[index]);
  }, []);

  const playNext = useCallback(async () => {
    if (!canUseTfProtectedActivity()) return;
    const q = queueRef.current;
    const nextIdx = queueIndexRef.current + 1;
    if (nextIdx >= q.length) return;
    queueIndexRef.current = nextIdx;
    setQueueIndex(nextIdx);
    await _loadTrackRef.current(q[nextIdx]);
  }, []);

  playNextRef.current = playNext;

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
    setQueue((prev) => {
      const updated = [...prev, track];
      queueRef.current = updated;
      return updated;
    });
  }, []);

  const addNextToQueue = useCallback((track: TrackResult) => {
    const updated = insertNext(queueRef.current, currentTrackRef.current ? queueIndexRef.current : -1, track);
    queueRef.current = updated;
    setQueue(updated);
  }, []);

  const moveQueuedTrack = useCallback((from: number, to: number) => {
    const updated = moveUpcoming(queueRef.current, currentTrackRef.current ? queueIndexRef.current : -1, from, to);
    if (updated === queueRef.current) return;
    queueRef.current = [...updated];
    setQueue(queueRef.current);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    // Compute new queue and side-effects before state update to avoid async calls inside updater
    const prev = queueRef.current;
    const updated = prev.filter((_, i) => i !== index);
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
        queue, queueIndex,
        playTrack, playFromQueue, addToQueue, addNextToQueue, moveQueuedTrack, removeFromQueue, clearQueue,
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
