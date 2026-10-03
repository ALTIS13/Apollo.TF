import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { TrackCard } from "@/components/TrackCard";
import { CollectionActions } from "@/components/CollectionActions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useTfAuth } from "@/auth/tf-auth";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import { Sparkles, Music2, AlertCircle, RefreshCw, Search, CircleOff, Loader2, Undo2 } from "lucide-react";
import type { TrackResult } from "@workspace/api-client-react";
import {
  captureTfSecurityGeneration,
  isCurrentTfSecurityGeneration,
  subscribeTfActivitySuspension,
  tfFetch,
} from "@/lib/tf-session-client";

type RecommendationBasis = "liked_tracks" | "listening_history" | "mixed" | "none";

const basisLabels: Record<RecommendationBasis, string> = {
  liked_tracks: "По вашим сохранённым трекам",
  listening_history: "По вашей истории прослушивания",
  mixed: "По любимому и истории прослушивания",
  none: "Подборка для вас",
};

interface RecommendationSnapshot {
  ownerKey: string;
  results: RecommendationTrack[];
  basis: RecommendationBasis;
  hiddenCount: number;
  failed: boolean;
}

interface RecommendationTrack extends TrackResult {
  recommendationReason?: { basis: "liked_tracks" | "listening_history"; artist: string };
}

interface PreferenceFeedback {
  ownerKey: string;
  message: string;
  failed: boolean;
  undo: RecommendationTrack | null;
}

function reasonLabel(track: RecommendationTrack): string | null {
  const reason = track.recommendationReason;
  if (!reason || typeof reason.artist !== "string" || !reason.artist.trim()) return null;
  const artist = reason.artist.trim().slice(0, 300);
  if (reason.basis === "liked_tracks") return `Из любимого · ${artist}`;
  if (reason.basis === "listening_history") return `Вы слушали · ${artist}`;
  return null;
}

function survivingBasis(tracks: readonly RecommendationTrack[]): RecommendationBasis {
  const bases = new Set<"liked_tracks" | "listening_history">();
  for (const track of tracks) {
    if (!reasonLabel(track)) return "none";
    bases.add(track.recommendationReason!.basis);
  }
  if (bases.size === 2) return "mixed";
  return bases.values().next().value ?? "none";
}

