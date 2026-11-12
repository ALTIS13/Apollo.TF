import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Download, ExternalLink, Play } from "lucide-react";
import type { ImportRecordingCandidate, ImportRecordingCandidatesResponse, ImportRecordingSelectionResponse, PutImportRecordingSelectionRequest } from "@workspace/api-client-react";
import { useTfAuth } from "@/auth/tf-auth";
import { Button } from "@/components/ui/button";
import { useOptionalPlayer } from "@/hooks/use-player";
import { apiUrl } from "@/lib/api-config";
import type { ImportDraftEntry } from "@/lib/playlist-imports";
import { reviewedMediaPath, reviewedTrackId } from "@/lib/reviewed-recording";
import { canUseTfProtectedActivity, isCurrentTfSecurityGeneration, subscribeTfActivitySuspension, TfApiError, tfFetch } from "@/lib/tf-session-client";
import { formatDuration } from "@/lib/utils";

const editionLabels = {
  original: "Оригинал",
  clean_edit: "Цензурированная версия",
  alternate: "Другая версия",
  unknown: "Версия неизвестна",
};
const accessLabels = {
  full: "Полная запись",
  preview: "Только фрагмент",
  blocked: "Доступ закрыт",
  unverified: "Доступ не подтверждён",
};
const downloadLabels = {
  permitted: "Скачивание разрешено",
  not_permitted: "Скачивание не разрешено",
  unverified: "Разрешение на скачивание не подтверждено",
};

type ReviewLoad = { kind: "loading" | "error" } | { kind: "loaded"; page: ImportRecordingCandidatesResponse };
type ReviewScope = { draftId: string; position: number; generation: number; onInvalidated: () => void };
type SaveError = "changed" | "not-full" | "failed";
const saveErrorLabels: Record<SaveError, string> = {
  changed: "Данные о записи изменились. Обновите варианты.",
  "not-full": "Полная запись больше не подтверждена. Обновите варианты.",
  failed: "Не удалось сохранить выбор.",
};

function useDraftRecordingReview({ draftId, position, generation, onInvalidated }: ReviewScope) {
  const { session, hasEntitlement } = useTfAuth();
  const path = `/collections/imports/${encodeURIComponent(draftId)}/entries/${position}`;
  const [load, setLoad] = useState<ReviewLoad>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<ImportRecordingCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const refreshRequired = saveError === "changed" || saveError === "not-full";
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const canRequest = useCallback(() => isCurrentTfSecurityGeneration(generation) && canUseTfProtectedActivity(session) &&
    hasEntitlement("tf.collections") && hasEntitlement("tf.search"), [generation, session, hasEntitlement]);

  useLayoutEffect(() => {
    const abort = () => {
      read.current?.abort();
      write.current?.abort();
    };
    const unsubscribe = subscribeTfActivitySuspension(() => {
      abort();
      onInvalidated();
    });
    return () => { unsubscribe(); abort(); };
  }, [onInvalidated]);

  useEffect(() => {
    if (!canRequest()) return;
    const controller = new AbortController();
    read.current = controller;
    const current = () => !controller.signal.aborted && canRequest();
    void tfFetch<ImportRecordingCandidatesResponse>(`${path}/candidates`, { cache: "no-store", signal: controller.signal }).then((page) => {
      if (!page || (page.status !== "ready" && page.status !== "unconfigured") || !Array.isArray(page.candidates)) {
        throw new Error("invalid_candidates");
      }
      if (current()) setLoad({ kind: "loaded", page });
    }).catch(() => { if (current()) setLoad({ kind: "error" }); });
    return () => { controller.abort(); if (read.current === controller) read.current = null; };
  }, [path, attempt, canRequest]);

  function reload() {
    if (write.current || !canRequest()) return;
    setLoad({ kind: "loading" });
    setChoice(null);
    setSaveError(null);
    setAttempt((value) => value + 1);
  }

  function choose(candidate: ImportRecordingCandidate) {
    if (candidate.access !== "full" || refreshRequired || write.current || !canRequest()) return;
    setChoice(candidate);
    setSaveError(null);
  }

  function confirm() {
    if (load.kind !== "loaded" || !choice || choice.access !== "full" || refreshRequired || write.current || !canRequest()) return;
    const controller = new AbortController();
    write.current = controller;
    setSaving(true);
    setSaveError(null);
    const current = () => !controller.signal.aborted && canRequest();
    const input: PutImportRecordingSelectionRequest = { candidateId: choice.id, evidenceRevision: choice.evidenceRevision };
    void tfFetch<ImportRecordingSelectionResponse>(`${path}/selection`, {
      method: "PUT", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }).then((result) => {
      if (result?.selection?.candidateId !== input.candidateId || result.selection.evidenceRevision !== input.evidenceRevision) {
        throw new Error("invalid_selection");
      }
      if (current()) {
        setLoad((previous) => previous.kind === "loaded"
          ? { kind: "loaded", page: { ...previous.page, selection: result.selection } } : previous);
        setChoice(null);
      }
    }).catch((error: unknown) => {
      if (!current()) return;
      if (error instanceof TfApiError && error.status === 409 && error.code === "recording_selection_changed") {
        setChoice(null);
        setSaveError("changed");
      } else if (error instanceof TfApiError && error.status === 409 && error.code === "recording_not_full") {
        setChoice(null);
        setSaveError("not-full");
      } else setSaveError("failed");
    }).finally(() => {
      if (write.current === controller) write.current = null;
      if (current()) setSaving(false);
    });
  }

  return { load, reload, choice, choose, saving, saveError, refreshRequired, confirm, canRequest };
}

