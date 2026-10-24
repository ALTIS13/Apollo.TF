import { useEffect, useRef, useState } from "react";
import { ListMusic, Loader2, Plus } from "lucide-react";
import type { TrackResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCollectionAccess } from "@/hooks/use-liked-collection";
import { useAddPlaylistTrack, useCreatePlaylist, usePlaylists, type PlaylistTrackInput } from "@/hooks/use-playlists";
import { useToast } from "@/hooks/use-toast";
import { useTfAuth } from "@/auth/tf-auth";
import { captureTfSecurityGeneration, isCurrentTfSecurityGeneration } from "@/lib/tf-session-client";

export interface PlaylistBatchResult {
  added: number;
  alreadyPresent: number;
  unconfirmed: number;
}

type Batch = {
  tracks: readonly TrackResult[];
  onConfirmed: (trackId: string) => void;
  onPendingChange: (pending: boolean) => void;
  onResult: (result: PlaylistBatchResult) => void;
};
type BatchRemainder = {
  playlistId: number;
  tracks: readonly PlaylistTrackInput[];
  added: number;
  alreadyPresent: number;
};

function playlistInput(track: TrackResult): PlaylistTrackInput {
  return {
    trackId: track.id, artist: track.artist, title: track.title,
    thumbnailUrl: track.thumbnailUrl ?? null,
    durationSeconds: track.duration > 0 ? Math.round(track.duration) : null,
  };
}

