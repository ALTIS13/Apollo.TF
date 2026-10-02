import { useEffect, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ChevronLeft, ListMusic, Loader2, Music2, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { TrackResult, TrackSource } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PlaylistExportAction } from "@/components/PlaylistExportAction";
import { useCollectionAccess } from "@/hooks/use-liked-collection";
import { useCreatePlaylist, useDeletePlaylist, usePlaylist, usePlaylists, useRemovePlaylistTrack, useReorderPlaylistTracks, type PlaylistTrack } from "@/hooks/use-playlists";
import { usePlayer } from "@/hooks/use-player";
import { formatDuration } from "@/lib/utils";

function playableTrack(item: PlaylistTrack): TrackResult {
  const sources: Record<string, TrackSource> = { yt: "youtube", sc: "soundcloud", bc: "bandcamp", dz: "deezer" };
  return {
    id: item.trackId,
    artist: item.artist,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    duration: item.durationSeconds ?? 0,
    source: sources[item.trackId.split("_")[0]] ?? "youtube",
    type: "original",
    quality: [],
    score: 0,
  };
}

export function PlaylistsCollection() {
  const access = useCollectionAccess();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const playlists = usePlaylists();
  const selected = usePlaylist(selectedId);
  const create = useCreatePlaylist();
  const removeTrack = useRemovePlaylistTrack();
  const reorder = useReorderPlaylistTracks();
  const deletePlaylist = useDeletePlaylist();
  const { playTrack, playCollection } = usePlayer();
  const rows = playlists.data?.playlists ?? [];
  useEffect(() => {
    setSelectedId(null);
  }, [access.accountId]);
  const moveTrack = (from: number, to: number) => {
    if (!selected.data || reorder.isPending || to < 0 || to >= selected.data.tracks.length) return;
    const trackIds = selected.data.tracks.map((item) => item.trackId);
    [trackIds[from], trackIds[to]] = [trackIds[to], trackIds[from]];
    void reorder.mutateAsync({ playlistId: selected.data.playlist.id, trackIds }).catch(() => {});
  };

  if (!access.allowed) return <p className="py-12 text-sm text-white/60">Плейлисты недоступны для этого аккаунта.</p>;

  return <section aria-label="Мои плейлисты" className="text-white">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Мои плейлисты</h2>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-lg" title="Обновить плейлисты" aria-label="Обновить плейлисты" disabled={playlists.isFetching} onClick={() => void playlists.refetch()}>
        <RefreshCw className={`h-4 w-4 ${playlists.isFetching ? "motion-safe:animate-spin" : ""}`} />
      </Button>
    </div>
    <form className="mb-6 flex max-w-lg gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || create.isPending) return;
      void create.mutateAsync(name.trim()).then(({ playlist }) => {
        setName("");
        setSelectedId(playlist.id);
      }).catch(() => {});
    }}>
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} aria-label="Название нового плейлиста" placeholder="Новый плейлист" className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#14181e] px-3 py-2 text-sm text-white outline-none focus:border-white/40" />
      <Button type="submit" disabled={!name.trim() || create.isPending} className="rounded-lg">
        {create.isPending ? <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Создать
      </Button>
    </form>
    {create.isError && <p role="alert" className="mb-4 text-sm text-red-300">Не удалось создать плейлист. Повторите попытку.</p>}
    {playlists.isPending && <p role="status" className="flex items-center gap-2 py-8 text-sm text-white/60"><Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Загрузка плейлистов...</p>}
    {playlists.isError && <p role="alert" className="mb-4 flex items-center gap-2 text-sm text-amber-200"><AlertCircle className="h-4 w-4" /> Не удалось загрузить плейлисты.</p>}
    {playlists.isSuccess && rows.length === 0 && <div className="flex flex-col items-center gap-3 border-y border-white/10 py-12 text-center text-sm text-white/50"><ListMusic className="h-7 w-7" /> Создайте первый плейлист и добавьте в него записи из поиска.</div>}
    {rows.length > 0 && <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
      <nav aria-label="Список плейлистов" className="border-y border-white/10 md:border-r md:border-y-0 md:pr-3">
        {rows.map((row) => <button key={row.id} type="button" onClick={() => { setSelectedId(row.id); setConfirmDelete(false); }} aria-current={selectedId === row.id ? "page" : undefined} className={`flex w-full items-center gap-3 border-b border-white/5 px-2 py-3 text-left text-sm transition-colors hover:bg-white/5 ${selectedId === row.id ? "bg-white/10 text-white" : "text-white/70"}`}>
          <ListMusic className="h-4 w-4 shrink-0 text-[#a78bfa]" />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="text-xs tabular-nums text-white/40">{row.trackCount}</span>
        </button>)}
      </nav>
      <div className="min-w-0">
        {selectedId === null && <p className="py-8 text-sm text-white/50">Выберите плейлист.</p>}
        {selectedId !== null && selected.isPending && <p role="status" className="flex items-center gap-2 py-8 text-sm text-white/60"><Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Загрузка треков...</p>}
        {selectedId !== null && selected.isError && <div role="alert" className="flex items-center justify-between gap-2 py-4 text-sm text-amber-200">Не удалось загрузить плейлист.<Button type="button" variant="ghost" size="sm" onClick={() => void selected.refetch()}>Повторить</Button></div>}
        {selected.data && <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 md:hidden" title="К списку плейлистов" aria-label="К списку плейлистов" onClick={() => setSelectedId(null)}><ChevronLeft className="h-4 w-4" /></Button>
              <h3 className="truncate text-sm font-semibold">{selected.data.playlist.name}</h3>
              <span className="shrink-0 text-xs tabular-nums text-white/40">{selected.data.tracks.length}</span>
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-1">
              <Button type="button" size="sm" className="min-h-11 rounded-lg" aria-label="Слушать плейлист" disabled={selected.data.tracks.length === 0} onClick={() => void playCollection(selected.data.tracks.map(playableTrack))}><Play className="mr-2 h-4 w-4" />Слушать</Button>
              <PlaylistExportAction key={`${access.accountId}:${selected.data.playlist.id}`}
                detail={selected.data} ownerAccountId={access.accountId}
                disabled={selected.isFetching || selected.isError || reorder.isPending || removeTrack.isPending || deletePlaylist.isPending || confirmDelete} />
              <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0 text-white/50" title="Удалить плейлист" aria-label="Удалить плейлист" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          {confirmDelete && <div role="alertdialog" aria-label="Удалить плейлист?" className="mb-4 flex flex-wrap items-center gap-3 border-y border-red-400/20 py-3 text-sm text-red-200">
            <span>Удалить «{selected.data.playlist.name}»? Треки останутся в других коллекциях.</span>
            <Button type="button" size="sm" variant="destructive" disabled={deletePlaylist.isPending} onClick={() => void deletePlaylist.mutateAsync(selected.data.playlist.id).then(() => { setSelectedId(null); setConfirmDelete(false); }).catch(() => {})}>Удалить</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button>
          </div>}
          {deletePlaylist.isError && <p role="alert" className="mb-3 text-sm text-red-300">Не удалось удалить плейлист.</p>}
          {reorder.isError && <p role="alert" className="mb-3 text-sm text-red-300">Не удалось изменить порядок треков.</p>}
          {removeTrack.isError && <p role="alert" className="mb-3 text-sm text-red-300">Не удалось удалить трек.</p>}
          {selected.data.tracks.length === 0 ? <p className="border-t border-white/10 py-8 text-sm text-white/50">Плейлист пуст. Добавьте запись из поиска.</p> : <ul className="divide-y divide-white/5 border-y border-white/10">
            {selected.data.tracks.map((item, index) => <li key={item.trackId} className="flex min-w-0 items-center gap-2 py-3 sm:gap-3">
              {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-md object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5"><Music2 className="h-4 w-4 text-white/40" /></span>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-white/50">{item.artist}</p></div>
              <span className="hidden shrink-0 text-xs tabular-nums text-white/40 sm:inline">{item.durationSeconds === null ? "—" : formatDuration(item.durationSeconds)}</span>
              <div className="flex shrink-0 flex-col">
                <Button type="button" variant="ghost" size="icon" className="h-5 w-7 text-white/50" title="Переместить выше" aria-label={`Переместить ${item.title} выше`} disabled={index === 0 || reorder.isPending} onClick={() => moveTrack(index, index - 1)}><ArrowUp className="h-3 w-3" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-5 w-7 text-white/50" title="Переместить ниже" aria-label={`Переместить ${item.title} ниже`} disabled={index === selected.data.tracks.length - 1 || reorder.isPending} onClick={() => moveTrack(index, index + 1)}><ArrowDown className="h-3 w-3" /></Button>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-[#a78bfa]" title="Воспроизвести" aria-label={`Воспроизвести ${item.title}`} onClick={() => void playTrack(playableTrack(item))}><Play className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-white/50" title="Убрать из плейлиста" aria-label={`Убрать ${item.title} из плейлиста`} disabled={removeTrack.isPending} onClick={() => void removeTrack.mutateAsync({ playlistId: selected.data.playlist.id, trackId: item.trackId }).catch(() => {})}>{removeTrack.isPending && removeTrack.variables?.trackId === item.trackId ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button>
            </li>)}
          </ul>}
        </>}
      </div>
    </div>}
  </section>;
}
