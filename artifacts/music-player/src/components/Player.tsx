import { usePlayer } from "@/hooks/use-player";
import { formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Volume1,
  Music, Loader2, ScrollText, ListMusic,
  Shuffle, Repeat, Repeat1,
} from "lucide-react";
import { useState, useEffect } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Link } from "wouter";
import { LyricsPanel } from "./LyricsPanel";

const controlClassName = "flex h-10 w-10 shrink-0 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ddbd4] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-30";
const iconControlClassName = `${controlClassName} rounded-md hover:bg-white/5 hover:text-[#f5f3ff]`;

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
    repeatMode, shuffleEnabled, cycleRepeatMode, toggleShuffle,
  } = usePlayer();

  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    if (!currentTrack) setLyricsOpen(false);
  }, [currentTrack]);

  const hasNext = queueIndex < queue.length - 1 || (repeatMode === "all" && queue.length > 0);
  const hasPrev = queueIndex > 0 || progress > 3;
  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (progress / duration) * 100)) : 0;

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const repeatLabel = repeatMode === "off" ? "Повтор: выключен" : repeatMode === "all" ? "Повтор: все треки" : "Повтор: один трек";

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#111217] text-[#f5f3ff]">
      <div className="grid h-[120px] grid-cols-[minmax(0,1fr)_40px] grid-rows-[40px_40px_32px] items-center gap-x-2 px-3 py-1 md:h-[88px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] md:grid-rows-1 md:gap-x-3 md:px-4 md:py-2">

        {/* Track info */}
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 md:gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[#09090b] md:h-12 md:w-12">
            {currentTrack?.thumbnailUrl ? (
              <img src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-5 h-5 text-[#aaa9ba]" />
              </div>
            )}
            {isLoading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-[#8ddbd4] motion-safe:animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            {currentTrack ? (
              <>
                <h4 className="truncate text-sm font-semibold tracking-normal">{currentTrack.title}</h4>
                <p className="truncate text-xs text-[#aaa9ba]">{currentTrack.artist}</p>
              </>
            ) : (
              <p className="truncate text-xs text-[#aaa9ba]">Ничего не играет</p>
            )}
          </div>
        </div>

        {/* Center: controls + seek */}
        <div className="contents md:col-start-2 md:row-start-1 md:flex md:w-full md:max-w-[480px] md:min-w-0 md:flex-col md:items-center md:justify-self-center">
          {/* Buttons */}
          <div className="col-span-2 row-start-2 flex shrink-0 items-center justify-center gap-1 md:gap-2">
            <button
              type="button"
              onClick={toggleShuffle}
              onKeyDown={keepSpaceOnButton}
              aria-label={shuffleEnabled ? "Не перемешивать" : "Перемешать"}
              aria-pressed={shuffleEnabled}
              title={shuffleEnabled ? "Не перемешивать" : "Перемешать"}
              className={`${iconControlClassName} ${shuffleEnabled ? "text-[#8ddbd4]" : "text-[#aaa9ba]"}`}
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={playPrev}
              onKeyDown={keepSpaceOnButton}
              disabled={!hasPrev || !currentTrack}
              aria-label="Предыдущий"
              className={`${iconControlClassName} text-[#aaa9ba]`}
              title="Предыдущий"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              onKeyDown={keepSpaceOnButton}
              disabled={isLoading || !currentTrack}
              aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
              className={`${controlClassName} rounded-full bg-[#8ddbd4] text-[#09090b] hover:bg-[#8ddbd4]/90`}
              title={isPlaying ? "Пауза" : "Воспроизвести"}
            >
              {isLoading ? <Loader2 className="w-5 h-5 motion-safe:animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={playNext}
              onKeyDown={keepSpaceOnButton}
              disabled={!hasNext || !currentTrack}
              aria-label="Следующий"
              className={`${iconControlClassName} text-[#aaa9ba]`}
              title="Следующий"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
            <button
              type="button"
              onClick={cycleRepeatMode}
              onKeyDown={keepSpaceOnButton}
              aria-label={repeatLabel}
              aria-pressed={repeatMode !== "off"}
              title={repeatLabel}
              className={`${iconControlClassName} ${repeatMode !== "off" ? "text-[#8ddbd4]" : "text-[#aaa9ba]"}`}
            >
              {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            </button>
          </div>

          {/* Seek bar + time */}
          <div className="col-span-2 row-start-3 flex w-full min-w-0 items-center gap-2">
            <span className="w-10 shrink-0 whitespace-nowrap text-right font-mono text-[10px] tabular-nums text-[#aaa9ba]">{formatDuration(progress)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={Number(progressPct.toFixed(1))}
              onChange={(event) => seekTo(Number(event.currentTarget.value))}
              disabled={!currentTrack || duration <= 0}
              aria-label="Позиция воспроизведения"
              aria-valuetext={`${formatDuration(progress)} из ${formatDuration(duration)}`}
              className="player-seek h-8 min-w-0 flex-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ddbd4] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ "--seek-progress": `${progressPct}%` } as CSSProperties}
            />
            <span className="w-10 shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-[#aaa9ba]">{formatDuration(duration || currentTrack?.duration || 0)}</span>
          </div>
        </div>

        {/* Right: lyrics, desktop queue + volume */}
        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-1 md:col-start-3">
          <button
            type="button"
            onClick={() => setLyricsOpen(true)}
            onKeyDown={keepSpaceOnButton}
            disabled={!currentTrack}
            aria-label="Текст песни"
            title="Текст песни"
            aria-haspopup="dialog"
            aria-expanded={lyricsOpen}
            className={`${iconControlClassName} text-[#aaa9ba]`}
          >
            <ScrollText className="h-4 w-4" />
          </button>
          <div className="hidden items-center gap-1 md:flex">
            <Link
              href="/queue"
              aria-label="Очередь"
              title="Очередь"
              className={`${iconControlClassName} text-[#aaa9ba]`}
            >
              <ListMusic className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
              onKeyDown={keepSpaceOnButton}
              aria-label={volume === 0 ? "Включить звук" : "Выключить звук"}
              className={`${iconControlClassName} text-[#aaa9ba]`}
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
              onChange={(event) => setVolume(Number(event.currentTarget.value))}
              aria-label="Громкость"
              aria-valuetext={`${Math.round(volume * 100)}%`}
              className="h-10 w-20 shrink-0 cursor-pointer accent-[#8ddbd4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ddbd4] lg:w-24"
              title="Громкость"
            />
          </div>
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
