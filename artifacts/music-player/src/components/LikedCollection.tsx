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
  ArrowUp,
  ArrowDown,
  GripVertical,
} from "lucide-react";
import { Reorder, useDragControls, useReducedMotion } from "framer-motion";
import type {
  TrackResult,
  LikedTrack,
  TrackSource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useTfAuth } from "@/auth/tf-auth";
import {
  useLikedCollection,
  useRemoveLikedTrack,
  useSaveLikedTrack,
} from "@/hooks/use-liked-collection";
import { usePlayer } from "@/hooks/use-player";
import { useToast } from "@/hooks/use-toast";
import { formatDuration } from "@/lib/utils";
import { PlaylistAction } from "@/components/PlaylistAction";
import { planLikedReorder } from "@/lib/liked-order";
import { useEffect, useRef, useState } from "react";

export function SaveLikedTrackButton({ track, saved, checking = false }: {
  track: TrackResult;
  saved: boolean;
  checking?: boolean;
}) {
  const save = useSaveLikedTrack();
  const remove = useRemoveLikedTrack();
  const { hasEntitlement } = useTfAuth();
  const { toast } = useToast();
  const [locallySaved, setLocallySaved] = useState(saved);
  useEffect(() => setLocallySaved(saved), [saved]);
  const label = locallySaved ? "Удалить из избранного" : "Сохранить в избранное";
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      title={label}
      aria-label={label}
      aria-pressed={locallySaved}
      className="h-9 w-9 rounded-lg text-[#a78bfa] hover:bg-white/5"
      disabled={
        !hasEntitlement("tf.collections") || checking || save.isPending || remove.isPending
      }
      onClick={() => {
        if (locallySaved) {
          remove.mutate(track.id, {
            onSuccess: () => setLocallySaved(false),
            onError: () => toast({
              title: "Не удалось удалить трек",
              description: "Повторите попытку позже.",
              variant: "destructive",
            }),
          });
          return;
        }
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
            onSuccess: () => setLocallySaved(true),
            onError: () =>
              toast({
                title: "Не удалось сохранить трек",
                description: "Повторите попытку позже.",
                variant: "destructive",
              }),
          },
        );
      }}
    >
      {checking || save.isPending || remove.isPending ? (
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
      ) : (
        <Heart className={`h-4 w-4 ${locallySaved ? "fill-current" : ""}`} />
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

function LikedTrackRow({
  item, index, count, canMove, hasNextPage, movePending, removePending,
  removingTrackId, onMove, onDrop, onPlay, onRemove,
}: {
  item: LikedTrack;
  index: number;
  count: number;
  canMove: boolean;
  hasNextPage: boolean;
  movePending: boolean;
  removePending: boolean;
  removingTrackId: string | undefined;
  onMove: (index: number, direction: -1 | 1) => void;
  onDrop: (trackId: string) => void;
  onPlay: (item: LikedTrack) => void;
  onRemove: (trackId: string) => void;
}) {
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();
  const title = item.title ?? "трек";
  const cannotMoveDown = index === count - 1 || (hasNextPage && index >= count - 2);

  return (
    <Reorder.Item
      value={item.trackId}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => onDrop(item.trackId)}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      whileDrag={{ backgroundColor: "#1b252b", boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}
      className="relative flex min-w-0 items-center gap-1 border-b border-white/5 bg-[#11151d] px-2 py-2.5 last:border-b-0 sm:gap-3 sm:px-3"
    >
      {canMove && (
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-md text-white/55 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8ddbd4] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          style={{ touchAction: "none" }}
          title="Перетащить; стрелки вверх и вниз для клавиатуры"
          aria-label={`Переместить ${title}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          disabled={movePending}
          onPointerDown={(event) => { if (event.button === 0 && !movePending) controls.start(event); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              onMove(index, event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        ><GripVertical className="h-5 w-5" /></button>
      )}
      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer"
          className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5">
          <Music2 className="h-4 w-4 text-white/40" />
        </span>
      )}
      <div className="min-w-0 flex-1 pl-1 sm:pl-0">
        <p className="truncate text-sm font-medium">{item.title ?? "Без названия"}</p>
        <p className="truncate text-xs text-white/50">{item.artist ?? "Неизвестный исполнитель"}</p>
      </div>
      <span className="hidden text-xs tabular-nums text-white/40 sm:inline">
        {item.durationSeconds === null ? "—" : formatDuration(item.durationSeconds)}
      </span>
      {canMove && (
        <div className="hidden w-8 shrink-0 flex-col items-center sm:flex" aria-label="Порядок трека">
          <Button type="button" variant="ghost" size="icon"
            className="h-6 w-8 rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
            title="Поднять трек" aria-label={`Поднять ${title}`}
            disabled={index === 0 || movePending}
            onClick={() => onMove(index, -1)}
          ><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon"
            className="h-6 w-8 rounded-sm text-white/60 hover:bg-white/10 hover:text-white"
            title={hasNextPage && index >= count - 2 ? "Загрузите следующую страницу" : "Опустить трек"}
            aria-label={`Опустить ${title}`}
            disabled={cannotMoveDown || movePending}
            onClick={() => onMove(index, 1)}
          ><ArrowDown className="h-4 w-4" /></Button>
        </div>
      )}
      <Button type="button" variant="ghost" size="icon"
        className="h-9 w-9 shrink-0 rounded-md text-[#a78bfa]"
        title="Воспроизвести" aria-label={`Воспроизвести ${title}`}
        onClick={() => onPlay(item)}
      ><Play className="h-4 w-4" /></Button>
      <PlaylistAction track={playableTrack(item)} />
      <Button type="button" variant="ghost" size="icon"
        className="h-9 w-9 shrink-0 rounded-md text-white/50"
        title="Удалить из избранного" aria-label={`Удалить ${title}`}
        disabled={removePending} onClick={() => onRemove(item.trackId)}
      >
        {removePending && removingTrackId === item.trackId
          ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          : <Trash2 className="h-4 w-4" />}
      </Button>
    </Reorder.Item>
  );
}

export function LikedCollection() {
  const { query, items, remove, move, revision, allowed } = useLikedCollection();
  const { playTrack, playCollection } = usePlayer();
  const { session } = useTfAuth();
  const { toast } = useToast();
  const serverIds = items.map((item) => item.trackId);
  const serverOrderKey = serverIds.join("\u0000");
  const proposedRef = useRef<string[]>([]);
  const [displayedIds, setDisplayedIds] = useState<string[]>([]);
  useEffect(() => {
    proposedRef.current = serverIds;
    setDisplayedIds(serverIds);
  }, [serverOrderKey, revision, session?.accountId]);
  const itemById = new Map(items.map((item) => [item.trackId, item]));
  const visibleIds = displayedIds.length === items.length &&
    displayedIds.every((id) => itemById.has(id)) ? displayedIds : serverIds;
  const visibleItems = visibleIds.map((id) => itemById.get(id)!);
  const restoreServerOrder = () => {
    proposedRef.current = serverIds;
    setDisplayedIds(serverIds);
  };
  const submitMove = (request: { trackId: string; beforeTrackId: string | null; expectedRevision: string }) => {
    move.mutate(request, {
      onError: (error) => {
        restoreServerOrder();
        const data = typeof error === "object" && error !== null && "data" in error
          ? error.data : null;
        const conflict = typeof error === "object" && error !== null &&
          "status" in error && error.status === 409 &&
          typeof data === "object" && data !== null &&
          "error" in data && data.error === "liked_order_conflict";
        toast({
          title: conflict ? "Порядок изменился на другом устройстве" : "Не удалось изменить порядок",
          description: conflict ? "Коллекция обновлена. Повторите перемещение." : "Повторите попытку позже.",
          variant: "destructive",
        });
      },
    });
  };
  const moveItem = (index: number, direction: -1 | 1) => {
    if (revision === undefined || move.isPending) return;
    if (direction > 0 && query.hasNextPage && index >= items.length - 2) return;
    const track = items[index];
    const beforeTrackId = direction < 0
      ? items[index - 1]?.trackId ?? null
      : items[index + 2]?.trackId ?? null;
    if (!track || (direction < 0 && (index === 0 || beforeTrackId === null)) ||
      (direction > 0 && index === items.length - 1)) return;
    submitMove({ trackId: track.trackId, beforeTrackId, expectedRevision: revision });
  };
  const dropItem = (trackId: string) => {
    const plan = planLikedReorder(serverIds, proposedRef.current, trackId,
      Boolean(query.hasNextPage), revision);
    if (plan.type !== "move") {
      restoreServerOrder();
      if (plan.type === "load_more")
        toast({ title: "Загрузите следующую страницу", description: "После загрузки можно переместить трек дальше." });
      return;
    }
    submitMove(plan.request);
  };
  if (!allowed)
    return (
      <div className="flex items-center gap-3 py-12 text-sm text-white/60">
        <LockKeyhole className="h-5 w-5" />
        Коллекция недоступна для этого аккаунта.
      </div>
    );
  return (
    <section aria-label="Коллекция Apollo" className="text-white">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">
          Моя коллекция
        </h2>
        <div className="flex items-center gap-2 text-xs text-white/50">
          {query.data && (
            <span className="tabular-nums">Загружено: {items.length}</span>
          )}
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-md bg-[#8ddbd4] px-3 text-[#071315] hover:bg-[#abe9e3]"
            aria-label="Воспроизвести загруженные треки"
            disabled={items.length === 0}
            onClick={() => void playCollection(items.map(playableTrack))}
          >
            <Play className="mr-1.5 h-4 w-4 fill-current" />
            Воспроизвести
          </Button>
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
        <Reorder.Group
          axis="y"
          values={visibleIds}
          onReorder={(next) => {
            if (move.isPending) return;
            proposedRef.current = next;
            setDisplayedIds(next);
          }}
          className="border-y border-white/10"
          aria-label="Любимые треки, ручной порядок"
        >
          {visibleItems.map((item, index) => (
            <LikedTrackRow
              key={item.trackId}
              item={item}
              index={index}
              count={visibleItems.length}
              canMove={revision !== undefined && visibleItems.length > 1}
              hasNextPage={Boolean(query.hasNextPage)}
              movePending={move.isPending}
              removePending={remove.isPending}
              removingTrackId={remove.variables}
              onMove={moveItem}
              onDrop={dropItem}
              onPlay={(track) => void playTrack(playableTrack(track))}
              onRemove={(id) => remove.mutate(id)}
            />
          ))}
        </Reorder.Group>
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
