import { useLayoutEffect, useRef, useState } from "react";
import { Link, useRouter } from "wouter";
import { AlertCircle, Loader2, Music2, RefreshCw, Search } from "lucide-react";
import { TrackType, type ArtistTracksResponse } from "@workspace/api-client-react";
import { z } from "zod";
import { useTfAuth } from "@/auth/tf-auth";
import { CollectionActions } from "@/components/CollectionActions";
import { TrackCard } from "@/components/TrackCard";
import { Button } from "@/components/ui/button";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import { artistHref, readArtistName } from "@/lib/artist-navigation";
import {
  canUseTfProtectedActivity, captureTfSecurityGeneration, isCurrentTfSecurityGeneration,
  subscribeTfActivitySuspension, tfFetch, type TfBrowserSession,
} from "@/lib/tf-session-client";

const artistResponseSchema = z.object({
  schemaVersion: z.literal(1),
  artist: z.string(),
  results: z.array(z.object({
    id: z.string().trim().min(3).max(4096).refine((id) => !id.startsWith("rv_")),
    title: z.string().trim().min(1).max(500),
    artist: z.string().trim().min(1).max(300),
    type: z.nativeEnum(TrackType),
    duration: z.number().int().min(0).max(86_400),
    source: z.enum(["youtube", "soundcloud"]),
    thumbnailUrl: z.string().trim().max(4096).url().refine((value) => {
      try { return new URL(value).protocol === "https:"; } catch { return false; }
    }).nullable().optional(),
    quality: z.array(z.string().trim().min(1).max(32)).max(32),
    viewCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    score: z.number().finite().min(0).max(1_000),
  })).max(20),
  partial: z.boolean(),
}) satisfies z.ZodType<ArtistTracksResponse>;

type ArtistLoad = { status: "loading" | "error" } | { status: "ready"; page: ArtistTracksResponse };

function SearchLink() {
  return <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-white/80 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#67dbea]">
    <Search className="h-4 w-4" />К поиску
  </Link>;
}

function LoadingTracks() {
  return <p role="status" aria-label="Загрузка треков исполнителя" className="flex items-center gap-2 py-5 text-sm text-white/60">
    <Loader2 className="h-4 w-4 motion-safe:animate-spin" />Загружаем треки...
  </p>;
}

function ArtistTracks({ name, session }: { name: string; session: TfBrowserSession }) {
  const [load, setLoad] = useState<ArtistLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const settled = useRef<number | null>(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    const generation = captureTfSecurityGeneration();
    const live = () => !controller.signal.aborted && isCurrentTfSecurityGeneration(generation) && canUseTfProtectedActivity(session);
    const unsubscribe = subscribeTfActivitySuspension(() => {
      controller.abort();
      settled.current = null;
      setLoad({ status: "loading" });
    });
    if (settled.current !== attempt && live()) {
      void tfFetch<unknown>(`/tracks/artist?name=${encodeURIComponent(name)}`, { signal: controller.signal, cache: "no-store" })
        .then((body) => {
          if (!live()) return;
          const result = artistResponseSchema.safeParse(body);
          if (!result.success || artistHref(result.data.artist) !== artistHref(name)) throw new Error("invalid_artist_response");
          settled.current = attempt;
          setLoad({ status: "ready", page: result.data });
        })
        .catch(() => {
          if (!live()) return;
          settled.current = attempt;
          setLoad({ status: "error" });
        });
    }
    return () => { unsubscribe(); controller.abort(); };
  }, [attempt, name, session]);

  const page = load.status === "ready" ? load.page : null;
  const tracks = page?.results ?? [];
  const liked = useLikedTrackLookup(tracks.map((track) => track.id));

  if (load.status === "loading") return <LoadingTracks />;
  if (load.status === "error") return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-5">
    <p className="flex min-w-0 items-center gap-2 text-sm text-white/70"><AlertCircle className="h-4 w-4 shrink-0 text-white/50" />Не удалось загрузить треки исполнителя.</p>
    <Button type="button" variant="ghost" className="min-h-11 shrink-0 gap-2" onClick={() => {
      setLoad({ status: "loading" });
      setAttempt((value) => value + 1);
    }}><RefreshCw className="h-4 w-4" />Повторить</Button>
  </div>;

  return <>
    {page?.partial && <p role="status" className="mb-4 border-b border-white/10 pb-3 text-sm text-white/65">Показаны не все доступные треки.</p>}
    {!tracks.length ? <div className="flex flex-col items-start gap-3 border-y border-white/10 py-6">
      <h2 className="text-base font-medium text-white/70">{page?.partial ? "В доступной части нет треков." : "Треки исполнителя не найдены."}</h2>
      <SearchLink />
    </div> : <div className="space-y-4">
      {tracks.map((track, index) => <article key={`${track.source}:${track.id}`} aria-label={track.title} className="min-w-0">
        <TrackCard track={track} index={index} compact linkArtist={false} allowDownload={false} collectionAction={
          <CollectionActions track={track} saved={liked.data?.likedTrackIds.includes(track.id) ?? false} checking={liked.isFetching && !liked.data} />
        } />
      </article>)}
    </div>}
  </>;
}

export default function Artist() {
  const router = useRouter();
  // Use Wouter's raw search subscription: the top-level hook decodes %25 before validation.
  const name = readArtistName(router.searchHook(router));
  const { status, session, hasEntitlement } = useTfAuth();
  const allowed = status === "authenticated" && session && hasEntitlement("tf.search");

  return <div className="min-h-full bg-background pb-8">
    <header className="border-b border-white/5 bg-black/20">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-5 sm:px-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
          <Music2 className="h-5 w-5 text-[#67dbea]" />
        </div>
        <div className="min-w-0">
          {name && <p className="text-xs text-white/50">Исполнитель</p>}
          <h1 className="break-words text-xl font-semibold text-white [overflow-wrap:anywhere]">{name ?? "Исполнитель"}</h1>
        </div>
      </div>
    </header>
    <section aria-label="Треки исполнителя" className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      {!name ? <div className="flex flex-col items-start gap-2 py-5 text-sm text-white/65">
        <p>Некорректное имя исполнителя.</p><SearchLink />
      </div> : status === "loading" ? <LoadingTracks /> : allowed ?
        <ArtistTracks key={JSON.stringify([session.accountId, session.installationId, name])} name={name} session={session} /> :
        <p className="py-5 text-sm text-white/50">Треки исполнителя недоступны для этого аккаунта.</p>}
    </section>
  </div>;
}
