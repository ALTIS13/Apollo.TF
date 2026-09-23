import { usePlayer } from "@/hooks/use-player";
import { formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Volume1,
  Music, Loader2, ScrollText,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { LyricsPanel } from "./LyricsPanel";

function keepSpaceOnButton(event: KeyboardEvent<HTMLButtonElement>) {
  // Preserve native activation instead of invoking the global playback shortcut.
  if (event.code === "Space" || event.key === " ") event.stopPropagation();
}

export function Player() {
  const {
    currentTrack, isPlaying, isLoading,
    progress, duration, volume,
    togglePlayPause, seekTo, setVolume,
    playNext, playPrev,
    queue, queueIndex,
  } = usePlayer();

  const seekBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    if (!currentTrack) setLyricsOpen(false);
  }, [currentTrack]);

  const hasNext = queueIndex < queue.length - 1;
  const hasPrev = queueIndex > 0 || progress > 3;
  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  const computeSeekPct = (e: MouseEvent | React.MouseEvent) => {
    if (!seekBarRef.current) return 0;
    const rect = seekBarRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  };

  const handleSeekDown = (e: React.MouseEvent) => {
    seekTo(computeSeekPct(e));
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => seekTo(computeSeekPct(e));
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging, seekTo]);

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="border-t border-white/5 bg-black/80 backdrop-blur-xl flex-shrink-0">
      <div className="grid h-[90px] grid-cols-[minmax(0,1fr)_auto_auto] grid-rows-[minmax(0,1fr)_20px] items-center gap-x-2 px-2 pb-2 sm:flex sm:gap-4 sm:px-4 sm:pb-0">

        {/* Track info */}
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 sm:flex-none sm:w-[28%] sm:min-w-[140px] sm:gap-3">
          <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg bg-secondary shadow sm:h-12 sm:w-12">
            {currentTrack?.thumbnailUrl ? (
              <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-secondary/80">
                <Music className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            {isLoading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            {currentTrack ? (
              <>
                <h4 className="text-sm font-semibold text-foreground truncate">{currentTrack.title}</h4>
                <p className="text-xs text-muted-foreground truncate">{currentTrack.artist}</p>
              </>
            ) : (
              <p className="truncate text-xs text-muted-foreground"><span className="sm:hidden">Не играет</span><span className="hidden sm:inline">Ничего не играет</span></p>
            )}
          </div>
        </div>

        {/* Center: controls + seek */}
        <div className="contents sm:mx-auto sm:flex sm:max-w-[400px] sm:min-w-[120px] sm:flex-1 sm:flex-col sm:items-center sm:gap-1.5">
          {/* Buttons */}
          <div className="col-start-2 row-start-1 flex items-center gap-2 sm:gap-5">
            <button
              onClick={playPrev}
              onKeyDown={keepSpaceOnButton}
              disabled={!hasPrev || !currentTrack}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              title="Предыдущий"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={togglePlayPause}
              onKeyDown={keepSpaceOnButton}
              disabled={isLoading || !currentTrack}
              className="w-10 h-10 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 active:scale-95 transition-all disabled:opacity-40 shadow-lg"
              title={isPlaying ? "Пауза" : "Воспроизвести"}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>
            <button
              onClick={playNext}
              onKeyDown={keepSpaceOnButton}
              disabled={!hasNext || !currentTrack}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              title="Следующий"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
          </div>

          {/* Seek bar + time */}
          <div className="col-span-3 row-start-2 flex w-full items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{formatDuration(progress)}</span>
            <div
              ref={seekBarRef}
              className="flex-1 h-1 bg-white/15 rounded-full cursor-pointer group relative"
              onMouseDown={handleSeekDown}
            >
              <div
                className="absolute top-0 left-0 h-full bg-white rounded-full group-hover:bg-primary transition-colors"
                style={{ width: `${progressPct}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ left: `${progressPct}%`, transform: "translate(-50%, -50%)" }}
              />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground w-8">{formatDuration(duration || currentTrack?.duration || 0)}</span>
          </div>
        </div>

        {/* Right: volume */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-2 sm:w-[28%] sm:min-w-[100px]">
          <button
            type="button"
            onClick={() => setLyricsOpen(true)}
            onKeyDown={keepSpaceOnButton}
            disabled={!currentTrack}
            aria-label="Текст песни"
            title="Текст песни"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
          >
            <ScrollText className="h-4 w-4" />
          </button>
          <button
            onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
            onKeyDown={keepSpaceOnButton}
            className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block"
            title={volume === 0 ? "Включить звук" : "Выключить звук"}
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 h-1 accent-white cursor-pointer hidden sm:block"
            title="Громкость"
          />
        </div>

      </div>
      {currentTrack && lyricsOpen && (
        <LyricsPanel
          track={currentTrack}
          progress={progress}
          duration={duration}
          seekTo={seekTo}
          open={lyricsOpen}
          onOpenChange={setLyricsOpen}
        />
      )}
    </div>
  );
}
