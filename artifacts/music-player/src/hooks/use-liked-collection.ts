import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listLikedTracks,
  saveLikedTrack,
  removeLikedTrack,
  type SaveLikedTrackRequest,
} from "@workspace/api-client-react";
import { useTfAuth } from "@/auth/tf-auth";
import {
  tfRequestInit,
  reportTfAuthError,
  TfApiError,
} from "@/lib/tf-session-client";

export const likedCollectionKey = (accountId: string | null) =>
  ["tf", "liked", accountId] as const;

function useCollectionAccess() {
  const { status, session, hasEntitlement } = useTfAuth();
  const accountId =
    status === "authenticated" ? (session?.accountId ?? null) : null;
  const allowed = accountId !== null && hasEntitlement("tf.collections");
  const current = useRef({ accountId, session, allowed, mounted: true });
  current.current = {
    accountId,
    session,
    allowed,
    mounted: current.current.mounted,
  };
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  const stillCurrent = () =>
    current.current.mounted &&
    allowed &&
    current.current.allowed &&
    current.current.session === session &&
    current.current.accountId === accountId;
  const assertCurrent = () => {
    if (!stillCurrent())
      throw new TfApiError(403, "collection_session_changed", "forbidden");
  };
  const request = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent();
    try {
      return await operation();
    } catch (error) {
      // A late error from an old session must not invalidate its replacement.
      if (stillCurrent()) reportTfAuthError(error);
      throw error;
    }
  };
  return { accountId, allowed, request };
}

export function useSaveLikedTrack() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...likedCollectionKey(access.accountId), "save"],
    mutationFn: (input: SaveLikedTrackRequest & { trackId: string }) => {
      const { trackId, artist, title, thumbnailUrl, durationSeconds } = input;
      return access.request(() =>
        saveLikedTrack(
          trackId,
          { artist, title, thumbnailUrl, durationSeconds },
          tfRequestInit({ method: "PUT" }),
        ),
      );
    },
    onSuccess: () => {
      return client.invalidateQueries({
        queryKey: likedCollectionKey(access.accountId),
      });
    },
    retry: false,
  });
}

export function useLikedCollection() {
  const access = useCollectionAccess();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: likedCollectionKey(access.accountId),
    enabled: access.allowed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      return access.request(() =>
        listLikedTracks(
          { limit: 50, ...(pageParam === null ? {} : { cursor: pageParam }) },
          tfRequestInit({ signal }),
        ),
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const remove = useMutation({
    mutationKey: [...likedCollectionKey(access.accountId), "remove"],
    mutationFn: (trackId: string) => {
      return access.request(() =>
        removeLikedTrack(trackId, tfRequestInit({ method: "DELETE" })),
      );
    },
    onSuccess: () => {
      return client.invalidateQueries({
        queryKey: likedCollectionKey(access.accountId),
      });
    },
    retry: false,
  });
  return {
    query,
    remove,
    allowed: access.allowed,
    items: access.allowed
      ? (query.data?.pages.flatMap((page) => page.items) ?? [])
      : [],
  };
}
