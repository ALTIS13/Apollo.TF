import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Music2,
  ChevronLeft,
  ChevronRight,
  List,
  Heart,
  TrendingUp,
  Loader2,
  AlertCircle,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  useSpotifyStatus,
  useSpotifyLiked,
  useSpotifyPlaylists,
  useSpotifyPlaylistTracks,
  useSpotifyTopTracks,
  type SpotifyTrack,
  type SpotifyPlaylist,
} from "@/hooks/use-spotify";
import {
  useYandexStatus,
  useYandexLiked,
  useYandexPlaylists,
  useYandexPlaylistTracks,
  type YandexTrack,
  type YandexPlaylist,
} from "@/hooks/use-yandex";
import { useTfAuth } from "@/auth/tf-auth";
import { LikedCollection } from "@/components/LikedCollection";
import { PlaylistsCollection } from "@/components/PlaylistsCollection";
import { ProviderCandidatePanel } from "@/components/ProviderCandidatePanel";

const SPOTIFY_GREEN = "#1DB954";
const YANDEX_YELLOW = "#FFCC00";

type ServiceTab = "apollo" | "spotify" | "yandex";
type CatalogTab = "liked" | "playlists" | "top";

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function LoadingState({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-white/40">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color }} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-red-400/70">
      <AlertCircle className="w-8 h-8" />
      <p className="text-sm text-center max-w-xs">{message}</p>
    </div>
  );
}

function Pagination({
  offset, limit, total, onPageChange,
}: { offset: number; limit: number; total: number; onPageChange: (o: number) => void }) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-4 pb-2">
      <button
        className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        onClick={() => onPageChange(Math.max(0, offset - limit))}
        disabled={offset === 0}
      >
        <ChevronLeft className="w-5 h-5 text-white" />
      </button>
      <span className="text-white/60 text-sm">
        Page {currentPage} of {totalPages}
        <span className="text-white/30 ml-2">({total} tracks)</span>
      </span>
      <button
        className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        onClick={() => onPageChange(offset + limit)}
        disabled={offset + limit >= total}
      >
        <ChevronRight className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}

type GenericTrack = { id: string; title: string; artist: string; album: string; durationMs: number; thumbnailUrl: string | null; externalUrl: string };

