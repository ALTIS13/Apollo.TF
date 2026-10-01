import { useQuery } from "@tanstack/react-query";
import type { TrackResult } from "@workspace/api-client-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Flag, Loader2, LocateFixed, ScrollText, Send } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { expectedDurationSeconds, formatDuration } from "@/lib/utils";
import { tfFetch } from "@/lib/tf-session-client";
import { parseSyncedLyrics } from "@/lib/lyrics";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface LyricsResponse {
  plainLyrics: string | null;
  syncedLyrics: string | null;
  source?: "lrclib" | "lyrics.ovh" | null;
  match?: "metadata" | "unverified" | null;
}

interface LyricsPanelProps {
  track: TrackResult;
  progress: number;
  duration: number;
  seekTo: (percentage: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FeedbackReason = "wrong_track" | "out_of_sync" | "incomplete" | "missing";
interface FeedbackState {
  trackId: string;
  open: boolean;
  reason: FeedbackReason | null;
  status: "idle" | "sending" | "sent" | "error";
}

const feedbackReasons: readonly { value: FeedbackReason; label: string }[] = [
  { value: "wrong_track", label: "Не тот трек" },
  { value: "out_of_sync", label: "Строки не совпадают по времени" },
  { value: "incomplete", label: "Текст неполный" },
];

export function LyricsPanel({
  track,
  progress,
  duration,
  seekTo,
  open,
  onOpenChange,
}: LyricsPanelProps) {
  const { status, session, hasEntitlement } = useTfAuth();
  const accountId = status === "authenticated" ? session?.accountId : null;
  const allowed = accountId !== null && hasEntitlement("tf.search");
  const [followState, setFollowState] = useState({ trackId: track.id, enabled: true });
  const [feedbackState, setFeedbackState] = useState<FeedbackState | null>(null);
  const feedback = feedbackState?.trackId === track.id ? feedbackState : null;
  const following = followState.trackId === track.id ? followState.enabled : true;
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const lyrics = useQuery({
    queryKey: ["tf", "lyrics", accountId, track.id, track.artist, track.title, track.duration],
    enabled: open && allowed,
    queryFn: () => tfFetch<LyricsResponse>(
      `/tracks/lyrics?${new URLSearchParams({
        artist: track.artist,
        title: track.title,
        duration: String(track.duration || 0),
      })}`,
    ),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const syncedLines = useMemo(
    () => parseSyncedLyrics(lyrics.data?.syncedLyrics),
    [lyrics.data?.syncedLyrics],
  );
  let activeLine = -1;
  for (let index = 0; index < syncedLines.length; index += 1) {
    if (syncedLines[index].time <= progress) activeLine = index;
    else break;
  }
  const seekDuration = duration > 0 ? duration : track.duration;
  const plainText = lyrics.data?.plainLyrics?.trim() ||
    (syncedLines.length === 0 ? lyrics.data?.syncedLyrics?.trim() : null);
  const hasLyrics = syncedLines.length > 0 || Boolean(plainText);
  const feedbackAvailable = allowed && !lyrics.isPending && !lyrics.isError && lyrics.data !== undefined;
  const submitFeedback = async () => {
    const reason = hasLyrics ? feedback?.reason : "missing";
    if (!feedbackAvailable || !reason || feedback?.status === "sending") return;
    const trackId = track.id;
    setFeedbackState((current) => current?.trackId === trackId ? { ...current, status: "sending" } : current);
    try {
      await tfFetch("/tracks/lyrics/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          artist: track.artist,
          title: track.title,
          durationSeconds: expectedDurationSeconds(track.duration) ?? 0,
          lyricsSource: lyrics.data?.source ?? "none",
          reason,
        }),
      });
      setFeedbackState((current) => current?.trackId === trackId
        ? { ...current, open: false, status: "sent" }
        : current);
    } catch {
      setFeedbackState((current) => current?.trackId === trackId
        ? { ...current, status: "error" }
        : current);
    }
  };
  const scrollToActiveLine = useCallback(() => {
    const viewport = scrollViewportRef.current;
    const line = activeLineRef.current;
    if (!viewport || !line) return;
    const lineTop = line.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const top = lineTop - (viewport.clientHeight - line.clientHeight) / 2;
    viewport.scrollTo?.({
      top: Math.max(0, top),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, []);
  const pauseFollowing = useCallback(() => {
    setFollowState((current) =>
      current.trackId === track.id && !current.enabled
        ? current
        : { trackId: track.id, enabled: false },
    );
  }, [track.id]);

  useEffect(() => {
    if (open && following && activeLine >= 0) scrollToActiveLine();
  }, [activeLine, following, open, scrollToActiveLine, track.id, lyrics.data?.syncedLyrics]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col border-white/10 bg-[#11151d] p-0 text-white motion-reduce:transition-none sm:max-w-md"
      >
        <header className="shrink-0 border-b border-white/10 px-5 py-6 pr-12">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base text-white">
              <ScrollText className="h-4 w-4 text-primary" />
              Текст песни
            </SheetTitle>
            <button
              type="button"
              aria-label="Следить за текущей строкой"
              aria-pressed={following}
              title={following ? "Следить за текущей строкой" : "Вернуться к текущей строке"}
              disabled={syncedLines.length === 0}
              onClick={() => {
                if (following) scrollToActiveLine();
                else setFollowState({ trackId: track.id, enabled: true });
              }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${following ? "text-primary" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
            >
              <LocateFixed className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 truncate text-sm font-medium text-white">{track.title}</p>
          <p className="truncate text-xs text-white/50">{track.artist}</p>
        </header>
        <div
          ref={scrollViewportRef}
          role="region"
          aria-label="Текст песни"
          onWheel={pauseFollowing}
          onTouchMove={pauseFollowing}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) pauseFollowing();
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
              pauseFollowing();
            }
          }}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
        >
          {!allowed ? (
            <p className="text-sm text-white/60">Текст недоступен для этого аккаунта.</p>
          ) : lyrics.isPending ? (
            <p role="status" className="flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              Загружаем текст...
            </p>
          ) : lyrics.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3 text-sm text-amber-200">
              <p className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />Не удалось загрузить текст.</p>
              <button type="button" onClick={() => void lyrics.refetch()} className="rounded-md border border-white/20 px-3 py-2 text-white hover:bg-white/10">
                Повторить
              </button>
            </div>
          ) : syncedLines.length > 0 ? (
            <div className="space-y-1">
              {syncedLines.map((line, index) => (
                <button
                  key={`${line.time}-${index}`}
                  ref={index === activeLine ? activeLineRef : undefined}
                  type="button"
                  aria-label={`Перейти к ${formatDuration(line.time)}: ${line.text}`}
                  aria-current={index === activeLine ? "true" : undefined}
                  disabled={!Number.isFinite(seekDuration) || seekDuration <= 0}
                  onClick={() => seekTo(Math.min(100, line.time / seekDuration * 100))}
                  className={`block w-full rounded-md px-2 py-3 text-left text-base leading-relaxed transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default ${index === activeLine ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                >
                  {line.text}
                </button>
              ))}
            </div>
          ) : plainText ? (
            <p className="whitespace-pre-wrap break-words text-base leading-8 text-white/85">{plainText}</p>
          ) : (
            <p className="text-sm text-white/60">Текст пока недоступен</p>
          )}
        </div>
        {feedbackAvailable && (
          <footer className="shrink-0 border-t border-white/10 px-5 py-3 text-xs text-white/50">
            {lyrics.data?.source && hasLyrics && (
              <>
                <p>Источник: {lyrics.data.source === "lrclib" ? "LRCLIB" : "lyrics.ovh"}</p>
                {lyrics.data.match === "unverified" && (
                  <p className="mt-1 text-amber-200/80">Совпадение с записью не проверено</p>
                )}
              </>
            )}
            {feedback?.status === "sent" ? (
              <p role="status" className="mt-2 text-emerald-300">Спасибо, сообщение отправлено</p>
            ) : (
              <>
                <button
                  type="button"
                  aria-expanded={feedback?.open ?? false}
                  onClick={() => setFeedbackState({
                    trackId: track.id,
                    open: !feedback?.open,
                    reason: feedback?.reason ?? null,
                    status: "idle",
                  })}
                  className="mt-2 inline-flex items-center gap-2 rounded-md py-1 text-white/65 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Flag className="h-3.5 w-3.5" /> Сообщить о проблеме
                </button>
                {feedback?.open && (
                  <form onSubmit={(event) => { event.preventDefault(); void submitFeedback(); }} className="mt-2 space-y-3 border-t border-white/10 pt-3">
                    {hasLyrics ? (
                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-white/85">Что не так?</legend>
                        {feedbackReasons.map(({ value, label }) => (
                          <label key={value} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-white/75">
                            <input
                              type="radio"
                              name={`lyrics-feedback-${track.id}`}
                              value={value}
                              checked={feedback.reason === value}
                              onChange={() => setFeedbackState({ ...feedback, reason: value, status: "idle" })}
                              className="accent-primary"
                            />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <p className="text-sm text-white/75">Текст отсутствует</p>
                    )}
                    {feedback.status === "error" && (
                      <p role="alert" className="text-amber-200">Не удалось отправить. Попробуйте снова.</p>
                    )}
                    <button
                      type="submit"
                      disabled={feedback.status === "sending" || (hasLyrics && !feedback.reason)}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                    >
                      {feedback.status === "sending" ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Send className="h-4 w-4" />}
                      Отправить
                    </button>
                  </form>
                )}
              </>
            )}
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}
