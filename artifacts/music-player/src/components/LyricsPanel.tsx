import { useQuery } from "@tanstack/react-query";
import type { TrackResult } from "@workspace/api-client-react";
import { AlertCircle, Loader2, ScrollText } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { formatDuration } from "@/lib/utils";
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

  const syncedLines = parseSyncedLyrics(lyrics.data?.syncedLyrics);
  let activeLine = -1;
  for (let index = 0; index < syncedLines.length; index += 1) {
    if (syncedLines[index].time <= progress) activeLine = index;
    else break;
  }
  const seekDuration = duration > 0 ? duration : track.duration;
  const plainText = lyrics.data?.plainLyrics?.trim() ||
    (syncedLines.length === 0 ? lyrics.data?.syncedLyrics?.trim() : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col border-white/10 bg-[#11151d] p-0 text-white motion-reduce:transition-none sm:max-w-md"
      >
        <header className="shrink-0 border-b border-white/10 px-5 py-6 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base text-white">
            <ScrollText className="h-4 w-4 text-primary" />
            Текст песни
          </SheetTitle>
          <p className="mt-3 truncate text-sm font-medium text-white">{track.title}</p>
          <p className="truncate text-xs text-white/50">{track.artist}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
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
        {allowed && !lyrics.isError && lyrics.data?.source && (syncedLines.length > 0 || plainText) && (
          <footer className="shrink-0 border-t border-white/10 px-5 py-3 text-xs text-white/50">
            <p>Источник: {lyrics.data.source === "lrclib" ? "LRCLIB" : "lyrics.ovh"}</p>
            {lyrics.data.match === "unverified" && (
              <p className="mt-1 text-amber-200/80">Совпадение с записью не проверено</p>
            )}
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}
