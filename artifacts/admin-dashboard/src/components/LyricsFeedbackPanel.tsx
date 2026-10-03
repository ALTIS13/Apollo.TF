import { Fragment, useEffect, useState } from "react";
import { Check, ChevronDown, Flag, RotateCcw, X } from "lucide-react";
import {
  lyricsFeedbackTriageUpdateResultSchema,
  parseLyricsFeedbackTriageList,
  type LyricsFeedbackStatus,
  type LyricsFeedbackTriageList,
} from "@workspace/admin-dashboard-contract";
import type { DashboardAdapterMode } from "../types/dashboard";

interface LyricsFeedbackPanelProps {
  mode: DashboardAdapterMode;
  refreshKey?: string;
}

type Report = LyricsFeedbackTriageList["reports"][number];
type LoadState = "demo" | "loading" | "ready" | "unavailable";
type PanelState = {
  kind: LoadState;
  status: LyricsFeedbackStatus;
  reports: Report[];
  nextCursor: number | null;
};

const statuses: { id: LyricsFeedbackStatus; label: string }[] = [
  { id: "open", label: "Новые" },
  { id: "reviewing", label: "В работе" },
  { id: "resolved", label: "Решены" },
  { id: "dismissed", label: "Отклонены" },
];
const reasonLabels: Record<Report["reason"], string> = {
  wrong_track: "Не тот трек",
  out_of_sync: "Сбиты тайминги",
  incomplete: "Неполный текст",
  missing: "Текст отсутствует",
};
const sourceLabels: Record<Report["lyricsSource"], string> = {
  lrclib: "LRCLIB",
  "lyrics.ovh": "lyrics.ovh",
  none: "Нет источника",
};
const reportedAt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});
const demoReport: Report = {
  id: 1,
  accountId: "10000000-0000-4000-8000-000000000001",
  trackId: "yt_demo_track",
  artist: "Apollo Demo",
  title: "Пример сообщения",
  lyricsSource: "lrclib",
  reason: "out_of_sync",
  createdAt: "2026-09-26T12:00:00.000Z",
  status: "open",
  revision: 1,
  updatedAt: "2026-09-26T12:00:00.000Z",
  resolutionNote: null,
};

function triageUrl(status: LyricsFeedbackStatus, before: number | null): string {
  const query = new URLSearchParams({ status });
  if (before !== null) query.set("before", String(before));
  return `/api/admin/lyrics-feedback/triage?${query}`;
}

