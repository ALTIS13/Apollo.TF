import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import {
  parseLyricsFeedbackList,
  type LyricsFeedbackList,
} from "@workspace/admin-dashboard-contract";
import type { DashboardAdapterMode } from "../types/dashboard";

interface LyricsFeedbackPanelProps {
  mode: DashboardAdapterMode;
  refreshKey?: string;
}

type Report = LyricsFeedbackList["reports"][number];
type LoadState = "demo" | "loading" | "ready" | "unavailable";

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

export function LyricsFeedbackPanel({ mode, refreshKey }: LyricsFeedbackPanelProps) {
  const [state, setState] = useState<{
    kind: LoadState;
    reports: Report[];
  }>({ kind: mode === "demo" ? "demo" : "loading", reports: [] });

  useEffect(() => {
    if (mode === "demo") {
      setState({ kind: "demo", reports: [] });
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/lyrics-feedback", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Lyrics feedback unavailable");
        const list = parseLyricsFeedbackList(await response.json());
        if (!controller.signal.aborted) setState({ kind: "ready", reports: list.reports });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "unavailable", reports: [] });
      }
    })();
    return () => controller.abort();
  }, [mode, refreshKey]);

  return (
    <section className="data-panel lyrics-feedback-panel" id="lyrics-feedback" aria-labelledby="lyrics-feedback-title">
      <div className="data-panel-header">
        <span className="panel-title-icon parser" aria-hidden="true"><Flag /></span>
        <div>
          <h2 id="lyrics-feedback-title">Сообщения о текстах</h2>
          <p>{state.kind === "ready" ? `${state.reports.length} последних` : "Качество текстов песен"}</p>
        </div>
      </div>
      {state.kind !== "ready" ? (
        <p className="lyrics-feedback-state" role="status">
          {state.kind === "demo" ? "Данные доступны в рабочей панели" :
            state.kind === "loading" ? "Загружаем сообщения..." : "Сообщения временно недоступны"}
        </p>
      ) : state.reports.length === 0 ? (
        <p className="lyrics-feedback-state">Сообщений нет</p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Сообщения о текстах песен">
            <thead>
              <tr>
                <th scope="col">Трек</th>
                <th scope="col">Проблема</th>
                <th scope="col">Источник</th>
                <th scope="col">Аккаунт</th>
                <th scope="col">Получено</th>
              </tr>
            </thead>
            <tbody>
              {state.reports.map((report) => (
                <tr key={report.id}>
                  <th scope="row" title={`${report.artist} — ${report.title}`}>
                    <strong>{report.title}</strong><small>{report.artist}</small>
                    <small title={report.trackId}>{report.trackId}</small>
                  </th>
                  <td>{reasonLabels[report.reason]}</td>
                  <td>{sourceLabels[report.lyricsSource]}</td>
                  <td><code title={report.accountId}>{report.accountId.slice(0, 8)}…</code></td>
                  <td><time dateTime={report.createdAt}>{reportedAt.format(new Date(report.createdAt))}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
