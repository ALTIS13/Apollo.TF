export interface LikedOrderRow {
  readonly storageId: number;
  readonly trackId: string;
  readonly sortPosition: string;
}

export class LikedTrackNotFound extends Error {
  readonly code = "liked_track_not_found";
  constructor() {
    super("liked_track_not_found");
  }
}

export class LikedOrderConflict extends Error {
  readonly code = "liked_order_conflict";
  constructor(readonly revision: string) {
    super("liked_order_conflict");
  }
}

export function moveLikedBefore<T extends LikedOrderRow>(
  rows: readonly T[],
  trackId: string,
  beforeTrackId: string | null,
): { storageId: number; sortPosition: string }[] {
  const sourceIndex = rows.findIndex((row) => row.trackId === trackId);
  if (sourceIndex < 0 || (beforeTrackId !== null &&
    !rows.some((row) => row.trackId === beforeTrackId))) {
    throw new LikedTrackNotFound();
  }
  const reordered = [...rows];
  const [source] = reordered.splice(sourceIndex, 1);
  const targetIndex = beforeTrackId === null
    ? reordered.length
    : reordered.findIndex((row) => row.trackId === beforeTrackId);
  reordered.splice(targetIndex, 0, source!);
  return reordered.flatMap((row, index) =>
    row.storageId === rows[index]?.storageId
      ? []
      : [{ storageId: row.storageId, sortPosition: rows[index]!.sortPosition }],
  );
}