export default function Discover() {
  const { status, session, hasEntitlement } = useTfAuth();
  const allowed = status === "authenticated" && session !== null && hasEntitlement("tf.search") && hasEntitlement("tf.collections");
  const ownerKey = session ? JSON.stringify([
    session.accountId, session.installationId, [...new Set(session.entitlements)].sort(),
  ]) : null;
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedOwner = useRef<string | null>(null);
  const [feedback, setFeedback] = useState<PreferenceFeedback | null>(null);
  const [pendingOwner, setPendingOwner] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [refreshFailureOwner, setRefreshFailureOwner] = useState<string | null>(null);
  const [refreshingOwner, setRefreshingOwner] = useState<string | null>(null);
  const refreshOwner = useRef<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const activeOwner = useRef(ownerKey);
  activeOwner.current = allowed ? ownerKey : null;
  const visibleFeedback = allowed && feedback?.ownerKey === ownerKey ? feedback : null;
  const listRefreshing = allowed && refreshingOwner === ownerKey;
  const preferencePending = allowed && (pendingOwner === ownerKey || listRefreshing);
  const current = allowed && snapshot?.ownerKey === ownerKey ? snapshot : null;
  const recommendations = current?.results ?? [];
  const basis = current?.basis ?? "none";
  const isLoading = allowed && current === null;
  const likedLookup = useLikedTrackLookup(recommendations.map((track) => track.id));

  useEffect(() => {
    const reset = () => {
      mutation.current?.abort();
      mutation.current = null;
      setPendingOwner(null);
      setFeedback(null);
      setResetOpen(false);
      setRefreshFailureOwner(null);
      refreshOwner.current = null;
      setRefreshingOwner(null);
    };
    reset();
    const unsubscribe = subscribeTfActivitySuspension(reset);
    return () => {
      unsubscribe();
      mutation.current?.abort();
      mutation.current = null;
    };
  }, [allowed, ownerKey]);

  const refresh = () => {
    if (!allowed || ownerKey === null) return;
    // Lock preference writes before React starts the replacement list request.
    refreshOwner.current = ownerKey;
    setRefreshingOwner(ownerKey);
    loadedOwner.current = null;
    setRefreshFailureOwner(null);
    setSnapshot((previous) => previous?.failed ? null : previous);
    setAttempt((value) => value + 1);
  };

  const updatePreference = async (kind: "hide" | "restore" | "clear", track?: RecommendationTrack) => {
    if (!allowed || ownerKey === null || mutation.current || refreshOwner.current === ownerKey || (kind !== "clear" && !track)) return;
    const owner = ownerKey;
    const generation = captureTfSecurityGeneration();
    const controller = new AbortController();
    mutation.current = controller;
    setPendingOwner(owner);
    const live = () => !controller.signal.aborted && mutation.current === controller &&
      activeOwner.current === owner && isCurrentTfSecurityGeneration(generation);
    try {
      const path = `/tracks/recommendations/hidden${kind === "clear" ? "" : `/${encodeURIComponent(track!.id)}`}`;
      const result = await tfFetch<{ schemaVersion: number; status: string }>(path, {
        method: kind === "hide" ? "PUT" : "DELETE", signal: controller.signal,
      });
      if (!live()) return;
      if (result.schemaVersion !== 1 || result.status !== (kind === "hide" ? "hidden" : kind === "restore" ? "restored" : "cleared")) {
        throw new Error("invalid_preference_response");
      }
      if (kind === "hide") {
        setSnapshot((previous) => {
          if (previous?.ownerKey !== owner) return previous;
          const results = previous.results.filter((candidate) => candidate.id !== track!.id);
          return { ...previous, results, basis: survivingBasis(results), hiddenCount: previous.hiddenCount + 1 };
        });
        setFeedback({ ownerKey: owner, message: `Запись скрыта: ${track!.title}`, failed: false, undo: track! });
      } else {
        setFeedback({ ownerKey: owner, message: kind === "clear" ? "Скрытые рекомендации сброшены." : "Запись снова доступна в рекомендациях.", failed: false, undo: null });
        refresh();
      }
    } catch {
      if (live()) setFeedback((previous) => ({
        ownerKey: owner, message: "Не удалось сохранить настройку рекомендаций.", failed: true,
        undo: previous?.ownerKey === owner ? previous.undo : null,
      }));
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setPendingOwner(null);
        // A stale acknowledgement may still represent a committed write.
        if (!controller.signal.aborted && activeOwner.current === owner && !isCurrentTfSecurityGeneration(generation)) refresh();
      }
    }
  };

  useEffect(() => {
    if (!allowed || ownerKey === null) {
      loadedOwner.current = null;
      setSnapshot(null);
      return;
    }
    const generation = captureTfSecurityGeneration();
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && activeOwner.current === ownerKey && isCurrentTfSecurityGeneration(generation);
    const unsubscribe = subscribeTfActivitySuspension(() => {
      controller.abort();
      loadedOwner.current = null;
      setSnapshot(null);
    });
    // Token rotation is not a list refresh: mounted cards may own active downloads.
    if (loadedOwner.current !== ownerKey) {
      listRequest.current = controller;
      refreshOwner.current = ownerKey;
      setRefreshingOwner(ownerKey);
      loadedOwner.current = null;
      setSnapshot((previous) => previous?.ownerKey === ownerKey && !previous.failed ? previous : null);
      tfFetch<{ results: RecommendationTrack[]; basis?: RecommendationBasis; hiddenCount?: number }>(
        "/tracks/recommendations?limit=20", { signal: controller.signal },
      )
        .then((data) => {
          if (!live()) return;
          loadedOwner.current = ownerKey;
          setRefreshFailureOwner(null);
          setSnapshot({
            ownerKey,
            results: data.results ?? [],
            basis: data.basis === "liked_tracks" || data.basis === "listening_history" || data.basis === "mixed"
              ? data.basis : "none",
            hiddenCount: Number.isSafeInteger(data.hiddenCount) && data.hiddenCount! >= 0 ? data.hiddenCount! : 0,
            failed: false,
          });
        })
        .catch(() => {
          if (!live()) return;
          setRefreshFailureOwner(ownerKey);
          setSnapshot((previous) => previous?.ownerKey === ownerKey && !previous.failed ? previous : {
            ownerKey, results: [], basis: "none", hiddenCount: 0, failed: true,
          });
        })
        .finally(() => {
          if (listRequest.current !== controller) return;
          listRequest.current = null;
          refreshOwner.current = null;
          setRefreshingOwner(null);
        });
    }
    return () => {
      unsubscribe();
      controller.abort();
      if (listRequest.current === controller) {
        listRequest.current = null;
        refreshOwner.current = null;
        setRefreshingOwner(null);
      }
    };
  }, [allowed, ownerKey, session, attempt]);

  return (
    <div className="min-h-full bg-background pb-8">
      <header className="border-b border-white/5 bg-black/20">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-5 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <Sparkles className="h-5 w-5 text-[#67dbea]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal text-white">Рекомендации</h1>
            <p className="mt-1 text-xs text-white/50 sm:text-sm">{basisLabels[basis]}</p>
          </div>
        </div>
      </header>

      <section aria-label="Подборка треков" aria-busy={isLoading || listRefreshing}
        className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6"
      >
        {!allowed && <p className="py-5 text-sm text-white/50">Рекомендации недоступны для этого аккаунта.</p>}
        {current && listRefreshing && <span role="status" aria-label="Обновление рекомендаций" className="sr-only">Обновление рекомендаций...</span>}
        {visibleFeedback && <div role={visibleFeedback.failed ? "alert" : "status"}
          className="mb-4 flex flex-wrap items-center justify-between gap-2 border-y border-white/10 py-3 text-sm"
        >
          <p className={`min-w-0 break-words [overflow-wrap:anywhere] ${visibleFeedback.failed ? "text-amber-200" : "text-white/70"}`}>{visibleFeedback.message}</p>
          {visibleFeedback.undo && <Button variant="ghost" className="min-h-11 shrink-0 gap-2" disabled={preferencePending}
            aria-label="Отменить скрытие" onClick={() => void updatePreference("restore", visibleFeedback.undo!)}
          ><Undo2 className="h-4 w-4" />Отменить</Button>}
        </div>}
        {current && !current.failed && current.hiddenCount > 0 && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
          <span>Скрыто записей: {current.hiddenCount}</span>
          <Button type="button" variant="ghost" className="min-h-11 gap-2 px-2 text-xs text-white/70"
            disabled={preferencePending} aria-label="Сбросить скрытые рекомендации" onClick={() => setResetOpen(true)}
          ><RefreshCw className="h-4 w-4" />Сбросить скрытые</Button>
        </div>}
        <AlertDialog open={allowed && resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent className="w-[calc(100%-2rem)] rounded-lg border-white/10 bg-[#111217]">
            <AlertDialogHeader><AlertDialogTitle>Сбросить скрытые рекомендации?</AlertDialogTitle>
              <AlertDialogDescription>Ранее скрытые записи снова смогут появляться в подборках. Любимое и плейлисты не изменятся.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction disabled={preferencePending} onClick={() => void updatePreference("clear")}>Сбросить</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {isLoading && (
          <div role="status" aria-label="Загрузка рекомендаций">
            <span className="sr-only">Загрузка рекомендаций...</span>
            <div aria-hidden="true" className="space-y-2">
              {[0, 1, 2, 3].map((row) => <div key={row}
                className="flex min-h-32 items-center gap-3 rounded-lg border border-white/5 bg-card/60 p-3 motion-safe:animate-pulse lg:min-h-24"
              >
                <div className="h-14 w-14 shrink-0 rounded-md bg-white/5 lg:h-16 lg:w-16" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="h-3 w-3/4 rounded-sm bg-white/10" />
                  <div className="h-2 w-1/2 rounded-sm bg-white/5" />
                  <div className="h-8 w-2/3 rounded-md bg-white/5" />
                </div>
              </div>)}
            </div>
          </div>
        )}

        {(current?.failed || (allowed && refreshFailureOwner === ownerKey)) && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-5">
            <p className="flex min-w-0 items-center gap-2 text-sm text-white/70">
              <AlertCircle className="h-4 w-4 shrink-0 text-white/50" />
              Не удалось загрузить рекомендации.
            </p>
            <Button type="button" variant="ghost"
              className="h-11 shrink-0 rounded-md border-white/10 px-3 text-sm text-white/80 hover:bg-white/5 focus-visible:ring-[#a78bfa] motion-reduce:transition-none"
              disabled={listRefreshing} onClick={refresh}
            ><RefreshCw className="h-4 w-4" />Повторить</Button>
          </div>
        )}

        {current && !current.failed && recommendations.length === 0 && (
          <div className="flex flex-col items-start gap-3 border-y border-white/10 py-6">
            <div className="flex items-center gap-2">
              <Music2 className="h-5 w-5 text-white/40" />
              <h2 className="text-base font-medium text-white/70">Пока нет рекомендаций</h2>
            </div>
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-white/80 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#a78bfa] motion-reduce:transition-none">
              <Search className="h-4 w-4" />К поиску
            </Link>
          </div>
        )}

        {current && !current.failed && recommendations.length > 0 && (
          <div key={ownerKey} className="space-y-4">
            {recommendations.map((track, i) => (
              <article key={`${track.source}:${track.id}`} aria-label={track.title} className="min-w-0 space-y-1.5">
                {reasonLabel(track) && <p className="px-1 text-xs leading-5 text-white/50 [overflow-wrap:anywhere]">{reasonLabel(track)}</p>}
                <TrackCard track={track} index={i} compact collectionAction={<>
                  <CollectionActions track={track}
                    saved={likedLookup.data?.likedTrackIds.includes(track.id) ?? false}
                    checking={likedLookup.isFetching && !likedLookup.data}
                  />
                  <Button type="button" variant="ghost" size="icon"
                    className="h-11 w-11 shrink-0 rounded-md border border-white/10 text-white/50 hover:text-amber-200"
                    disabled={preferencePending} aria-label={`Не рекомендовать ${track.title}`} title="Не рекомендовать эту запись"
                    onClick={() => void updatePreference("hide", track)}
                  >{preferencePending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <CircleOff className="h-4 w-4" />}</Button>
                </>} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
