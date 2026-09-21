import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-config";
import {
  TfApiError,
  isCurrentTfSecurityGeneration,
  tfFetch,
} from "@/lib/tf-session-client";

function useSpotifyLibraryFetch() {
  const queryClient = useQueryClient();
  return async <T,>(path: string): Promise<T> => {
    try {
      return await tfFetch<T>(path);
    } catch (error) {
      if (
        error instanceof TfApiError && error.kind === "provider" &&
        error.generation !== undefined &&
        isCurrentTfSecurityGeneration(error.generation)
      ) {
        await queryClient.invalidateQueries({ queryKey: ["spotify", "status"] });
      }
      throw error;
    }
  };
}

function retrySpotifyLibrary(failureCount: number, error: Error): boolean {
  return !(error instanceof TfApiError && error.kind === "provider") &&
    failureCount < 1;
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  thumbnailUrl: string | null;
  spotifyUrl: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  thumbnailUrl: string | null;
  owner: string;
}

export interface SpotifyStatus {
  connected: boolean;
  displayName?: string;
  spotifyUserId?: string;
}

export function useSpotifyStatus(enabled = true) {
  return useQuery<SpotifyStatus>({
    queryKey: ["spotify", "status"],
    queryFn: () => tfFetch("/spotify/status"),
    enabled,
    retry: false,
  });
}

export function useSpotifyLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => tfFetch("/spotify/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spotify"] });
    },
  });
}

export function useSpotifyLiked(offset = 0, limit = 50) {
  const fetchLibrary = useSpotifyLibraryFetch();
  return useQuery<{ tracks: SpotifyTrack[]; total: number; offset: number; limit: number }>({
    queryKey: ["spotify", "liked", offset, limit],
    queryFn: () =>
      fetchLibrary(`/spotify/liked?offset=${offset}&limit=${limit}`),
    retry: retrySpotifyLibrary,
    enabled: false,
  });
}

export function useSpotifyPlaylists() {
  const fetchLibrary = useSpotifyLibraryFetch();
  return useQuery<{ playlists: SpotifyPlaylist[]; total: number }>({
    queryKey: ["spotify", "playlists"],
    queryFn: () => fetchLibrary("/spotify/playlists"),
    retry: retrySpotifyLibrary,
    enabled: false,
  });
}

export function useSpotifyPlaylistTracks(playlistId: string | null, offset = 0, limit = 50) {
  const fetchLibrary = useSpotifyLibraryFetch();
  return useQuery<{ tracks: SpotifyTrack[]; total: number; offset: number; limit: number }>({
    queryKey: ["spotify", "playlist", playlistId, offset, limit],
    queryFn: () =>
      fetchLibrary(`/spotify/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}`),
    retry: retrySpotifyLibrary,
    enabled: !!playlistId,
  });
}

export function useSpotifyTopTracks(timeRange: "short_term" | "medium_term" | "long_term" = "medium_term") {
  const fetchLibrary = useSpotifyLibraryFetch();
  return useQuery<{ tracks: SpotifyTrack[]; timeRange: string }>({
    queryKey: ["spotify", "top-tracks", timeRange],
    queryFn: () => fetchLibrary(`/spotify/top-tracks?time_range=${timeRange}`),
    retry: retrySpotifyLibrary,
    enabled: false,
  });
}

export function spotifyLoginUrl(): string {
  return apiUrl("/spotify/login");
}