function TrackList({ tracks, offset, accentColor, onSearchVariants }: {
  tracks: GenericTrack[];
  offset: number;
  accentColor: string;
  onSearchVariants: (title: string, artist: string) => void;
}) {
  return (
    <div className="space-y-1">
      {tracks.map((track, i) => (
        <motion.div
          key={track.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.025, 0.4) }}
          className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-all"
        >
          <span className="w-6 shrink-0 text-center text-xs text-white/25">{offset + i + 1}</span>

          {track.thumbnailUrl ? (
            <img src={track.thumbnailUrl} alt={track.album} className="w-10 h-10 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-md bg-white/10 flex items-center justify-center shrink-0">
              <Music2 className="w-4 h-4 text-white/25" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-medium text-white truncate text-sm">{track.title}</p>
            <p className="text-white/45 text-xs truncate">{track.artist}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-white/25 text-xs hidden sm:block">{formatDuration(track.durationMs)}</span>
            <a
              href={track.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/35 hover:text-white/70 focus-visible:outline-2 focus-visible:outline-white"
              onClick={(e) => e.stopPropagation()}
              title="Открыть в музыкальном сервисе"
              aria-label={`Открыть в музыкальном сервисе: ${track.title}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center gap-2 rounded-md border border-white/15 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white sm:w-auto sm:px-3"
              style={{ borderColor: accentColor }}
              onClick={() => onSearchVariants(track.title, track.artist)}
              aria-label={`Найти в TF: ${track.title}`}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Найти в TF</span>
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ProviderCollectionUnavailable({ name }: { name: string }) {
  return (
    <div className="py-8 text-sm text-muted-foreground">
      <p>{name} не подключён.</p>
      <Link href="/integrations" className="mt-3 inline-flex items-center gap-2 text-white underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-white">
        К подключениям <ExternalLink className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SpotifyCatalog({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [activeTab, setActiveTab] = useState<CatalogTab>("liked");

  const tabs = [
    { id: "liked" as CatalogTab, label: "Любимые", icon: <Heart className="w-4 h-4" /> },
    { id: "playlists" as CatalogTab, label: "Плейлисты", icon: <List className="w-4 h-4" /> },
    { id: "top" as CatalogTab, label: "Топ", icon: <TrendingUp className="w-4 h-4" /> },
  ];

  return (
    <div>
      <div className="mb-5 flex w-full gap-1 rounded-md bg-white/5 p-1 sm:w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium transition-colors sm:flex-none sm:px-4 sm:text-sm"
            style={activeTab === tab.id ? { background: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "rgba(255,255,255,0.45)" }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === "liked" && <SpotifyLikedTab onSearchVariants={onSearchVariants} />}
          {activeTab === "playlists" && <SpotifyPlaylistsTab onSearchVariants={onSearchVariants} />}
          {activeTab === "top" && <SpotifyTopTab onSearchVariants={onSearchVariants} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SpotifyLikedTab({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [offset, setOffset] = useState(0);
  const { data, isFetching, error, refetch } = useSpotifyLiked(offset, 50);
  useEffect(() => { refetch(); }, [offset]);
  useEffect(() => { refetch(); }, []);

  if (isFetching) return <LoadingState label="Loading liked songs..." color={SPOTIFY_GREEN} />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return null;

  const tracks: GenericTrack[] = data.tracks.map((t: SpotifyTrack) => ({
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    durationMs: t.durationMs, thumbnailUrl: t.thumbnailUrl, externalUrl: t.spotifyUrl,
  }));

  return (
    <>
      <TrackList tracks={tracks} offset={offset} accentColor={SPOTIFY_GREEN} onSearchVariants={onSearchVariants} />
      <Pagination offset={offset} limit={50} total={data.total} onPageChange={setOffset} />
    </>
  );
}

function SpotifyPlaylistsTab({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [selected, setSelected] = useState<SpotifyPlaylist | null>(null);
  const [offset, setOffset] = useState(0);
  const { data: pData, isFetching: loadingP, error: pErr, refetch: refetchP } = useSpotifyPlaylists();
  const { data: tData, isFetching: loadingT, error: tErr, refetch: refetchT } = useSpotifyPlaylistTracks(selected?.id ?? null, offset, 50);

  useEffect(() => { refetchP(); }, []);
  useEffect(() => { if (selected) { setOffset(0); } }, [selected?.id]);
  useEffect(() => { if (selected) refetchT(); }, [selected?.id, offset]);

  if (selected) {
    const tracks: GenericTrack[] = (tData?.tracks ?? []).map((t: SpotifyTrack) => ({
      id: t.id, title: t.title, artist: t.artist, album: t.album,
      durationMs: t.durationMs, thumbnailUrl: t.thumbnailUrl, externalUrl: t.spotifyUrl,
    }));
    return (
      <div>
        <button className="flex items-center gap-2 text-white/50 hover:text-white mb-4 text-sm transition-colors" onClick={() => { setSelected(null); setOffset(0); }}>
          <ChevronLeft className="w-4 h-4" /> Back to playlists
        </button>
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5">
          {selected.thumbnailUrl && <img src={selected.thumbnailUrl} alt={selected.name} className="w-12 h-12 rounded-lg object-cover" />}
          <div>
            <h3 className="font-semibold text-white text-sm">{selected.name}</h3>
            <p className="text-white/40 text-xs">{selected.trackCount} tracks</p>
          </div>
        </div>
        {loadingT ? <LoadingState label="Loading tracks..." color={SPOTIFY_GREEN} /> :
          tErr ? <ErrorState message={(tErr as Error).message} /> : (
            <>
              <TrackList tracks={tracks} offset={offset} accentColor={SPOTIFY_GREEN} onSearchVariants={onSearchVariants} />
              {tData && <Pagination offset={offset} limit={50} total={tData.total} onPageChange={setOffset} />}
            </>
          )}
      </div>
    );
  }

  if (loadingP) return <LoadingState label="Loading playlists..." color={SPOTIFY_GREEN} />;
  if (pErr) return <ErrorState message={(pErr as Error).message} />;
  if (!pData) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {pData.playlists.map((p: SpotifyPlaylist, i: number) => (
        <motion.button
          key={p.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: Math.min(i * 0.03, 0.4) }}
          onClick={() => setSelected(p)}
          className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left group"
        >
          {p.thumbnailUrl
            ? <img src={p.thumbnailUrl} alt={p.name} className="w-12 h-12 rounded-md object-cover shrink-0" />
            : <div className="w-12 h-12 rounded-md bg-white/8 flex items-center justify-center shrink-0"><List className="w-5 h-5 text-white/25" /></div>
          }
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white text-sm truncate">{p.name}</p>
            <p className="text-white/35 text-xs">{p.trackCount} tracks</p>
          </div>
          <ChevronLeft className="w-4 h-4 text-white/15 group-hover:text-white/50 rotate-180 shrink-0 transition-colors" />
        </motion.button>
      ))}
    </div>
  );
}

function SpotifyTopTab({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [timeRange, setTimeRange] = useState<"short_term" | "medium_term" | "long_term">("medium_term");
  const { data, isFetching, error, refetch } = useSpotifyTopTracks(timeRange);
  useEffect(() => { refetch(); }, [timeRange]);
  useEffect(() => { refetch(); }, []);

  const ranges = [
    { id: "short_term" as const, label: "Last 4 weeks" },
    { id: "medium_term" as const, label: "Last 6 months" },
    { id: "long_term" as const, label: "All time" },
  ];

  const tracks: GenericTrack[] = (data?.tracks ?? []).map((t: SpotifyTrack) => ({
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    durationMs: t.durationMs, thumbnailUrl: t.thumbnailUrl, externalUrl: t.spotifyUrl,
  }));

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {ranges.map((r) => (
          <button key={r.id} onClick={() => setTimeRange(r.id)}
            className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
            style={timeRange === r.id ? { background: SPOTIFY_GREEN, color: "#000" } : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)" }}
          >{r.label}</button>
        ))}
      </div>
      {isFetching ? <LoadingState label="Loading top tracks..." color={SPOTIFY_GREEN} /> :
        error ? <ErrorState message={(error as Error).message} /> :
          <TrackList tracks={tracks} offset={0} accentColor={SPOTIFY_GREEN} onSearchVariants={onSearchVariants} />}
    </div>
  );
}

function YandexCatalog({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [activeTab, setActiveTab] = useState<"liked" | "playlists">("liked");

  const tabs = [
    { id: "liked" as const, label: "Любимые", icon: <Heart className="w-4 h-4" /> },
    { id: "playlists" as const, label: "Плейлисты", icon: <List className="w-4 h-4" /> },
  ];

  return (
    <div>
      <div className="mb-5 flex w-full gap-1 rounded-md bg-white/5 p-1 sm:w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium transition-colors sm:flex-none sm:px-4 sm:text-sm"
            style={activeTab === tab.id ? { background: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "rgba(255,255,255,0.45)" }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === "liked" && <YandexLikedTab onSearchVariants={onSearchVariants} />}
          {activeTab === "playlists" && <YandexPlaylistsTab onSearchVariants={onSearchVariants} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function YandexLikedTab({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [offset, setOffset] = useState(0);
  const { data, isFetching, error, refetch } = useYandexLiked(offset, 50);
  useEffect(() => { refetch(); }, [offset]);
  useEffect(() => { refetch(); }, []);

  if (isFetching) return <LoadingState label="Loading liked tracks..." color={YANDEX_YELLOW} />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!data) return null;

  const tracks: GenericTrack[] = data.tracks.map((t: YandexTrack) => ({
    id: t.id, title: t.title, artist: t.artist, album: t.album,
    durationMs: t.durationMs, thumbnailUrl: t.thumbnailUrl, externalUrl: t.trackUrl,
  }));

  return (
    <>
      <TrackList tracks={tracks} offset={offset} accentColor={YANDEX_YELLOW} onSearchVariants={onSearchVariants} />
      <Pagination offset={offset} limit={50} total={data.total} onPageChange={setOffset} />
    </>
  );
}

function YandexPlaylistsTab({ onSearchVariants }: { onSearchVariants: (title: string, artist: string) => void }) {
  const [selected, setSelected] = useState<YandexPlaylist | null>(null);
  const [offset, setOffset] = useState(0);
  const { data: pData, isFetching: loadingP, error: pErr, refetch: refetchP } = useYandexPlaylists();
  const { data: tData, isFetching: loadingT, error: tErr, refetch: refetchT } = useYandexPlaylistTracks(
    selected?.uid ?? null, selected?.kind ?? null, offset, 50
  );

  useEffect(() => { refetchP(); }, []);
  useEffect(() => { if (selected) { setOffset(0); } }, [selected?.kind, selected?.uid]);
  useEffect(() => { if (selected) refetchT(); }, [selected?.kind, selected?.uid, offset]);

  if (selected) {
    const tracks: GenericTrack[] = (tData?.tracks ?? []).map((t: YandexTrack) => ({
      id: t.id, title: t.title, artist: t.artist, album: t.album,
      durationMs: t.durationMs, thumbnailUrl: t.thumbnailUrl, externalUrl: t.trackUrl,
    }));
    return (
      <div>
        <button className="flex items-center gap-2 text-white/50 hover:text-white mb-4 text-sm transition-colors" onClick={() => { setSelected(null); setOffset(0); }}>
          <ChevronLeft className="w-4 h-4" /> Back to playlists
        </button>
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5">
          {selected.thumbnailUrl && <img src={selected.thumbnailUrl} alt={selected.title} className="w-12 h-12 rounded-lg object-cover" />}
          <div>
            <h3 className="font-semibold text-white text-sm">{selected.title}</h3>
            <p className="text-white/40 text-xs">{selected.trackCount} tracks</p>
          </div>
        </div>
        {loadingT ? <LoadingState label="Loading tracks..." color={YANDEX_YELLOW} /> :
          tErr ? <ErrorState message={(tErr as Error).message} /> : (
            <>
              <TrackList tracks={tracks} offset={offset} accentColor={YANDEX_YELLOW} onSearchVariants={onSearchVariants} />
              {tData && <Pagination offset={offset} limit={50} total={tData.total} onPageChange={setOffset} />}
            </>
          )}
      </div>
    );
  }

  if (loadingP) return <LoadingState label="Loading playlists..." color={YANDEX_YELLOW} />;
  if (pErr) return <ErrorState message={(pErr as Error).message} />;
  if (!pData) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {pData.playlists.map((p: YandexPlaylist, i: number) => (
        <motion.button
          key={`${p.uid}-${p.kind}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: Math.min(i * 0.03, 0.4) }}
          onClick={() => setSelected(p)}
          className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left group"
        >
          {p.thumbnailUrl
            ? <img src={p.thumbnailUrl} alt={p.title} className="w-12 h-12 rounded-md object-cover shrink-0" />
            : <div className="w-12 h-12 rounded-md bg-white/8 flex items-center justify-center shrink-0"><List className="w-5 h-5 text-white/25" /></div>
          }
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white text-sm truncate">{p.title}</p>
            <p className="text-white/35 text-xs">{p.trackCount} tracks</p>
          </div>
          <ChevronLeft className="w-4 h-4 text-white/15 group-hover:text-white/50 rotate-180 shrink-0 transition-colors" />
        </motion.button>
      ))}
    </div>
  );
}

