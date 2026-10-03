import type { MoveLikedTrackRequest } from "@workspace/api-client-react";

type ReorderPlan =
  | { type: "move"; request: MoveLikedTrackRequest }
  | { type: "load_more" }
  | { type: "unchanged" };

export function planLikedReorder(
  current: readonly string[],
  proposed: readonly string[],
  trackId: string,
  hasNextPage: boolean,
  expectedRevision: string | undefined,
): ReorderPlan {
  if (!expectedRevision || current.length !== proposed.length ||
      current.every((id, index) => id === proposed[index]))
    return { type: "unchanged" };

  const withoutMoved = (ids: readonly string[]) => ids.filter((id) => id !== trackId);
  const currentRemainder = withoutMoved(current);
  const proposedRemainder = withoutMoved(proposed);
  if (current.filter((id) => id === trackId).length !== 1 ||
      proposed.filter((id) => id === trackId).length !== 1 ||
      currentRemainder.some((id, index) => id !== proposedRemainder[index]))
    return { type: "unchanged" };

  const nextIndex = proposed.indexOf(trackId);
  if (hasNextPage && nextIndex === proposed.length - 1)
    return { type: "load_more" };

  return {
    type: "move",
    request: {
      trackId,
      beforeTrackId: proposed[nextIndex + 1] ?? null,
      expectedRevision,
    },
  };
}
