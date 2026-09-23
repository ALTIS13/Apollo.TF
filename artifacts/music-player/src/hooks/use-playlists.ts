import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddPlaylistTrackRequest, Playlist, PlaylistDetailResponse, PlaylistListResponse, PlaylistTrack, PlaylistTrackMutationResponse } from "@workspace/api-client-react";
import { useCollectionAccess } from "@/hooks/use-liked-collection";
import { tfFetch } from "@/lib/tf-session-client";

export type PlaylistSummary = Playlist;
export type { PlaylistTrack };
export type PlaylistTrackInput = AddPlaylistTrackRequest;

export const playlistsKey = (accountId: string | null) => ["tf", "playlists", accountId] as const;
export const playlistKey = (accountId: string | null, playlistId: number) => [...playlistsKey(accountId), playlistId] as const;

const jsonRequest = (method: "POST" | "DELETE", body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
});

export function usePlaylists(enabled = true) {
  const access = useCollectionAccess();
  return useQuery({
    queryKey: playlistsKey(access.accountId),
    enabled: access.allowed && enabled,
    queryFn: ({ signal }) => access.request(() => tfFetch<PlaylistListResponse>(
      "/collections/playlists", { signal },
    )),
    staleTime: 30_000,
    retry: false,
  });
}

export function usePlaylist(playlistId: number | null) {
  const access = useCollectionAccess();
  return useQuery({
    queryKey: playlistKey(access.accountId, playlistId ?? 0),
    enabled: access.allowed && playlistId !== null,
    queryFn: ({ signal }) => access.request(() => tfFetch<PlaylistDetailResponse>(
      `/collections/playlists/${playlistId}`, { signal },
    )),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreatePlaylist() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => access.request(() => tfFetch<{ playlist: Playlist }>(
      "/collections/playlists", jsonRequest("POST", { name: name.trim() }),
    )),
    onSuccess: () => client.invalidateQueries({ queryKey: playlistsKey(access.accountId) }),
    retry: false,
  });
}

export function useAddPlaylistTrack() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, track }: { playlistId: number; track: PlaylistTrackInput }) => access.request(() =>
      tfFetch<PlaylistTrackMutationResponse>(
        `/collections/playlists/${playlistId}/tracks`, jsonRequest("POST", track),
      ),
    ),
    onSuccess: (_, { playlistId }) => client.invalidateQueries({ queryKey: playlistKey(access.accountId, playlistId) }),
    onSettled: () => client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true }),
    retry: false,
  });
}

export function useRemovePlaylistTrack() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: string }) => access.request(() =>
      tfFetch<void>(`/collections/playlists/${playlistId}/tracks/${encodeURIComponent(trackId)}`, jsonRequest("DELETE")),
    ),
    onSuccess: (_, { playlistId }) => client.invalidateQueries({ queryKey: playlistKey(access.accountId, playlistId) }),
    onSettled: () => client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true }),
    retry: false,
  });
}

export function useDeletePlaylist() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (playlistId: number) => access.request(() =>
      tfFetch<void>(`/collections/playlists/${playlistId}`, jsonRequest("DELETE")),
    ),
    onSuccess: (_, playlistId) => {
      client.removeQueries({ queryKey: playlistKey(access.accountId, playlistId) });
      return client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true });
    },
    retry: false,
  });
}
