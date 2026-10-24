import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPlaylistTrack,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  removePlaylist,
  removePlaylistTrack,
  reorderPlaylistTracks,
  type AddPlaylistTrackRequest,
  type Playlist,
  type PlaylistTrack,
} from "@workspace/api-client-react";
import { useCollectionAccess } from "@/hooks/use-liked-collection";
import { tfRequestInit } from "@/lib/tf-session-client";

export type PlaylistSummary = Playlist;
export type { PlaylistTrack };
export type PlaylistTrackInput = AddPlaylistTrackRequest;

export const playlistsKey = (accountId: string | null) => ["tf", "playlists", accountId] as const;
export const playlistKey = (accountId: string | null, playlistId: number) => [...playlistsKey(accountId), playlistId] as const;

export function usePlaylists(enabled = true) {
  const access = useCollectionAccess();
  return useQuery({
    queryKey: playlistsKey(access.accountId),
    enabled: access.allowed && enabled,
    queryFn: ({ signal }) => access.request(() => listPlaylists(tfRequestInit({ signal }))),
    staleTime: 30_000,
    retry: false,
  });
}

export function usePlaylist(playlistId: number | null) {
  const access = useCollectionAccess();
  return useQuery({
    queryKey: playlistKey(access.accountId, playlistId ?? 0),
    enabled: access.allowed && playlistId !== null,
    queryFn: ({ signal }) => access.request(() => getPlaylist(playlistId!, tfRequestInit({ signal }))),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreatePlaylist() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => access.request(() => createPlaylist(
      { name: name.trim() }, tfRequestInit({ method: "POST" }),
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
      addPlaylistTrack(playlistId, track, tfRequestInit({ method: "POST" })),
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
      removePlaylistTrack(playlistId, trackId, tfRequestInit({ method: "DELETE" })),
    ),
    onSuccess: (_, { playlistId }) => client.invalidateQueries({ queryKey: playlistKey(access.accountId, playlistId) }),
    onSettled: () => client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true }),
    retry: false,
  });
}

export function useReorderPlaylistTracks() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackIds }: { playlistId: number; trackIds: string[] }) => access.request(() =>
      reorderPlaylistTracks(playlistId, { trackIds }, tfRequestInit({ method: "PATCH" })),
    ),
    onSuccess: (detail, { playlistId }) => {
      client.setQueryData(playlistKey(access.accountId, playlistId), detail);
      return client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true });
    },
    retry: false,
  });
}

export function useDeletePlaylist() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (playlistId: number) => access.request(() =>
      removePlaylist(playlistId, tfRequestInit({ method: "DELETE" })),
    ),
    onSuccess: (_, playlistId) => {
      client.removeQueries({ queryKey: playlistKey(access.accountId, playlistId) });
      return client.invalidateQueries({ queryKey: playlistsKey(access.accountId), exact: true });
    },
    retry: false,
  });
}
