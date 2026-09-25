import { useEffect, useState } from "react";
import { ListMusic, Loader2, Plus } from "lucide-react";
import type { TrackResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCollectionAccess } from "@/hooks/use-liked-collection";
import { useAddPlaylistTrack, useCreatePlaylist, usePlaylists } from "@/hooks/use-playlists";
import { useToast } from "@/hooks/use-toast";

export function PlaylistAction({ track }: { track: TrackResult }) {
  const access = useCollectionAccess();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState(false);
  const playlists = usePlaylists(open);
  const create = useCreatePlaylist();
  const add = useAddPlaylistTrack();
  const { toast } = useToast();
  const pending = create.isPending || add.isPending;
  useEffect(() => {
    setOpen(false);
  }, [access.accountId]);

  const addTo = async (playlistId: number) => {
    setError(false);
    try {
      const result = await add.mutateAsync({
        playlistId,
        track: {
          trackId: track.id,
          artist: track.artist,
          title: track.title,
          thumbnailUrl: track.thumbnailUrl ?? null,
          durationSeconds: track.duration > 0 ? Math.round(track.duration) : null,
        },
      });
      toast({ title: result.added ? "Добавлено в плейлист" : "Уже в плейлисте", description: track.title });
      setOpen(false);
    } catch {
      setError(true);
    }
  };

  return <>
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-9 w-9 rounded-lg text-white/70 hover:bg-white/5"
      title="Добавить в плейлист"
      aria-label={`Добавить ${track.title} в плейлист`}
      disabled={!access.allowed}
      onClick={() => { setError(false); setOpen(true); }}
    ><ListMusic className="h-4 w-4" /></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto rounded-lg border-white/10 bg-[#14181e] text-white">
        <DialogHeader>
          <DialogTitle>Добавить в плейлист</DialogTitle>
          <DialogDescription className="truncate text-white/50">{track.artist} · {track.title}</DialogDescription>
        </DialogHeader>
        {playlists.isPending && <p role="status" className="flex items-center gap-2 py-5 text-sm text-white/60"><Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Загрузка плейлистов...</p>}
        {playlists.isError && <div role="alert" className="flex items-center justify-between gap-2 text-sm text-amber-200">Не удалось загрузить плейлисты.<Button type="button" variant="ghost" size="sm" onClick={() => void playlists.refetch()}>Повторить</Button></div>}
        {playlists.data && <div className="max-h-56 overflow-y-auto border-y border-white/10">
          {playlists.data.playlists.length === 0 && <p className="py-5 text-sm text-white/50">Плейлистов пока нет</p>}
          {playlists.data.playlists.map((playlist) => <button
            key={playlist.id}
            type="button"
            disabled={pending}
            className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-2 py-3 text-left text-sm hover:bg-white/5 disabled:opacity-50"
            onClick={() => void addTo(playlist.id)}
          ><span className="truncate">{playlist.name}</span><span className="shrink-0 text-xs tabular-nums text-white/40">{playlist.trackCount}</span></button>)}
        </div>}
        <form className="flex gap-2" onSubmit={(event) => {
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
        </form>
        {error && <p role="alert" className="text-sm text-red-300">Не удалось сохранить трек. Повторите попытку.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
