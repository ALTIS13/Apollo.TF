import { useEffect, useState } from "react";
import { Link } from "wouter";
import { searchTracks, type SearchResponse } from "@workspace/api-client-react";
import { AlertCircle, Loader2, Search, X } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { CollectionActions } from "@/components/CollectionActions";
import { TrackCard } from "@/components/TrackCard";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import {
  captureTfSecurityGeneration,
  isCurrentTfSecurityGeneration,
  reportTfAuthError,
  tfRequestInit,
} from "@/lib/tf-session-client";

export function ProviderCandidatePanel({ artist, title, onClose }: {
  artist: string;
  title: string;
  onClose: () => void;
}) {
  const { session } = useTfAuth();
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const liked = useLikedTrackLookup(response?.results.map((track) => track.id) ?? []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = captureTfSecurityGeneration();
    let active = true;
    setState("loading");
    setResponse(null);
    void (async () => {
      try {
        const result = await searchTracks(
          { artist, title, mode: "auto", maxResults: 6 },
          tfRequestInit({ method: "POST", signal: controller.signal }),
        );
        if (!active || !isCurrentTfSecurityGeneration(generation)) return;
        setResponse(result);
        setState("ready");
      } catch (error) {
        if (!active || !isCurrentTfSecurityGeneration(generation)) return;
        reportTfAuthError(error);
        setState("error");
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [artist, title, session?.accountId, attempt]);

  const searchUrl = `/?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`;
  return (
    <section aria-label="Подбор записи TF" className="border-y border-white/10 bg-white/[0.03] py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">Записи в Apollo TF</h2>
          <p className="mt-1 break-words text-sm text-muted-foreground">{artist} — {title}</p>
        </div>
        <button type="button" onClick={onClose} title="Закрыть подбор" aria-label="Закрыть подбор" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {state === "loading" && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> Ищем записи в открытых источниках...
        </p>
      )}
      {state === "error" && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-amber-300">
          <AlertCircle className="h-4 w-4" /> Поиск сейчас недоступен.
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-white">Повторить</button>
        </div>
      )}
      {state === "ready" && response?.results.length === 0 && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">Подходящих записей пока не найдено.</p>
      )}
      {state === "ready" && response && response.results.length > 0 && (
        <div className="mt-4 space-y-2">
          {response.results.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              index={index}
              compact
              collectionAction={<CollectionActions
                track={track}
                saved={liked.data?.likedTrackIds.includes(track.id) ?? false}
                checking={liked.isFetching && !liked.data}
              />}
            />
          ))}
        </div>
      )}
      {state === "ready" && (
        <Link href={searchUrl} className="mt-4 inline-flex items-center gap-2 text-sm text-white underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-white">
          <Search className="h-4 w-4" /> Открыть полный поиск
        </Link>
      )}
    </section>
  );
}
