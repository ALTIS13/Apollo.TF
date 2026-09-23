export function insertNext<T>(queue: readonly T[], currentIndex: number, item: T): T[] {
  const at = Math.max(0, Math.min(queue.length, currentIndex + 1));
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

export function moveUpcoming<T>(
  queue: readonly T[],
  currentIndex: number,
  from: number,
  to: number,
): T[] | readonly T[] {
  const firstUpcoming = Math.max(0, currentIndex + 1);
  if (
    from < firstUpcoming || to < firstUpcoming ||
    from >= queue.length || to >= queue.length || from === to
  ) return queue;
  const updated = [...queue];
  const [item] = updated.splice(from, 1);
  updated.splice(to, 0, item);
  return updated;
}

export function clearUpcoming<T>(
  queue: readonly T[],
  currentIndex: number,
  hasCurrentTrack: boolean,
): T[] | readonly T[] {
  if (!hasCurrentTrack) return [];
  if (currentIndex < 0 || currentIndex >= queue.length) return queue;
  return queue.slice(0, currentIndex + 1);
}

export type RepeatMode = "off" | "all" | "one";

export function getNextQueueIndex(
  length: number,
  currentIndex: number,
  repeatMode: RepeatMode,
  reason: "ended" | "next",
): number | null {
  if (length === 0 || currentIndex < 0 || currentIndex >= length) return null;
  if (reason === "ended" && repeatMode === "one") return currentIndex;
  if (currentIndex + 1 < length) return currentIndex + 1;
  return repeatMode === "all" ? 0 : null;
}

export function shuffleUpcomingIds(
  ids: readonly number[],
  currentIndex: number,
  random: () => number = Math.random,
): number[] {
  const shuffled = [...ids];
  const first = Math.max(0, currentIndex + 1);
  for (let i = shuffled.length - 1; i > first; i--) {
    const j = first + Math.floor(random() * (i - first + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function reorderUpcoming<T>(
  queue: readonly T[],
  ids: readonly number[],
  currentIndex: number,
  orderedIds: readonly number[],
): { queue: T[]; ids: number[] } {
  if (queue.length !== ids.length || ids.length !== orderedIds.length) throw new Error("Queue identity mismatch");
  const first = Math.max(0, currentIndex + 1);
  const upcoming = new Map(ids.slice(first).map((id, offset) => [id, queue[first + offset]] as const));
  if (upcoming.size !== ids.length - first || orderedIds.slice(0, first).some((id, index) => id !== ids[index])) {
    throw new Error("Queue identity mismatch");
  }
  const next = orderedIds.slice(first).map((id) => {
    if (!upcoming.has(id)) throw new Error("Queue identity mismatch");
    const item = upcoming.get(id)!;
    upcoming.delete(id);
    return item;
  });
  if (upcoming.size) throw new Error("Queue identity mismatch");
  return { queue: [...queue.slice(0, first), ...next], ids: [...orderedIds] };
}
