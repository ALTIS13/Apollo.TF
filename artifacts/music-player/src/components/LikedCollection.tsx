import {
  Heart,
  Loader2,
  RefreshCw,
  AlertCircle,
  Music2,
  Play,
  Trash2,
  ChevronDown,
  LockKeyhole,
} from "lucide-react";
import type {
  TrackResult,
  LikedTrack,
  TrackSource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useTfAuth } from "@/auth/tf-auth";
import {
  useLikedCollection,
  useSaveLikedTrack,
} from "@/hooks/use-liked-collection";
import { usePlayer } from "@/hooks/use-player";
import { useToast } from "@/hooks/use-toast";
import { formatDuration } from "@/lib/utils";

export function SaveLikedTrackButton({ track }: { track: TrackResult }) {
  const save = useSaveLikedTrack();
  const { hasEntitlement } = useTfAuth();
  const { toast } = useToast();
  const label = save.isSuccess
    ? "Сохранено в избранном"
    : "Сохранить в избранное";
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      title={label}
      aria-label={label}
      className="h-9 w-9 rounded-lg text-[#a78bfa] hover:bg-white/5"
      disabled={
        !hasEntitlement("tf.collections") || save.isPending || save.isSuccess
      }
      onClick={() =>
        save.mutate(
          {
            trackId: track.id,
            artist: track.artist,
            title: track.title,
            thumbnailUrl: track.thumbnailUrl ?? null,
            durationSeconds:
              track.duration > 0 ? Math.round(track.duration) : null,
          },
          {
            onError: () =>
              toast({
                title: "Не удалось сохранить трек",
                description: "Повторите попытку позже.",
                variant: "destructive",
              }),
          },
        )
      }
    >
      {save.isPending ? (
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
      ) : (
        <Heart className={`h-4 w-4 ${save.isSuccess ? "fill-current" : ""}`} />
      )}
    </Button>
  );
}

function playableTrack(item: LikedTrack): TrackResult {
  const sources: Record<string, TrackSource> = {
    yt: "youtube",
    sc: "soundcloud",
    bc: "bandcamp",
    dz: "deezer",
  };
  return {
    id: item.trackId,
    artist: item.artist ?? "Неизвестный исполнитель",
    title: item.title ?? "Без названия",
    thumbnailUrl: item.thumbnailUrl,
    duration: item.durationSeconds ?? 0,
    source: sources[item.trackId.split("_")[0]] ?? "youtube",
    type: "original",
    quality: [],
    score: 0,
  };
}

export function LikedCollection() {
  const { query, items, remove, allowed } = useLikedCollection();
  const { playTrack } = usePlayer();
  if (!allowed)
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-white/60">
        <LockKeyhole className="h-5 w-5" />
        Коллекция недоступна для этого аккаунта.
      </div>
    );
  return (
    <section aria-label="Коллекция Apollo" className="text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">
          Моя коллекция
        </h2>
        <div className="flex items-center gap-2 text-xs text-white/50">
          {query.data && (
            <span className="tabular-nums">Загружено: {items.length}</span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg"
            aria-label="Обновить коллекцию"
            title="Обновить коллекцию"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={`h-4 w-4 ${query.isFetching ? "motion-safe:animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>
      {query.isPending && (
        <div
          role="status"
          className="flex items-center gap-3 py-12 text-sm text-white/60"
        >
          <Loader2 className="h-5 w-5 motion-safe:animate-spin text-[#a78bfa]" />
          Загрузка коллекции...
        </div>
      )}
      {query.isError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-lg border border-amber-400/20 bg-[#11151d] p-3 text-sm text-amber-200"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {query.data
              ? "Не удалось обновить. Показана последняя загруженная коллекция."
              : "Не удалось загрузить коллекцию. Повторите попытку."}
          </span>
        </div>
      )}
      {remove.isError && (
        <p role="alert" className="mb-3 text-sm text-red-300">
          Не удалось удалить трек. Он остался в коллекции.
        </p>
      )}
      {query.isSuccess && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 border-y border-white/10 py-14 text-center">
          <Heart className="h-7 w-7 text-[#a78bfa]" />
          <p className="text-sm text-white/60">В коллекции пока нет треков</p>
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-white/5 border-y border-white/10 bg-[#11151d]/40">
          {items.map((item) => (
            <li
              key={item.trackId}
              className="flex min-w-0 items-center gap-3 px-2 py-3 sm:px-3"
            >
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <Music2 className="h-4 w-4 text-white/40" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.title ?? "Без названия"}
                </p>
                <p className="truncate text-xs text-white/50">
                  {item.artist ?? "Неизвестный исполнитель"}
                </p>
              </div>
              <span className="hidden text-xs tabular-nums text-white/40 sm:inline">
                {item.durationSeconds === null
                  ? "—"
                  : formatDuration(item.durationSeconds)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg text-[#a78bfa]"
                title="Воспроизвести"
                aria-label={`Воспроизвести ${item.title ?? "трек"}`}
                onClick={() => void playTrack(playableTrack(item))}
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg text-white/50"
                title="Удалить из избранного"
                aria-label={`Удалить ${item.title ?? "трек"}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.trackId)}
              >
                {remove.isPending && remove.variables === item.trackId ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            <ChevronDown className="mr-2 h-4 w-4" />
            {query.isFetchingNextPage ? "Загрузка..." : "Ещё треки"}
          </Button>
        </div>
      )}
    </section>
  );
}
