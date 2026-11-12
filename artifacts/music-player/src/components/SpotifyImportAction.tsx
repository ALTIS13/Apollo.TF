import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ListPlus } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useSavePlaylistImport } from "@/hooks/use-playlist-imports";
import type { SpotifyAlbumOwner } from "@/hooks/use-spotify";
import { MAX_IMPORT_ENTRIES } from "@/lib/playlist-imports";
import { readSpotifyImport, SpotifyImportError, type SpotifyImportPreview, type SpotifyImportRangeRequest, type SpotifyImportSelection } from "@/lib/spotify-import";
import { captureTfSecurityGeneration, isCurrentTfSecurityGeneration, reportTfAuthError, TfApiError } from "@/lib/tf-session-client";
import { formatDuration } from "@/lib/utils";

export function SpotifyImportAction({ owner, selection }: { owner: SpotifyAlbumOwner | null; selection: SpotifyImportSelection }) {
  const { status, session, hasEntitlement } = useTfAuth();
  if (status !== "authenticated" || !owner || session?.accountId !== owner[0] || session.installationId !== owner[1] ||
      !hasEntitlement("tf.integrations") || !hasEntitlement("tf.collections")) return null;
  return <SpotifyImportDialog key={JSON.stringify([owner, selection])} selection={selection} />;
}