function duration(seconds: number | null) {
  return seconds === null ? "—" : formatDuration(seconds);
}

function noticeableDurationDifference(imported: number | null, measured: number | null): number | null {
  if (imported === null || measured === null) return null;
  const seconds = Math.abs(measured - imported);
  return seconds > Math.max(2, imported * 0.02) ? seconds : null;
}

function sourceHref(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function DraftRecordingReview({ entry, ...scope }: ReviewScope & { entry: ImportDraftEntry }) {
  const review = useDraftRecordingReview(scope);
  const player = useOptionalPlayer();
  const { hasEntitlement } = useTfAuth();
  const radioGroup = useId();
  const page = review.load.kind === "loaded" ? review.load.page : null;
  const selection = page?.selection;
  const saved = selection && page?.candidates.find((candidate) =>
    candidate.id === selection.candidateId && candidate.evidenceRevision === selection.evidenceRevision);
  const mediaId = saved?.access === "full" && saved.mediaBound === true && !review.saving && !review.refreshRequired
    ? reviewedTrackId(scope.draftId, scope.position, saved.evidenceRevision) : null;
  const filePath = mediaId && saved?.download === "permitted" && hasEntitlement("tf.downloads")
    ? reviewedMediaPath(mediaId, "file") : null;

  function playSaved() {
    if (!mediaId || !saved || !player || !review.canRequest()) return;
    void player.playTrack({
      id: mediaId, source: "reviewed", type: "original", title: saved.title, artist: saved.artist,
      duration: saved.measuredDurationSeconds ?? saved.expectedDurationSeconds ?? 0,
      thumbnailUrl: null, quality: [], score: 0,
    });
  }

  return (
    <section aria-label={`Подбор записи: ${entry.title} (позиция ${scope.position + 1})`} className="min-w-0 border-t border-white/10 px-2 py-3 sm:px-3">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold">Подбор записи</h4>
        <p className="flex gap-1.5 text-xs text-white/55"><span>Длительность в импорте:</span><span className="tabular-nums">{duration(entry.durationSeconds)}</span></p>
      </div>
      {review.load.kind === "loading" && <p role="status" className="text-sm text-white/60">Загружаем варианты...</p>}
      {review.load.kind === "error" && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
        <p>Не удалось загрузить варианты записи.</p>
        <Button type="button" size="sm" variant="ghost" onClick={review.reload}>Повторить</Button>
      </div>}
      {selection && <p role="status" className="mb-3 break-words text-sm text-white/75">
        {saved ? `Сохранённый выбор: ${saved.title}` : "Сохранённый выбор устарел."}
      </p>}
      {mediaId && (player || filePath) && <div className="mb-3 flex flex-wrap items-center gap-2">
        {player && <Button type="button" size="sm" variant="outline" className="min-h-10 whitespace-normal" onClick={playSaved}
          onKeyDown={(event) => { if (event.code === "Space" || event.key === " ") event.stopPropagation(); }}>
          <Play className="size-4" /> Воспроизвести выбранную запись
        </Button>}
        {filePath && <Button asChild size="sm" variant="ghost" className="min-h-10 whitespace-normal">
          <a href={apiUrl(filePath)} target="_blank" rel="noopener noreferrer" onClick={(event) => {
            if (!review.canRequest() || !hasEntitlement("tf.downloads")) event.preventDefault();
          }}><Download className="size-4" /> Скачать выбранную запись</a>
        </Button>}
      </div>}
      {page?.status === "unconfigured" && <p className="text-sm text-white/60">Каталог проверенных записей не настроен.</p>}
      {page?.status === "ready" && (page.candidates.length ? <>
        <fieldset className="min-w-0">
          <legend className="sr-only">Варианты записи</legend>
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {page.candidates.map((candidate) => {
              const href = sourceHref(candidate.sourceUrl);
              const difference = noticeableDurationDifference(entry.durationSeconds, candidate.measuredDurationSeconds);
              return <li key={candidate.id} className="min-w-0 py-3">
                <label className="flex min-w-0 items-start gap-2">
                  <input type="radio" name={radioGroup} aria-label={candidate.title} disabled={candidate.access !== "full" || review.saving || review.refreshRequired}
                    checked={review.choice === candidate} onChange={() => review.choose(candidate)}
                    className="mt-0.5 size-4 shrink-0 accent-[#8ddbd4] focus-visible:outline-2 focus-visible:outline-white" />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">{candidate.title}</span>
                    <span className="block break-words text-xs text-white/55">{candidate.artist}</span>
                  </span>
                </label>
                <div className="mt-2 space-y-2 pl-6 text-xs text-white/65">
                  <dl className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
                    <div><dt className="text-white/50">Версия по каталогу</dt><dd>{editionLabels[candidate.edition] ?? editionLabels.unknown}</dd></div>
                    <div><dt className="text-white/50">Дата выпуска</dt><dd className="break-words">{candidate.releaseDate ?? "—"}</dd></div>
                    <div><dt className="text-white/50">Ожидаемая длительность</dt><dd className="tabular-nums">{duration(candidate.expectedDurationSeconds)}</dd></div>
                    <div><dt className="text-white/50">Измеренная длительность</dt><dd className="tabular-nums">{duration(candidate.measuredDurationSeconds)}</dd></div>
                  </dl>
                  {difference !== null && <p className="text-amber-200">Длительность отличается на {difference} с.</p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span>{accessLabels[candidate.access] ?? accessLabels.unverified}</span>
                    <span>{downloadLabels[candidate.download] ?? downloadLabels.unverified}</span>
                  </div>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1.5 break-words underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-white">
                    <span className="min-w-0 break-words">{candidate.sourceLabel}</span><ExternalLink className="size-3 shrink-0" />
                  </a> : <p className="break-words">{candidate.sourceLabel}</p>}
                </div>
              </li>;
            })}
          </ul>
        </fieldset>
        {review.saveError && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-200">
          <p>{saveErrorLabels[review.saveError]}</p>
          <Button type="button" size="sm" variant="ghost" onClick={review.reload}>Обновить варианты</Button>
        </div>}
        <Button type="button" size="sm" className="mt-3 min-h-10" disabled={!review.choice || review.saving} onClick={review.confirm}>Подтвердить выбор</Button>
        {review.saving && <p role="status" className="mt-2 text-xs text-white/60">Сохраняем выбор...</p>}
      </> : <p className="text-sm text-white/60">Проверенных вариантов нет.</p>)}
    </section>
  );
}
