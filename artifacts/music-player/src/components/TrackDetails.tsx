import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, Info, RotateCcw, Search, X } from "lucide-react";
import type { TrackResult } from "@workspace/api-client-react";
import type { TrackDownloadState } from "@/hooks/use-track-download";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTfAuth } from "@/auth/tf-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function downloadFailureFeedback(code: unknown) {
  if (code === "preview_rejected") return {
    code, shortLabel: "Фрагмент", statusLabel: "Только фрагмент трека.",
    description: "Источник содержит только фрагмент трека. Выберите другую запись.",
  };
  if (code === "duration_unverified") return {
    code, shortLabel: "Не проверено", statusLabel: "Длительность не проверена.",
    description: "Не удалось проверить длительность записи. Попробуйте другой источник.",
  };
  return {
    code: undefined, shortLabel: "Ошибка", statusLabel: "Не удалось начать загрузку.",
    description: "Не удалось начать загрузку.",
  };
}

interface TrackDetailsProps {
  readonly track: TrackResult;
  readonly recordingTypeLabel: string;
  readonly downloadState: TrackDownloadState;
  readonly failureCode?: unknown;
  readonly onRetry: () => Promise<void>;
}

const sources: Record<string, string> = {
  youtube: "YouTube", soundcloud: "SoundCloud", bandcamp: "Bandcamp", deezer: "Deezer",
};

export function TrackDetails({ track, recordingTypeLabel, downloadState, failureCode, onRetry }: TrackDetailsProps) {
  const [open, setOpen] = useState(false);
  const { status } = useTfAuth();
  useEffect(() => {
    if (status !== "authenticated") setOpen(false);
  }, [status]);
  // Portals escape the retained session boundary's hidden wrapper.
  if (status !== "authenticated") return null;
  const failed = downloadState === "failed";
  const feedback = downloadFailureFeedback(failureCode);
  const artist = track.artist.trim();
  const title = track.title.trim();
  const searchable = artist.length > 0 && artist.length <= 200 && title.length > 0 && title.length <= 300;
  const href = `/?${new URLSearchParams({ artist, title })}`;
  const numericLabels = track.quality.length > 0 && track.quality.every((value) => /^\d+$/.test(value));
  const quality = track.quality.length === 0 ? "Не указаны" : `${track.quality.join(", ")}${numericLabels ? " кбит/с" : ""}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button" variant="outline" size="icon"
          className={cn("size-11 shrink-0 motion-reduce:transition-none", failed && "text-destructive")}
          aria-label={`Сведения об источнике: ${track.title}`}
          title={failed ? "Ошибка загрузки и сведения об источнике" : "Сведения об источнике"}
        >
          {failed ? <AlertCircle /> : <Info />}
        </Button>
      </DialogTrigger>
      <DialogContent className="z-[110] max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] min-w-0 overflow-y-auto rounded-lg motion-reduce:animate-none! [&>button:last-child]:hidden">
        {/* Replace only this dialog's small default close with a localized touch target. */}
        <div className="absolute right-2 top-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Закрыть сведения" title="Закрыть сведения"><X /></Button>
          </DialogClose>
        </div>
        <DialogHeader className="min-w-0 pr-10 text-left">
          <DialogTitle className="tracking-normal">Сведения об источнике</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{sources[track.source] ?? "Неизвестный источник"}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="font-semibold">{track.title}</p>
          <p className="text-sm text-muted-foreground">{track.artist || "Исполнитель не указан"}</p>
        </div>
        {failed && (
          <Alert variant="destructive" className="min-w-0 [overflow-wrap:anywhere]">
            <AlertTitle className="tracking-normal">Ошибка загрузки</AlertTitle>
            <AlertDescription>
              <p>{feedback.description}</p>
              {feedback.code && <p className="mt-2 font-mono text-xs">Код: <code>{feedback.code}</code></p>}
            </AlertDescription>
          </Alert>
        )}
        <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm [overflow-wrap:anywhere]">
          <dt className="text-muted-foreground">Версия записи</dt><dd>{recordingTypeLabel}</dd>
          <dt className="text-muted-foreground">Длительность в каталоге</dt><dd>{track.duration > 0 ? formatDuration(track.duration) : "Неизвестна"}</dd>
          <dt className="text-muted-foreground">Метки источника</dt><dd>{quality}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">Качество исходного файла не подтверждено.</p>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {failed && (
            <Button type="button" className="min-h-11" onClick={() => { setOpen(false); void onRetry(); }}>
              <RotateCcw data-icon="inline-start" />Повторить загрузку
            </Button>
          )}
          {searchable ? (
            <Button variant="outline" className="min-h-11" asChild>
              <Link href={href} onClick={() => setOpen(false)}><Search data-icon="inline-start" />Другой источник</Link>
            </Button>
          ) : (
            <Button variant="outline" className="min-h-11" disabled><Search data-icon="inline-start" />Другой источник</Button>
          )}
        </div>
        {!searchable && <p className="text-sm text-muted-foreground">Недостаточно данных для поиска другой записи.</p>}
      </DialogContent>
    </Dialog>
  );
}
