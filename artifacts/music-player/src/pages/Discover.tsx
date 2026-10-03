import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { TrackCard } from "@/components/TrackCard";
import { CollectionActions } from "@/components/CollectionActions";
import { Button } from "@/components/ui/button";
import { useTfAuth } from "@/auth/tf-auth";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import { Sparkles, Music2, AlertCircle, RefreshCw, Search } from "lucide-react";
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
  results: TrackResult[];
  basis: RecommendationBasis;
  failed: boolean;
}

export default function Discover() {
  const { status, session, hasEntitlement } = useTfAuth();
  const allowed = status === "authenticated" && session !== null && hasEntitlement("tf.search");
  const ownerKey = session ? JSON.stringify([
    session.accountId, session.installationId, [...new Set(session.entitlements)].sort(),
  ]) : null;
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedOwner = useRef<string | null>(null);
  const current = allowed && snapshot?.ownerKey === ownerKey ? snapshot : null;
  const recommendations = current?.results ?? [];
  const basis = current?.basis ?? "none";
  const isLoading = allowed && current === null;
  const likedLookup = useLikedTrackLookup(recommendations.map((track) => track.id));

  useEffect(() => {
    if (!allowed || ownerKey === null) {
      loadedOwner.current = null;
      setSnapshot(null);
      return;
    }
    const generation = captureTfSecurityGeneration();
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && isCurrentTfSecurityGeneration(generation);
    const unsubscribe = subscribeTfActivitySuspension(() => {
      controller.abort();
      loadedOwner.current = null;
      setSnapshot(null);
    });
    // Token rotation is not a list refresh: mounted cards may own active downloads.
    if (loadedOwner.current !== ownerKey) {
      loadedOwner.current = null;
      setSnapshot(null);
      tfFetch<{ results: TrackResult[]; basis?: RecommendationBasis }>(
        "/tracks/recommendations?limit=20", { signal: controller.signal },
      )
        .then((data) => {
          if (!live()) return;
          loadedOwner.current = ownerKey;
          setSnapshot({
            ownerKey,
            results: data.results ?? [],
            basis: data.basis === "liked_tracks" || data.basis === "listening_history" || data.basis === "mixed"
              ? data.basis : "none",
            failed: false,
          });
        })
        .catch(() => {
          if (!live()) return;
          setSnapshot({ ownerKey, results: [], basis: "none", failed: true });
        });
    }
    return () => {
      unsubscribe();
      controller.abort();
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

      <section aria-label="Подборка треков" aria-busy={isLoading}
        className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6"
      >
        {!allowed && <p className="py-5 text-sm text-white/50">Рекомендации недоступны для этого аккаунта.</p>}
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

        {current?.failed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-5">
            <p className="flex min-w-0 items-center gap-2 text-sm text-white/70">
              <AlertCircle className="h-4 w-4 shrink-0 text-white/50" />
              Не удалось загрузить рекомендации.
            </p>
            <Button type="button" variant="ghost"
              className="h-11 shrink-0 rounded-md border-white/10 px-3 text-sm text-white/80 hover:bg-white/5 focus-visible:ring-[#a78bfa] motion-reduce:transition-none"
              onClick={() => {
                setSnapshot(null);
                setAttempt((value) => value + 1);
              }}
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
          <div key={ownerKey} className="space-y-2">
            {recommendations.map((track, i) => (
              <TrackCard key={`${track.id}-${i}`} track={track} index={i} compact collectionAction={<CollectionActions
                track={track}
                saved={likedLookup.data?.likedTrackIds.includes(track.id) ?? false}
                checking={likedLookup.isFetching && !likedLookup.data}
              />} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
