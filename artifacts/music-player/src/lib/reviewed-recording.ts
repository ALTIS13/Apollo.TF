const reviewedIdPattern = /^rv_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})_(0|[1-9][0-9]?|1[0-9]{2})_([0-9a-f]{64})$/;

export function parseReviewedTrackId(id: string) {
  const match = reviewedIdPattern.exec(id);
  if (!match || match[0] !== id) return null;
  return { draftId: match[1], position: Number(match[2]), revision: match[3] };
}

export function reviewedTrackId(draftId: string, position: number, revision: string): string | null {
  const id = `rv_${draftId}_${position}_${revision}`;
  return parseReviewedTrackId(id) ? id : null;
}

export function reviewedMediaPath(id: string, kind: "audio" | "file"): string | null {
  const binding = parseReviewedTrackId(id);
  return binding ? `/collections/imports/${binding.draftId}/entries/${binding.position}/${kind}/${binding.revision}` : null;
}

// Treat malformed or mislabeled private IDs as reviewed, so they cannot reach generic routes.
export function isReviewedTrack(track: { id?: unknown; source?: unknown }): boolean {
  return track.source === "reviewed" || (typeof track.id === "string" && track.id.startsWith("rv_"));
}