function SpotifyImportDialog({ selection }: { selection: SpotifyImportSelection }) {
  const queryClient = useQueryClient();
  const save = useSavePlaylistImport();
  const operation = useRef<{ controller: AbortController; generation: number; saving: boolean; saved: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [savedClosed, setSavedClosed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRange, setRetryRange] = useState<SpotifyImportRangeRequest | null>(null);
  const [preview, setPreview] = useState<(SpotifyImportPreview & { id: string | null; saved: boolean }) | null>(null);

  const stop = () => {
    operation.current?.controller.abort();
    operation.current = null;
  };
  useLayoutEffect(() => stop, []);

  const current = (request: NonNullable<typeof operation.current>) =>
    operation.current === request && !request.controller.signal.aborted && isCurrentTfSecurityGeneration(request.generation);

  async function load(range: SpotifyImportRangeRequest = { offset: 0 }) {
    if (operation.current?.saving) return;
    stop();
    const request = { controller: new AbortController(), generation: captureTfSecurityGeneration(), saving: false, saved: false };
    operation.current = request;
    save.reset();
    setPreview(null);
    setSavedClosed(false);
    setError(null);
    setRetryRange(null);
    setLoading(true);
    try {
      const result = await readSpotifyImport(selection, request.controller.signal, undefined, range);
      if (current(request)) setPreview({ ...result, id: result.input ? crypto.randomUUID() : null, saved: false });
    } catch (cause) {
      if (!current(request)) return;
      if (cause instanceof TfApiError && cause.kind === "provider") {
        void queryClient.invalidateQueries({ queryKey: ["spotify", "status"] });
      } else reportTfAuthError(cause);
      const code = cause instanceof SpotifyImportError ? cause.code : null;
      setRetryRange(code === "changed" ? { offset: 0 } : range);
      setError(code ? {
        too_large: "Метаданные диапазона не помещаются в черновик.",
        changed: "Коллекция изменилась во время чтения. Повторите загрузку с начала.",
        invalid: "Spotify вернул неполные или некорректные данные.",
      }[code] : "Не удалось загрузить метаданные Spotify.");
    } finally {
      if (current(request)) setLoading(false);
    }
  }

  async function confirm() {
    const request = operation.current;
    if (!preview?.input || !preview.id || !request || !current(request) || request.saving || request.saved) return;
    const confirmedPreview = preview;
    request.saving = true;
    setSaving(true);
    setError(null);
    try {
      await save.mutateAsync({ id: preview.id, input: preview.input });
      if (current(request)) {
        request.saved = true;
        save.reset();
        if (confirmedPreview.range.total > MAX_IMPORT_ENTRIES) {
          setPreview({ ...confirmedPreview, saved: true });
        } else {
          setOpen(false);
          setSavedClosed(true);
          setPreview(null);
        }
      }
    } catch (cause) {
      if (current(request)) {
        setError(cause instanceof TfApiError && cause.code === "import_limit"
          ? "Достигнут лимит черновиков. Освободите место в коллекции Apollo."
          : cause instanceof TfApiError && cause.code === "import_conflict"
            ? "Черновик с этим идентификатором уже существует. Проверьте список импортов."
            : "Не удалось сохранить черновик. Повторите попытку или проверьте список импортов.");
      }
    } finally {
      if (current(request)) setSaving(false);
      request.saving = false;
    }
  }

  function changeRange(offset: number) {
    const request = operation.current;
    if (preview && request && current(request)) void load({ offset, expectedTotal: preview.range.total });
  }

  const multipleRanges = preview !== null && preview.range.total > MAX_IMPORT_ENTRIES;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={(next) => {
        if (!next && operation.current?.saving) return;
        setOpen(next);
        if (next) void load();
        else { stop(); save.reset(); setPreview(null); }
      }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="min-h-10"><ListPlus /> Импортировать метаданные</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] min-w-0 overflow-y-auto rounded-lg p-4 sm:p-6">
          <DialogTitle className="pr-7 tracking-normal">Импорт из Spotify</DialogTitle>
          <DialogDescription className="break-words">{selection.name} · Только метаданные</DialogDescription>
          {loading && <p role="status" className="text-sm text-muted-foreground">Загружаем треки…</p>}
          {preview && <>
            {multipleRanges && <nav aria-label="Диапазоны Spotify" className="flex min-w-0 items-center justify-between gap-2 border-y border-white/10 py-1">
              <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0" title="Предыдущий диапазон" aria-label="Предыдущий диапазон"
                disabled={saving || preview.range.offset === 0} onClick={() => changeRange(preview.range.offset - MAX_IMPORT_ENTRIES)}><ChevronLeft /></Button>
              <p role="status" className="min-w-0 text-center text-sm tabular-nums">Позиции {preview.range.offset + 1}–{preview.range.end} из {preview.range.total}</p>
              <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0" title="Следующий диапазон" aria-label="Следующий диапазон"
                disabled={saving || preview.range.end >= preview.range.total} onClick={() => changeRange(preview.range.offset + MAX_IMPORT_ENTRIES)}><ChevronRight /></Button>
            </nav>}
            <p className="text-sm tabular-nums">Треков: {preview.input?.entries.length ?? 0}{(multipleRanges || preview.unavailable > 0) && ` · Недоступно: ${preview.unavailable}`}</p>
            {preview.input ? <ol aria-label="Треки в черновике" className="max-h-[40dvh] min-w-0 overflow-y-auto divide-y divide-white/10">
              {preview.input.entries.map((entry, index) => <li key={index} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                <span className="w-7 shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
                <div className="min-w-0 flex-1 break-words"><p className="font-medium">{entry.title}</p><p className="text-xs text-muted-foreground">{entry.artist}</p></div>
                {entry.durationSeconds !== null && <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(entry.durationSeconds)}</span>}
              </li>)}
            </ol> : <p className="text-sm text-muted-foreground">{multipleRanges ? "В этом диапазоне нет доступных треков для импорта." : "В этой коллекции нет доступных треков для импорта."}</p>}
            {preview.saved && <p role="status" className="text-sm text-[#8ddbd4]">Диапазон сохранён как отдельный черновик.</p>}
          </>}
          {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>{preview?.saved ? "Закрыть" : "Отмена"}</Button></DialogClose>
            {preview?.input && <Button type="button" onClick={() => void confirm()} disabled={saving || preview.saved}>
              {saving ? "Сохраняем…" : multipleRanges ? "Сохранить диапазон как черновик" : "Сохранить черновик"}
            </Button>}
            {retryRange && <Button type="button" onClick={() => void load(retryRange)}>Повторить</Button>}
          </div>
        </DialogContent>
      </Dialog>
      {savedClosed && <p role="status" className="text-sm text-[#8ddbd4]">Черновик сохранён.</p>}
    </div>
  );
}
