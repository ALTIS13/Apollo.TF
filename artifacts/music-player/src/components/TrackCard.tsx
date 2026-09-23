import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Play,
  Pause,
  Download,
  Music,
  Loader2,
  ListPlus,
  ListStart,
  X,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { usePlayer } from "@/hooks/use-player";
import type { TrackResult } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { motion, useReducedMotion } from "framer-motion";
import { useTrackDownload } from "@/hooks/use-track-download";

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
  const { state: downloadState, progress, start, cancel } = useTrackDownload();
  const previousDownloadStateRef = useRef(downloadState);

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
        description: "Не удалось начать загрузку.",
        variant: "destructive",
      });
    } else if (downloadState === "canceled") {
      toast({ title: "Загрузка отменена", description: track.title });
    }
  }, [downloadState, toast, track.title]);

  const isDownloadPending =
    downloadState === "waiting" || downloadState === "active";
  const downloadStatus =
    downloadState === "active"
      ? `Загрузка ${progress}%`
      : "Подготовка загрузки";
  const terminalDownloadStatus =
    downloadState === "failed"
      ? "Не удалось начать загрузку."
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

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, delay: reduceMotion ? 0 : index * 0.05 }}
      className={`
        group border border-white/5 bg-card/60 hover:bg-card/90 hover:border-white/10
        ${compact ? "grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 rounded-lg p-3 lg:grid-cols-[64px_minmax(0,1fr)_auto]" : "glass-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 hover:-translate-y-1"}
        ${isCurrentTrack ? "ring-2 ring-primary/50 bg-card/90" : ""}
      `}
    >
      {/* Thumbnail + Play Overlay */}
      <button
        type="button"
        aria-label={`${isThisPlaying ? "Пауза" : "Воспроизвести"}: ${track.title}`}
        className={`relative overflow-hidden bg-secondary flex-shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${compact ? "h-14 w-14 rounded-md lg:h-16 lg:w-16" : "w-full sm:w-20 h-48 sm:h-20 rounded-xl shadow-lg group-hover:shadow-primary/10 transition-all"}`}
        onClick={handlePlayClick}
      >
        {track.thumbnailUrl ? (
          <img
            src={track.thumbnailUrl}
            alt={track.title}
            className={`w-full h-full object-cover transition-transform duration-500 ${isThisPlaying ? "scale-110" : "group-hover:scale-105"}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/80">
            <Music className="w-8 h-8 text-muted-foreground/50" />
          </div>
        )}
        <div
          className={`absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px] transition-opacity duration-300 ${isCurrentTrack || isThisLoading ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <div
            className={`w-12 h-12 sm:w-10 sm:h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transform transition-transform duration-200 ${isCurrentTrack ? "scale-100" : "scale-90 group-hover:scale-100"}`}
          >
            {isThisLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
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
            <h3 className={`${compact ? "text-sm font-semibold tracking-normal" : "text-lg font-bold"} text-foreground truncate group-hover:text-primary transition-colors`}>
              {track.title}
            </h3>
            <p className={`${compact ? "text-xs" : ""} text-muted-foreground flex items-center gap-2 mt-1`}>
              <span className="truncate">{track.artist}</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30 inline-block" />
              <span className="shrink-0 font-mono text-xs tracking-normal">
                {formatDuration(track.duration)}
              </span>
            </p>
          </div>
          <div className={`flex gap-2 flex-shrink-0 ${compact ? "flex-wrap items-center" : "flex-col items-end"}`}>
            <Badge
              variant={getVariant(track.type)}
              className={compact ? "capitalize px-2 py-0 text-[10px]" : "capitalize px-3 py-1"}
            >
              {track.type}
            </Badge>
            <Badge
              variant={getSourceVariant(track.source)}
              className="uppercase text-[10px] tracking-wider px-2"
            >
              {track.source}
            </Badge>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className={compact ? "col-span-2 flex min-w-0 items-center justify-end gap-2 border-t border-white/10 pt-2 lg:col-span-1 lg:border-t-0 lg:pt-0" : "flex-shrink-0 w-full sm:w-auto flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 border-t sm:border-t-0 sm:border-l border-white/10 pt-4 sm:pt-0 sm:pl-6"}>
        {collectionAction}
        <button
          type="button"
          onClick={handlePlayNext}
          aria-label={`Играть следующим: ${track.title}`}
          title="Играть следующим"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-secondary/50 text-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-white"
        >
          <ListStart className="h-4 w-4" />
        </button>
        <button
          onClick={handleAddToQueue}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
            queueAdded
              ? "bg-primary/20 text-primary border-primary/30"
              : "bg-secondary/50 text-foreground hover:bg-secondary border-white/5 hover:text-primary"
          }`}
          title="Добавить в очередь"
        >
          <ListPlus className="w-4 h-4" />
          <span className="sm:hidden">
            {queueAdded ? "✓ В очереди" : "В очередь"}
          </span>
          <span className="hidden sm:inline">{queueAdded ? "✓" : "+"}</span>
        </button>

        <div
          data-testid="track-download-action"
          className={`h-12 min-w-0 ${compact ? "w-28 shrink-0" : "w-full sm:w-28"}`}
        >
          {isDownloadPending ? (
            <div className="flex h-12 w-full items-center justify-between rounded-xl border border-white/5 bg-secondary/50 px-3 text-xs text-muted-foreground">
              <span aria-label="Загрузка" title="Загрузка">
                <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
              </span>
              <span
                className="min-w-0 flex-1 truncate px-2 text-center"
                role="status"
              >
                {downloadStatus}
              </span>
              <button
                aria-label="Отменить загрузку"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-background/50 hover:text-primary"
                onClick={() => void cancel()}
                title="Отменить загрузку"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex h-12 w-full flex-col">
              <button
                aria-label="Скачать"
                className="group/dl flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-secondary/50 px-4 text-foreground transition-all hover:bg-secondary hover:text-primary hover:shadow-lg disabled:opacity-50"
                disabled={downloadState === "completed"}
                onClick={() => void start(track)}
                title="Скачать"
                type="button"
              >
                <Download className="h-5 w-5 flex-shrink-0 transition-transform group-hover/dl:-translate-y-0.5" />
                <span className="font-medium sm:hidden">Скачать</span>
              </button>
              <span
                aria-hidden={terminalDownloadStatus === null}
                className={`h-4 w-full truncate text-center text-[10px] leading-4 ${downloadState === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                role={terminalDownloadStatus === null ? undefined : "status"}
              >
                {terminalDownloadStatus}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
