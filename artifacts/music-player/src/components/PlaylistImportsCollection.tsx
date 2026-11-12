import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, ListMusic, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { DraftRecordingReview } from "@/components/DraftRecordingReview";
import { Button } from "@/components/ui/button";
import { useDeletePlaylistImport, usePlaylistImport, usePlaylistImportAccess, usePlaylistImports, useSavePlaylistImport } from "@/hooks/use-playlist-imports";
import { PlaylistImportInputError, readPlaylistImportFile, type ImportDraftEntry, type ImportDraftInput, type ImportDraftSource } from "@/lib/playlist-imports";
import { captureTfSecurityGeneration, isCurrentTfSecurityGeneration, TfApiError } from "@/lib/tf-session-client";
import { formatDuration } from "@/lib/utils";

const sourceLabel: Record<ImportDraftSource, string> = {
  file: "Файл TF",
  spotify_album: "Альбом Spotify",
  spotify_playlist: "Плейлист Spotify",
  spotify_liked: "Любимые Spotify",
};

function fileErrorMessage(error: unknown): string {
  if (error instanceof PlaylistImportInputError && error.code === "import_file_too_large") return "Размер файла превышает 128 КиБ.";
  if (error instanceof PlaylistImportInputError && error.code === "import_payload_too_large") return "Метаданные превышают 90 КиБ.";
  return "Не удалось прочитать файл экспорта TF. Проверьте формат и количество записей.";
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof TfApiError && error.status === 409) {
    if (error.code === "import_conflict") return "Этот черновик уже существует с другим содержимым.";
    if (error.code === "import_limit") return "Достигнут лимит черновиков.";
  }
  return "Не удалось сохранить черновик. Повторите попытку.";
}

type RecordingSlot = { draftId: string; position: number; generation: number };
type SavedEntries = {
  draftId: string;
  generation: number;
  activePosition: number | null;
  toggle?: (position: number) => void;
  onInvalidated: () => void;
};

function DraftEntries({ entries, saved }: { entries: ImportDraftEntry[]; saved?: SavedEntries }) {
  if (!entries.length) return <p className="border-y border-white/10 py-4 text-sm text-white/55">Нет записей.</p>;
  return (
    <ol aria-label="Записи черновика" className="divide-y divide-white/5 border-y border-white/10">
      {entries.map((entry, index) => (
        <li key={index} className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 px-1 py-2.5 sm:gap-3">
            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-white/45">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{entry.title}</p>
              <p className="break-words text-xs text-white/55">{entry.artist}</p>
              {!saved && <p className="mt-0.5 text-xs text-white/45">Не сопоставлено</p>}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-white/55">{entry.durationSeconds === null ? "—" : formatDuration(entry.durationSeconds)}</span>
            {saved?.toggle && <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0"
              aria-label={`Подобрать запись: ${entry.title} (позиция ${index + 1})`} title="Подобрать запись"
              aria-expanded={saved.activePosition === index} onClick={() => saved.toggle?.(index)}><Search className="size-4" /></Button>}
          </div>
          {saved?.activePosition === index && <DraftRecordingReview key={`${saved.draftId}:${index}:${saved.generation}`}
            draftId={saved.draftId} position={index} generation={saved.generation} entry={entry} onInvalidated={saved.onInvalidated} />}
        </li>
      ))}
    </ol>
  );
}