export function LyricsFeedbackPanel({ mode, refreshKey }: LyricsFeedbackPanelProps) {
  const [status, setStatus] = useState<LyricsFeedbackStatus>("open");
  const [state, setState] = useState<PanelState>({
    kind: mode === "demo" ? "demo" : "loading",
    status: "open",
    reports: mode === "demo" ? [demoReport] : [],
    nextCursor: null,
  });
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<{ id: number; status: "resolved" | "dismissed" } | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "demo") {
      setState({ kind: "demo", status, reports: status === "open" ? [demoReport] : [], nextCursor: null });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading", status, reports: [], nextCursor: null });
    void (async () => {
      try {
        const response = await fetch(triageUrl(status, null), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Lyrics feedback unavailable");
        const list = parseLyricsFeedbackTriageList(await response.json());
        if (!controller.signal.aborted) {
          setState({ kind: "ready", status, reports: list.reports, nextCursor: list.nextCursor });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({ kind: "unavailable", status, reports: [], nextCursor: null });
        }
      }
    })();
    return () => controller.abort();
  }, [mode, refreshKey, reload, status]);

  async function loadMore(): Promise<void> {
    if (state.kind !== "ready" || state.nextCursor === null || loadingMore) return;
    const before = state.nextCursor;
    setLoadingMore(true);
    try {
      const response = await fetch(triageUrl(status, before), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Lyrics feedback unavailable");
      const list = parseLyricsFeedbackTriageList(await response.json());
      setState((current) => current.kind === "ready" && current.status === status && current.nextCursor === before
        ? { ...current, reports: [...current.reports, ...list.reports], nextCursor: list.nextCursor }
        : current);
    } catch {
      setMessage("Не удалось загрузить следующую страницу");
    } finally {
      setLoadingMore(false);
    }
  }

  async function updateReport(report: Report, nextStatus: LyricsFeedbackStatus, explanation?: string): Promise<void> {
    if (busyId !== null) return;
    setBusyId(report.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/lyrics-feedback/${report.id}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, expectedRevision: report.revision, ...(explanation ? { note: explanation.trim() } : {}) }),
      });
      if (response.status === 409) {
        setMessage("Сообщение уже изменено. Список обновлён.");
        setReload((value) => value + 1);
        return;
      }
      if (!response.ok) throw new Error("Lyrics feedback update unavailable");
      lyricsFeedbackTriageUpdateResultSchema.parse(await response.json());
      setPending(null);
      setNote("");
      setReload((value) => value + 1);
    } catch {
      setMessage("Не удалось изменить состояние сообщения");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="data-panel lyrics-feedback-panel" id="lyrics-feedback" aria-labelledby="lyrics-feedback-title">
      <div className="data-panel-header">
        <span className="panel-title-icon parser" aria-hidden="true"><Flag /></span>
        <div>
          <h2 id="lyrics-feedback-title">Сообщения о текстах</h2>
          <p>{state.kind === "ready" ? `${state.reports.length} загружено` : mode === "demo" ? "Пример очереди" : "Качество текстов песен"}</p>
        </div>
      </div>
      <div className="lyrics-feedback-filters" aria-label="Состояние сообщений">
        {statuses.map((item) => (
          <button key={item.id} type="button" aria-pressed={status === item.id}
            onClick={() => { setStatus(item.id); setPending(null); setMessage(null); }}>
            {item.label}
          </button>
        ))}
      </div>
      {message && <p className="lyrics-feedback-message" role="alert">{message}</p>}
      {state.kind === "loading" || state.kind === "unavailable" ? (
        <p className="lyrics-feedback-state" role="status">
          {state.kind === "loading" ? "Загружаем сообщения..." : "Сообщения временно недоступны"}
        </p>
      ) : state.reports.length === 0 ? (
        <p className="lyrics-feedback-state">Сообщений в этом состоянии нет</p>
      ) : (
        <>
          <div className="table-scroll">
            <table aria-label="Сообщения о текстах песен">
              <thead>
                <tr>
                  <th scope="col">Трек</th>
                  <th scope="col">Проблема</th>
                  <th scope="col">Источник</th>
                  <th scope="col">Аккаунт</th>
                  <th scope="col">Получено</th>
                  <th scope="col">Действие</th>
                </tr>
              </thead>
              <tbody>
                {state.reports.map((report) => (
                  <Fragment key={report.id}>
                    <tr>
                      <th scope="row" title={`${report.artist} — ${report.title}`}>
                        <strong>{report.title}</strong><small>{report.artist}</small>
                        <small title={report.trackId}>{report.trackId}</small>
                      </th>
                      <td>{reasonLabels[report.reason]}{report.resolutionNote && <small className="lyrics-feedback-note" title={report.resolutionNote}>{report.resolutionNote}</small>}</td>
                      <td>{sourceLabels[report.lyricsSource]}</td>
                      <td><code title={report.accountId}>{report.accountId.slice(0, 8)}…</code></td>
                      <td><time dateTime={report.createdAt}>{reportedAt.format(new Date(report.createdAt))}</time></td>
                      <td>
                        {state.kind === "demo" ? <span className="lyrics-feedback-demo-label">Демо</span> : (
                          <div className="lyrics-feedback-actions">
                            {report.status === "open" && <button type="button" disabled={busyId !== null} onClick={() => void updateReport(report, "reviewing")}><Check aria-hidden="true" />В работу</button>}
                            {report.status === "reviewing" && <>
                              <button type="button" disabled={busyId !== null} onClick={() => { setPending({ id: report.id, status: "resolved" }); setNote(""); }}><Check aria-hidden="true" />Решить</button>
                              <button type="button" disabled={busyId !== null} onClick={() => { setPending({ id: report.id, status: "dismissed" }); setNote(""); }}><X aria-hidden="true" />Отклонить</button>
                              <button type="button" disabled={busyId !== null} onClick={() => void updateReport(report, "open")}><RotateCcw aria-hidden="true" />Вернуть</button>
                            </>}
                            {(report.status === "resolved" || report.status === "dismissed") && <button type="button" disabled={busyId !== null} onClick={() => void updateReport(report, "open")}><RotateCcw aria-hidden="true" />Вернуть</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                    {pending?.id === report.id && <tr className="lyrics-feedback-decision-row">
                      <td colSpan={6}>
                        <form className="lyrics-feedback-decision" onSubmit={(event) => { event.preventDefault(); void updateReport(report, pending.status, note); }}>
                          <label htmlFor={`lyrics-feedback-note-${report.id}`}>{pending.status === "resolved" ? "Как решено" : "Причина отклонения"}</label>
                          <textarea id={`lyrics-feedback-note-${report.id}`} value={note} onChange={(event) => setNote(event.target.value)} required minLength={3} maxLength={500} rows={2} />
                          <button type="submit" disabled={busyId !== null || note.trim().length < 3}>Подтвердить</button>
                          <button type="button" onClick={() => setPending(null)}>Отмена</button>
                        </form>
                      </td>
                    </tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {state.nextCursor !== null && <button className="lyrics-feedback-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}><ChevronDown aria-hidden="true" />{loadingMore ? "Загружаем..." : "Показать ещё"}</button>}
        </>
      )}
    </section>
  );
}
