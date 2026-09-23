import { usePlayer } from "@/hooks/use-player";
import { formatDuration } from "@/lib/utils";
import { Music2, ListMusic, X, Play, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { KeyboardEvent } from "react";

function keepSpaceOnButton(event: KeyboardEvent<HTMLButtonElement>) {
  // Keep native activation from being intercepted by the global player shortcut.
  if (event.code === "Space" || event.key === " ") event.stopPropagation();
}

export default function Queue() {
  const { queue, queueIndex, currentTrack, playFromQueue, moveQueuedTrack, removeFromQueue, clearQueue } = usePlayer();
  const firstUpcoming = currentTrack ? queueIndex + 1 : 0;
  const upcomingCount = Math.max(0, queue.length - firstUpcoming);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center">
            <ListMusic className="w-5 h-5 text-white/60" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Очередь</h1>
            <p className="text-white/40 text-sm">{queue.length} {queue.length === 1 ? "трек" : queue.length < 5 ? "трека" : "треков"}</p>
          </div>
        </div>
        {upcomingCount > 0 && (
          <button
            type="button"
            onClick={clearQueue}
            onKeyDown={keepSpaceOnButton}
            aria-label="Очистить следующие"
            title="Очистить следующие"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-all text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Очистить следующие</span>
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-24"
        >
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-5">
            <ListMusic className="w-10 h-10 text-white/20" />
          </div>
          <h2 className="text-xl font-semibold text-white/50 mb-2">Очередь пуста</h2>
          <p className="text-white/25 text-sm max-w-xs mx-auto">
            Следующие треки появятся здесь.
          </p>
        </motion.div>
      ) : (
        <div className="space-y-1">
          <AnimatePresence>
            {queue.map((track, i) => {
              const isCurrent = i === queueIndex && currentTrack?.id === track.id;
              return (
                <motion.div
                  key={`${track.id}-${i}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12, height: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`group grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-3 rounded-xl transition-all sm:flex sm:items-center sm:gap-3 ${
                    isCurrent ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playFromQueue(i)}
                    onKeyDown={keepSpaceOnButton}
                    aria-label={`Воспроизвести ${track.title}`}
                    className="col-span-2 flex min-w-0 items-center gap-3 text-left rounded-lg cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 sm:flex-1"
                  >
                    <span className={`w-6 text-center text-xs shrink-0 ${isCurrent ? "text-primary" : "text-white/25"}`}>
                      {isCurrent ? <Play className="w-3 h-3 fill-current inline" /> : i + 1}
                    </span>

                    <span className="w-10 h-10 rounded-lg overflow-hidden bg-white/8 flex-shrink-0">
                      {track.thumbnailUrl ? (
                        <img src={track.thumbnailUrl} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center">
                          <Music2 className="w-4 h-4 text-white/25" />
                        </span>
                      )}
                    </span>

                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm font-medium truncate ${isCurrent ? "text-white" : "text-white/80"}`}>
                        {track.title}
                      </span>
                      <span className="block text-xs text-white/40 truncate">{track.artist}</span>
                    </span>

                    <span className="text-xs text-white/25 font-mono shrink-0 hidden sm:block">
                      {formatDuration(track.duration)}
                    </span>
                  </button>

                  {i >= firstUpcoming && (
                    <div className="col-start-1 flex shrink-0 items-center justify-self-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveQueuedTrack(i, i - 1)}
                        onKeyDown={keepSpaceOnButton}
                        disabled={i === firstUpcoming}
                        aria-label={`Переместить ${track.title} выше`}
                        title="Выше"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-white"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveQueuedTrack(i, i + 1)}
                        onKeyDown={keepSpaceOnButton}
                        disabled={i === queue.length - 1}
                        aria-label={`Переместить ${track.title} ниже`}
                        title="Ниже"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-white"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => removeFromQueue(i)}
                    onKeyDown={keepSpaceOnButton}
                    aria-label={`Удалить ${track.title} из очереди`}
                    className="col-start-2 opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-white/30 hover:text-red-400 transition-all shrink-0 w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                    title="Удалить из очереди"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