function LoadError({ children, retry }: { children: string; retry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm text-amber-200">
    <p>{children}</p>
    <Button type="button" variant="ghost" size="sm" onClick={retry}>Повторить</Button>
  </div>;
}

type FileReview = { id: string; input: ImportDraftInput };

function OwnedPlaylistImports() {
  const { hasEntitlement } = useTfAuth();
  const list = usePlaylistImports();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = usePlaylistImport(selectedId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [review, setReview] = useState<FileReview | null>(null);
  const [recordingSlot, setRecordingSlot] = useState<RecordingSlot | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const read = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const deleting = useRef(false);
  const save = useSavePlaylistImport();
  const remove = useDeletePlaylistImport();
  const draft = selected.data?.draft;
  const generation = captureTfSecurityGeneration();
  const canReviewRecording = hasEntitlement("tf.collections") && hasEntitlement("tf.search") && !confirmDelete;
  const activePosition = canReviewRecording && recordingSlot?.draftId === selectedId && recordingSlot.generation === generation
    ? recordingSlot.position : null;
  const dismissRecording = useCallback(() => setRecordingSlot(null), []);

  useEffect(() => () => read.current?.abort(), []);

  function selectDraft(id: string | null) {
    dismissRecording();
    setSelectedId(id);
    setConfirmDelete(false);
    remove.reset();
  }

  function inspectFile(file: File) {
    dismissRecording();
    read.current?.abort();
    const controller = new AbortController();
    const generation = captureTfSecurityGeneration();
    const current = () => !controller.signal.aborted && isCurrentTfSecurityGeneration(generation);
    read.current = controller;
    save.reset();
    setReview(null);
    setFileError(null);
    setReading(true);
    void readPlaylistImportFile(file, controller.signal).then((input) => {
      if (current()) setReview({ id: crypto.randomUUID(), input });
    }).catch((error: unknown) => {
      if (current()) setFileError(fileErrorMessage(error));
    }).finally(() => {
      if (read.current === controller) {
        read.current = null;
        if (current()) setReading(false);
      }
    });
  }

  function saveReview() {
    if (!review || saving.current) return;
    saving.current = true;
    const generation = captureTfSecurityGeneration();
    void save.mutateAsync(review).then(() => {
      if (!isCurrentTfSecurityGeneration(generation)) return;
      setReview(null);
      save.reset();
      selectDraft(review.id);
    }).catch(() => {}).finally(() => { saving.current = false; });
  }

  function deleteSelected() {
    if (!selectedId || !confirmDelete || deleting.current) return;
    deleting.current = true;
    const generation = captureTfSecurityGeneration();
    void remove.mutateAsync(selectedId).then(() => {
      if (isCurrentTfSecurityGeneration(generation)) selectDraft(null);
    }).catch(() => {}).finally(() => { deleting.current = false; });
  }

  function toggleRecording(position: number) {
    if (!draft || draft.id !== selectedId || !canReviewRecording || !isCurrentTfSecurityGeneration(generation)) return;
    setRecordingSlot((current) => current?.draftId === draft.id && current.position === position && current.generation === generation
      ? null : { draftId: draft.id, position, generation });
  }

  return (
    <section aria-label="Черновики импорта" className="text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Черновики импорта</h2>
        <Button type="button" size="icon" variant="ghost" className="size-9" aria-label="Обновить черновики" title="Обновить черновики"
          disabled={list.isFetching} onClick={() => void list.refetch()}>
          <RefreshCw className={`size-4 ${list.isFetching ? "motion-safe:animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="mb-5">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 text-sm font-medium hover:bg-white/5 focus-within:outline-2 focus-within:outline-white has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <FileUp className="size-4" /> Файл экспорта TF
          <input type="file" accept=".json,application/json" className="sr-only" disabled={save.isPending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) inspectFile(file);
            }} />
        </label>
        {reading && <p role="status" className="mt-2 text-sm text-white/60">Читаем файл...</p>}
        {fileError && <p role="alert" className="mt-2 text-sm text-amber-200">{fileError}</p>}
      </div>

      {review && <section aria-label="Проверка импорта" className="mb-6 border-y border-white/10 py-4">
        <h3 className="text-sm font-semibold">Проверка импорта</h3>
        <p className="mb-3 mt-1 break-words text-sm text-white/65">{review.input.name} · Записей: {review.input.entries.length}</p>
        <DraftEntries entries={review.input.entries} />
        {save.isError && <p role="alert" className="mt-3 text-sm text-amber-200">{saveErrorMessage(save.error)}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" disabled={save.isPending} onClick={saveReview}>Сохранить черновик</Button>
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => { save.reset(); setReview(null); }}>Отмена</Button>
          {save.isPending && <span role="status" className="text-sm text-white/60">Сохраняем...</span>}
        </div>
      </section>}

      {list.isPending && <p role="status" className="flex items-center gap-2 py-6 text-sm text-white/60"><Loader2 className="size-4 motion-safe:animate-spin" /> Загружаем черновики...</p>}
      {list.isError && <LoadError retry={() => void list.refetch()}>Не удалось загрузить черновики.</LoadError>}
      {list.isSuccess && list.data.imports.length === 0 && <p className="border-y border-white/10 py-6 text-sm text-white/55">Нет сохранённых черновиков.</p>}
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
        {!!list.data?.imports.length && <nav aria-label="Сохранённые черновики" className="min-w-0 border-y border-white/10 md:border-y-0 md:border-r md:pr-3">
          {list.data.imports.map((item) => (
            <button key={item.id} type="button" disabled={remove.isPending} onClick={() => selectDraft(item.id)}
              aria-current={selectedId === item.id ? "true" : undefined}
              className={`flex w-full min-w-0 items-center gap-3 border-b border-white/5 px-2 py-3 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-white ${selectedId === item.id ? "bg-white/10" : ""}`}>
              <ListMusic className="size-4 shrink-0 text-[#a78bfa]" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-white/55">{sourceLabel[item.source]}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-white/55">{item.entryCount}</span>
            </button>
          ))}
        </nav>}
        {selectedId && <div className="min-w-0">
          {selected.isPending && <p role="status" className="py-6 text-sm text-white/60">Загружаем записи...</p>}
          {selected.isError && <LoadError retry={() => void selected.refetch()}>Не удалось загрузить черновик.</LoadError>}
          {!selected.isError && draft && <>
            <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold">{draft.name}</h3>
                <p className="mt-1 text-xs text-white/55">{sourceLabel[draft.source]} · Записей: {draft.entryCount}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" aria-label="Удалить черновик" title="Удалить черновик"
                disabled={confirmDelete || remove.isPending} onClick={() => { dismissRecording(); setConfirmDelete(true); }}><Trash2 className="size-4" /></Button>
            </div>
            {confirmDelete && <div role="group" aria-label="Подтверждение удаления" className="mb-3 flex flex-wrap items-center gap-2 border-y border-red-400/20 py-3 text-sm text-red-200">
              <span>Удалить черновик?</span>
              <Button type="button" variant="destructive" size="sm" disabled={remove.isPending} onClick={deleteSelected}>Подтвердить удаление</Button>
              <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => { setConfirmDelete(false); remove.reset(); }}>Отмена</Button>
            </div>}
            {remove.isError && <p role="alert" className="mb-3 text-sm text-amber-200">Не удалось удалить черновик. Повторите попытку.</p>}
            <DraftEntries entries={draft.entries} saved={{
              draftId: draft.id, generation, activePosition,
              toggle: canReviewRecording ? toggleRecording : undefined, onInvalidated: dismissRecording,
            }} />
          </>}
        </div>}
      </div>
    </section>
  );
}

export function PlaylistImportsCollection() {
  const { status, owner } = usePlaylistImportAccess();
  if (status === "loading") return <p role="status" className="py-8 text-sm text-white/60">Проверяем доступ...</p>;
  if (!owner) return <p className="py-8 text-sm text-white/60">Черновики импорта недоступны для этого аккаунта.</p>;
  return <OwnedPlaylistImports key={JSON.stringify(owner)} />;
}