export function PlaylistAction({ track, batch, disabled = false }: { disabled?: boolean } & (
  { track: TrackResult; batch?: never } | { track?: never; batch: Batch }
)) {
  const auth = useTfAuth();
  const access = useCollectionAccess();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState(false);
  const [batchPending, setBatchPending] = useState(false);
  const [remainder, setRemainder] = useState<BatchRemainder | null>(null);
  const remainderRef = useRef(remainder);
  const mounted = useRef(false);
  const openRef = useRef(false);
  const operation = useRef<{ cancelled: boolean } | null>(null);
  const ownerKey = auth.session
    ? `${auth.session.accountId}:${auth.session.installationId}:${auth.session.entitlements.includes("tf.collections")}` : "none";
  const current = useRef({ auth, access, ownerKey });
  current.current = { auth, access, ownerKey };
  const playlists = usePlaylists(open);
  const create = useCreatePlaylist();
  const add = useAddPlaylistTrack();
  const { toast } = useToast();
  const pending = batchPending || create.isPending || add.isPending;
  const changeOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (!next && operation.current) operation.current.cancelled = true;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) operation.current.cancelled = true;
    };
  }, []);
  useEffect(() => {
    changeOpen(false);
  }, [auth.session, access.allowed]);
  useEffect(() => {
    remainderRef.current = null;
    setRemainder(null);
    setError(false);
  }, [ownerKey]);

  const runBatch = async (snapshot: BatchRemainder) => {
    if (!batch || operation.current || !access.allowed || !openRef.current ||
      snapshot.tracks.length === 0 || snapshot.tracks.length > 20) return;
    const run = { cancelled: false };
    operation.current = run;
    const session = auth.session;
    const generation = captureTfSecurityGeneration();
    const scopeCurrent = () => mounted.current && current.current.ownerKey === ownerKey &&
      current.current.auth.session === session && current.current.access.allowed &&
      current.current.auth.hasEntitlement("tf.collections") && isCurrentTfSecurityGeneration(generation);
    const canContinue = () => !run.cancelled && openRef.current && scopeCurrent();
    const publish = (state: BatchRemainder) => {
      remainderRef.current = state;
      setRemainder(state);
      batch.onResult({ added: state.added, alreadyPresent: state.alreadyPresent, unconfirmed: state.tracks.length });
    };
    setError(false);
    setBatchPending(true);
    batch.onPendingChange(true);
    publish(snapshot);
    let remaining = snapshot;
    try {
      // A sent request can commit after close/scope loss; only a current response confirms membership.
      for (const input of snapshot.tracks) {
        if (!canContinue()) break;
        const result = await add.mutateAsync({ playlistId: snapshot.playlistId, track: input });
        if (!canContinue()) break;
        remaining = {
          ...remaining, tracks: remaining.tracks.slice(1),
          added: remaining.added + (result.added ? 1 : 0),
          alreadyPresent: remaining.alreadyPresent + (result.added ? 0 : 1),
        };
        batch.onConfirmed(input.trackId);
        publish(remaining);
      }
      if (canContinue() && remaining.tracks.length === 0) changeOpen(false);
    } catch {
      if (canContinue()) setError(true);
    } finally {
      if (operation.current === run) {
        operation.current = null;
        if (mounted.current) {
          setBatchPending(false);
          if (current.current.ownerKey === ownerKey) batch.onPendingChange(false);
        }
      }
    }
  };

  const addTo = async (playlistId: number) => {
    if (batch) {
      if (pending || disabled || operation.current) return;
      const snapshot = Object.freeze(batch.tracks.map((item) => Object.freeze(playlistInput(item))));
      await runBatch({ playlistId, tracks: snapshot, added: 0, alreadyPresent: 0 });
      return;
    }
    setError(false);
    try {
      const result = await add.mutateAsync({
        playlistId,
        track: playlistInput(track),
      });
      toast({ title: result.added ? "Добавлено в плейлист" : "Уже в плейлисте", description: track.title });
      changeOpen(false);
    } catch {
      setError(true);
    }
  };

  return <>
    <Button
      type="button"
      size={batch ? "sm" : "icon"}
      variant="ghost"
      className={batch ? "min-h-11 max-w-full whitespace-normal rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/5 motion-reduce:transition-none" : "h-9 w-9 rounded-lg text-white/70 hover:bg-white/5"}
      title="Добавить в плейлист"
      aria-label={batch ? "Добавить выбранные в плейлист" : `Добавить ${track.title} в плейлист`}
      disabled={!access.allowed || disabled || (batch && (pending || batch.tracks.length === 0))}
      onClick={() => {
        setError(false);
        if (batch && remainderRef.current) {
          const ids = new Set(batch.tracks.map((item) => item.id));
          const rest = remainderRef.current;
          const sameSelection = ids.size === rest.tracks.length && rest.tracks.every((item) => ids.has(item.trackId));
          remainderRef.current = sameSelection && rest.tracks.length > 0 ? rest : null;
          setRemainder(remainderRef.current);
        }
        changeOpen(true);
      }}
    ><ListMusic className="h-4 w-4" />{batch && "Добавить в плейлист"}</Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-lg border-white/10 bg-[#14181e] text-white motion-reduce:animate-none! motion-reduce:transition-none!">
        <DialogHeader>
          <DialogTitle>Добавить в плейлист</DialogTitle>
          <DialogDescription className="break-words text-sm text-white/50">{batch ? `Выбрано: ${batch.tracks.length}` : `${track.artist} · ${track.title}`}</DialogDescription>
        </DialogHeader>
        {batch && remainder && <div className="space-y-2 text-sm text-white/70">
          <p role="status">Добавлено {remainder.added}, уже в плейлисте {remainder.alreadyPresent}. Осталось подтвердить {remainder.tracks.length}.</p>
          {remainder.tracks.length > 0 && <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal rounded-md" disabled={pending || !access.allowed}
            onClick={() => { if (remainderRef.current) void runBatch(remainderRef.current); }}>Повторить неподтверждённые</Button>}
        </div>}
        {playlists.isPending && <p role="status" className="flex items-center gap-2 py-5 text-sm text-white/60"><Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Загрузка плейлистов...</p>}
        {playlists.isError && <div role="alert" className="flex items-center justify-between gap-2 text-sm text-amber-200">Не удалось загрузить плейлисты.<Button type="button" variant="ghost" size="sm" onClick={() => void playlists.refetch()}>Повторить</Button></div>}
        {playlists.data && <div className="max-h-56 overflow-y-auto border-y border-white/10">
          {playlists.data.playlists.length === 0 && <p className="py-5 text-sm text-white/50">Плейлистов пока нет</p>}
          {playlists.data.playlists.map((playlist) => <button
            key={playlist.id}
            type="button"
            disabled={pending || Boolean(batch && remainder)}
            className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-2 py-3 text-left text-sm hover:bg-white/5 disabled:opacity-50"
            onClick={() => void addTo(playlist.id)}
          ><span className="truncate">{playlist.name}</span><span className="shrink-0 text-xs tabular-nums text-white/40">{playlist.trackCount}</span></button>)}
        </div>}
        {!batch && <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || pending) return;
          setError(false);
          void create.mutateAsync(name.trim()).then(({ playlist }) => {
            setName("");
            return addTo(playlist.id);
          }).catch(() => setError(true));
        }}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Новый плейлист"
            aria-label="Название нового плейлиста"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/40"
          />
          <Button type="submit" size="sm" disabled={!name.trim() || pending} aria-label="Создать плейлист и добавить трек">
            {pending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Plus className="h-4 w-4" />}
            Создать
          </Button>
        </form>}
        {error && <p role="alert" className="text-sm text-red-300">Не удалось сохранить трек. Повторите попытку.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
