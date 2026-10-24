import type { TrackResult } from "@workspace/api-client-react";
import { SaveLikedTrackButton } from "@/components/LikedCollection";
import { PlaylistAction } from "@/components/PlaylistAction";

export function CollectionActions({ track, saved, checking = false }: {
  track: TrackResult;
  saved: boolean;
  checking?: boolean;
}) {
  return <div className="flex items-center gap-1">
    <SaveLikedTrackButton track={track} saved={saved} checking={checking} />
    <PlaylistAction track={track} />
  </div>;
}