export default function Favorites() {
  const reduceMotion = useReducedMotion();
  const [, navigate] = useLocation();
  const [service, setService] = useState<ServiceTab>("apollo");
  const [apolloTab, setApolloTab] = useState<"liked" | "playlists">("liked");
  const [selectedTrack, setSelectedTrack] = useState<{ title: string; artist: string } | null>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const { hasEntitlement } = useTfAuth();
  const integrationsAllowed = hasEntitlement("tf.integrations");
  const callbackQuery = new URLSearchParams(window.location.search);
  const callback = callbackQuery.has("spotify_error") ? "spotify_error=1" : callbackQuery.get("spotify_connected") === "1" ? "spotify_connected=1" : null;
  const spotify = useSpotifyStatus(!callback && integrationsAllowed && service === "spotify");
  const yandex = useYandexStatus(!callback && integrationsAllowed && service === "yandex");
  const spotifyStatus = spotify.data;
  const yandexStatus = yandex.data;

  // Retain the existing backend callback destination without treating its query as status.
  useEffect(() => {
    if (callback) navigate(`/integrations?${callback}`, { replace: true });
  }, [callback, navigate]);

  const handleSearchVariants = (title: string, artist: string) => {
    setSelectedTrack({ title, artist });
  };

  useEffect(() => {
    if (selectedTrack) candidateRef.current?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }, [selectedTrack, reduceMotion]);

  const services = [
    { id: "apollo" as ServiceTab, label: "Apollo", color: "#8b5cf6", connected: false },
    { id: "spotify" as ServiceTab, label: "Spotify", color: SPOTIFY_GREEN, connected: spotifyStatus?.connected },
    { id: "yandex" as ServiceTab, label: "Yandex Music", color: YANDEX_YELLOW, connected: yandexStatus?.connected },
  ];

  const activeService = services.find((s) => s.id === service)!;
  const activeStatus = service === "apollo" ? undefined : service === "spotify" ? spotifyStatus : yandexStatus;
  const activeQuery = service === "spotify" ? spotify : yandex;
  const activeLoading = service !== "apollo" && activeQuery.isPending;
  const displayName = activeStatus?.connected ? activeStatus.displayName : undefined;

  if (callback) return null;

  return (
    <div className="min-h-full bg-[#09090b] pb-12">
      <div className="border-b border-white/5 bg-black/20">
        <div className="max-w-5xl mx-auto px-4 pt-6 pb-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-colors"
                style={{ background: activeService.color }}
              >
                <Music2 className="w-4 h-4 text-black" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-normal text-white">Apollo TF <span className="font-normal text-white/30">|</span> Избранное</h1>
                {displayName && <p className="text-white/35 text-xs">{displayName}</p>}
              </div>
            </div>

            <div className="flex max-w-full flex-wrap items-center gap-2">
              <div className="flex gap-1 p-1 rounded-xl bg-white/5">
                {services.map((svc) => (
                  <button
                    key={svc.id}
                    onClick={() => { setService(svc.id); setSelectedTrack(null); }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all relative"
                    style={service === svc.id ? { background: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "rgba(255,255,255,0.4)" }}
                  >
                    {svc.connected && (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: svc.color }} />
                    )}
                    {svc.label}
                  </button>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {selectedTrack && service !== "apollo" && integrationsAllowed && (
          <div ref={candidateRef} className="mb-6 scroll-mt-16">
            <ProviderCandidatePanel
              key={`${service}:${selectedTrack.artist}:${selectedTrack.title}`}
              artist={selectedTrack.artist}
              title={selectedTrack.title}
              onClose={() => setSelectedTrack(null)}
            />
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={service}
            initial={reduceMotion ? false : { opacity: 0, x: service === "spotify" ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {service === "apollo" ? <>
              <div role="tablist" aria-label="Коллекция Apollo" className="mb-6 flex gap-1 border-b border-white/10">
                <button type="button" role="tab" aria-selected={apolloTab === "liked"} onClick={() => setApolloTab("liked")} className={`border-b-2 px-4 py-2 text-sm ${apolloTab === "liked" ? "border-[#a78bfa] text-white" : "border-transparent text-white/50 hover:text-white"}`}>Любимые</button>
                <button type="button" role="tab" aria-selected={apolloTab === "playlists"} onClick={() => setApolloTab("playlists")} className={`border-b-2 px-4 py-2 text-sm ${apolloTab === "playlists" ? "border-[#a78bfa] text-white" : "border-transparent text-white/50 hover:text-white"}`}>Плейлисты</button>
              </div>
              {apolloTab === "liked" ? <LikedCollection /> : <PlaylistsCollection />}
            </> : !integrationsAllowed ? (
              <div className="py-8 text-sm text-muted-foreground">Подключение музыкальных сервисов недоступно для этого аккаунта.</div>
            ) : activeLoading ? (
              <LoadingState label="Checking connection..." color={activeService.color} />
            ) : activeQuery.isError ? (
              <div role="alert" className="py-8 text-sm text-amber-300">
                Не удалось проверить подключение.
                <button onClick={() => void activeQuery.refetch()} className="ml-2 underline focus-visible:outline-2 focus-visible:outline-white">Повторить</button>
              </div>
            ) : service === "spotify" ? (
              spotifyStatus?.connected
                ? <SpotifyCatalog onSearchVariants={handleSearchVariants} />
                : <ProviderCollectionUnavailable name="Spotify" />
            ) : (
              yandexStatus?.connected
                ? <YandexCatalog onSearchVariants={handleSearchVariants} />
                : <ProviderCollectionUnavailable name="Yandex Music" />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
