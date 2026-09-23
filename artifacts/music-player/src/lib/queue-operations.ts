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
