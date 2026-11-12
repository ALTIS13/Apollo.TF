import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useSavePlaylistImport } from "@/hooks/use-playlist-imports";
import type { SpotifyAlbumOwner } from "@/hooks/use-spotify";
import { MAX_IMPORT_ENTRIES } from "@/lib/playlist-imports";
import { readSpotifyImport, SpotifyImportError, type SpotifyImportPreview, type SpotifyImportSelection } from "@/lib/spotify-import";
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
  const operation = useRef<{ controller: AbortController; generation: number; saving: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<(SpotifyImportPreview & { id: string }) | null>(null);

  const stop = () => {
    operation.current?.controller.abort();
    operation.current = null;
  };
  useEffect(() => stop, []);

  const current = (request: NonNullable<typeof operation.current>) =>
    operation.current === request && !request.controller.signal.aborted && isCurrentTfSecurityGeneration(request.generation);

  async function load() {
    stop();
    const request = { controller: new AbortController(), generation: captureTfSecurityGeneration(), saving: false };
    operation.current = request;
    setPreview(null);
    setSaved(false);
    setError(null);
    setLoading(true);
    try {
      const result = await readSpotifyImport(selection, request.controller.signal);
      if (current(request)) setPreview({ ...result, id: crypto.randomUUID() });
    } catch (cause) {
      if (!current(request)) return;
      if (cause instanceof TfApiError && cause.kind === "provider") {
        void queryClient.invalidateQueries({ queryKey: ["spotify", "status"] });
      } else reportTfAuthError(cause);
      setError(cause instanceof SpotifyImportError ? {
        too_large: `В одном черновике можно сохранить до ${MAX_IMPORT_ENTRIES} треков.`,
        changed: "Коллекция изменилась во время чтения. Повторите загрузку.",
        invalid: "Spotify вернул неполные или некорректные данные.",
        empty: "В этой коллекции нет доступных треков для импорта.",
      }[cause.code] : "Не удалось загрузить метаданные Spotify.");
    } finally {
      if (current(request)) setLoading(false);
    }
  }

  async function confirm() {
    const request = operation.current;
    if (!preview || !request || !current(request) || request.saving) return;
    request.saving = true;
    setSaving(true);
    setError(null);
    try {
      await save.mutateAsync({ id: preview.id, input: preview.input });
      if (current(request)) {
        setOpen(false);
        setSaved(true);
        setPreview(null);
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

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={(next) => {
        if (!next && operation.current?.saving) return;
        setOpen(next);
        if (next) void load();
        else { stop(); setPreview(null); }
      }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="min-h-10"><ListPlus /> Импортировать метаданные</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] min-w-0 overflow-y-auto rounded-lg p-4 sm:p-6">
          <DialogTitle className="pr-7 tracking-normal">Импорт из Spotify</DialogTitle>
          <DialogDescription className="break-words">{selection.name} · Только метаданные</DialogDescription>
          {loading && <p role="status" className="text-sm text-muted-foreground">Загружаем треки…</p>}
          {preview && <>
            <p className="text-sm tabular-nums">Треков: {preview.input.entries.length}{preview.unavailable > 0 && ` · Недоступно: ${preview.unavailable}`}</p>
            <ol aria-label="Треки в черновике" className="max-h-[40dvh] min-w-0 overflow-y-auto divide-y divide-white/10">
              {preview.input.entries.map((entry, index) => <li key={index} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                <span className="w-7 shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
                <div className="min-w-0 flex-1 break-words"><p className="font-medium">{entry.title}</p><p className="text-xs text-muted-foreground">{entry.artist}</p></div>
                {entry.durationSeconds !== null && <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(entry.durationSeconds)}</span>}
              </li>)}
            </ol>
          </>}
          {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Отмена</Button></DialogClose>
            {preview ? <Button type="button" onClick={() => void confirm()} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить черновик"}</Button>
              : error && <Button type="button" onClick={() => void load()}>Повторить</Button>}
          </div>
        </DialogContent>
      </Dialog>
      {saved && <p role="status" className="text-sm text-[#8ddbd4]">Черновик сохранён.</p>}
    </div>
  );
}
