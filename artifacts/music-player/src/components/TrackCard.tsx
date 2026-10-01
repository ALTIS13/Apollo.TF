import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Play,
  Pause,
  Download,
  Music,
  Loader2,
  ListPlus,
  ListStart,
  Check,
  X,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { usePlayer } from "@/hooks/use-player";
import type { TrackResult } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { motion, useReducedMotion } from "framer-motion";
import { useTrackDownload } from "@/hooks/use-track-download";
import { downloadFailureFeedback, TrackDetails } from "@/components/TrackDetails";

const actionClassName = "flex h-[44px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#09090b] transition-colors hover:bg-white/5 hover:text-[#8ddbd4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ddbd4] motion-reduce:transition-none";

interface TrackCardProps {
  track: TrackResult;
  index: number;
  collectionAction?: ReactNode;
  compact?: boolean;
}

export function TrackCard({ track, index, collectionAction, compact = false }: TrackCardProps) {
  const reduceMotion = useReducedMotion();
  const {
    currentTrack,
    isPlaying,
    playTrack,
    togglePlayPause,
    isLoading,
    addToQueue,
    addNextToQueue,
  } = usePlayer();
  const [queueAdded, setQueueAdded] = useState(false);
  const { toast } = useToast();
  const { state: downloadState, progress, failureCode, start, cancel } = useTrackDownload();
  const previousDownloadStateRef = useRef(downloadState);
  const failureFeedback = downloadFailureFeedback(failureCode);

  const isCurrentTrack = currentTrack?.id === track.id;
  const isThisLoading = isCurrentTrack && isLoading;
  const isThisPlaying = isCurrentTrack && isPlaying;

  const handlePlayClick = () => {
    if (isCurrentTrack) {
      togglePlayPause();
    } else {
      playTrack(track);
    }
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToQueue(track);
    setQueueAdded(true);
    setTimeout(() => setQueueAdded(false), 1500);
    toast({ title: "Добавлено в очередь", description: track.title });
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    addNextToQueue(track);
    toast({ title: "Следующий трек", description: track.title });
  };

  useEffect(() => {
    if (previousDownloadStateRef.current === downloadState) return;
    previousDownloadStateRef.current = downloadState;
    if (downloadState === "completed") {
      toast({
        title: "Загрузка завершена",
        description: track.title,
      });
    } else if (downloadState === "failed") {
      toast({
        title: "Ошибка загрузки",
        description: failureFeedback.description,
        variant: "destructive",
      });
    } else if (downloadState === "canceled") {
      toast({ title: "Загрузка отменена", description: track.title });
    }
  }, [downloadState, failureFeedback.description, toast, track.title]);

  const isDownloadPending =
    downloadState === "waiting" || downloadState === "active";
  const downloadStatus =
    downloadState === "active"
      ? `Загрузка ${progress}%`
      : "Подготовка загрузки";
  const terminalDownloadStatus =
    downloadState === "failed"
      ? failureFeedback.statusLabel
      : downloadState === "canceled"
        ? "Загрузка отменена"
        : downloadState === "completed"
          ? "Загрузка завершена"
          : null;

  type TypeVariant = "original" | "remix" | "live" | "cover" | "outline";
  type SourceVariant = "youtube" | "soundcloud" | "default";

  const getVariant = (type: string): TypeVariant => {
    const map: Record<string, TypeVariant> = {
      original: "original",
      remix: "remix",
      live: "live",
      cover: "cover",
    };
    return map[type] ?? "outline";
  };

  const getSourceVariant = (source: string): SourceVariant => {
    if (source === "youtube") return "youtube";
    if (source === "soundcloud") return "soundcloud";
    return "default";
  };

  const typeLabels: Record<string, string> = {
    original: "Оригинал",
    remix: "Ремикс",
    live: "Лайв",
    cover: "Кавер",
  };
  const bitrateLabels = track.quality.every((value) => /^\d+$/.test(value));
  const shownQuality = track.quality.slice(0, 3).join(", ");
  const remainingQuality = track.quality.length - 3;
  const qualityText = track.quality.length === 0
    ? "Битрейт не указан"
    : `${bitrateLabels ? "Метки битрейта" : "Метки источника"}: ${shownQuality}${bitrateLabels ? " кбит/с" : ""}${remainingQuality > 0 ? ` и ещё ${remainingQuality}` : ""} · файл не проверен`;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, delay: reduceMotion ? 0 : Math.min(index * 0.05, 0.2) }}
      className={`
        group border border-white/10 bg-[#111217] text-[#f5f3ff] transition-colors hover:border-white/20 motion-reduce:transition-none
        ${compact ? "grid grid-cols-[48px_minmax(0,1fr)] items-center gap-x-[8px] gap-y-2 rounded-lg p-[8px] lg:grid-cols-[48px_minmax(0,1fr)_auto]" : "rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 shadow-xl motion-safe:hover:-translate-y-1"}
        ${isCurrentTrack ? "ring-2 ring-[#8ddbd4]/50" : ""}
      `}
    >
      {/* Thumbnail + Play Overlay */}
      <button
        type="button"
        aria-label={`${isThisPlaying ? "Пауза" : "Воспроизвести"}: ${track.title}`}
        className={`relative overflow-hidden bg-[#09090b] flex-shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ddbd4] ${compact ? "h-[48px] w-[48px] rounded-md" : "w-full sm:w-20 h-48 sm:h-20 rounded-xl shadow-lg"}`}
        onClick={handlePlayClick}
      >
        {track.thumbnailUrl ? (
          <img
            src={track.thumbnailUrl}
            alt={track.title}
            className={`w-full h-full object-cover motion-safe:transition-transform motion-safe:duration-500 ${isThisPlaying ? "motion-safe:scale-105" : "motion-safe:group-hover:scale-105"}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/80">
            <Music className="w-8 h-8 text-muted-foreground/50" />
          </div>
        )}
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/20"
        >
          <div
            className={`flex items-center justify-center rounded-full bg-[#8ddbd4] text-[#09090b] ${compact ? "h-[32px] w-[32px]" : "h-[44px] w-[44px]"}`}
          >
            {isThisLoading ? (
              <Loader2 className="w-5 h-5 motion-safe:animate-spin" />
            ) : isThisPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-1" />
            )}
          </div>
        </div>
      </button>

      {/* Info */}
      <div className="flex-grow min-w-0 w-full">
        <div className={`flex gap-2 ${compact ? "flex-col xl:flex-row xl:items-center xl:justify-between" : "items-start justify-between"}`}>
          <div className="min-w-0">
            <h3 className={`${compact ? "text-sm font-semibold tracking-normal" : "text-lg font-bold tracking-normal"} truncate`}>
              {track.title}
            </h3>
            <p className={`${compact ? "text-xs" : ""} text-[#aaa9ba] flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 mt-1`}>
              <span className="min-w-0 truncate">{track.artist}</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30 inline-block" />
              <span className="max-w-full font-mono text-[10px] tracking-normal">
                {track.duration > 0 ? formatDuration(track.duration) : "Длительность неизвестна"}
              </span>
            </p>
          </div>
          <div className={`flex gap-2 flex-shrink-0 ${compact ? "flex-wrap items-center" : "flex-col items-end"}`}>
            <Badge
              variant={getVariant(track.type)}
              className={compact ? "capitalize px-2 py-0 text-[10px]" : "capitalize px-3 py-1"}
            >
              {typeLabels[track.type] ?? track.type}
            </Badge>
            <Badge
              variant={getSourceVariant(track.source)}
              className="uppercase text-[10px] tracking-normal px-2"
            >
              {track.source}
            </Badge>
          </div>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-[#aaa9ba]">
          <span title="Поисковый рейтинг, не оценка качества записи">
            Рейтинг поиска: {track.score}
          </span>
          <span className="min-w-0 max-w-full [overflow-wrap:anywhere]" title={qualityText}>{qualityText}</span>
        </div>
      </div>

      {/* Actions */}
      <div className={compact ? "col-span-2 flex min-w-0 flex-wrap items-start justify-end gap-[2px] border-t border-white/10 pt-2 lg:col-span-1 lg:border-t-0 lg:pt-0" : "flex-shrink-0 w-full sm:w-auto flex flex-wrap sm:flex-col items-start sm:items-end justify-between sm:justify-center gap-2 border-t sm:border-t-0 sm:border-l border-white/10 pt-4 sm:pt-0 sm:pl-6"}>
        {collectionAction}
        <TrackDetails track={track} recordingTypeLabel={typeLabels[track.type] ?? track.type} downloadState={downloadState} failureCode={failureCode} onRetry={() => start(track)} />
        <button
          type="button"
          onClick={handlePlayNext}
          aria-label={`Играть следующим: ${track.title}`}
          title="Играть следующим"
          className={`${actionClassName} w-[44px] text-[#aaa9ba]`}
        >
          <ListStart className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleAddToQueue}
          aria-label={`Добавить в очередь: ${track.title}`}
          className={`${actionClassName} w-[44px] ${queueAdded ? "text-[#8ddbd4]" : "text-[#aaa9ba]"}`}
          title={queueAdded ? "Добавлено в очередь" : "Добавить в очередь"}
        >
          {queueAdded ? <Check className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />}
        </button>

        <div
          data-testid="track-download-action"
          className="grid h-[64px] w-[72px] shrink-0 grid-rows-[44px_20px]"
        >
          {isDownloadPending ? (
            <div className="flex h-[44px] w-full items-center justify-between gap-[4px] text-[#aaa9ba]">
              <span aria-label="Загрузка" title="Загрузка">
                <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" />
              </span>
              <button
                aria-label="Отменить загрузку"
                className={`${actionClassName} w-[44px] text-[#aaa9ba]`}
                onClick={() => void cancel()}
                title="Отменить загрузку"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              aria-label="Скачать"
              className={`${actionClassName} w-full text-[#aaa9ba] disabled:opacity-50`}
              disabled={downloadState === "completed"}
              onClick={() => void start(track)}
              title="Скачать"
              type="button"
            >
              <Download className="h-5 w-5 shrink-0" />
            </button>
          )}
          <span
            aria-hidden={!isDownloadPending && terminalDownloadStatus === null}
            aria-label={isDownloadPending ? downloadStatus : terminalDownloadStatus ?? undefined}
            title={isDownloadPending ? downloadStatus : terminalDownloadStatus ?? undefined}
            className={`h-[20px] w-full truncate text-center text-[10px] leading-[20px] ${downloadState === "failed" ? "text-destructive" : "text-[#aaa9ba]"}`}
            role={isDownloadPending || terminalDownloadStatus !== null ? "status" : undefined}
          >
            {isDownloadPending ? downloadState === "active" ? `${progress}%` : "Подготовка" : downloadState === "failed" ? failureFeedback.shortLabel : terminalDownloadStatus}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
