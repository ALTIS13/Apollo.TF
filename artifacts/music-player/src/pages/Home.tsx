import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { getTrackSuggestions, searchTracks } from "@workspace/api-client-react";
import type { SearchRequest, TrackSuggestionsResponse, TrackType } from "@workspace/api-client-react";
import { TrackCard } from "@/components/TrackCard";
import { SaveLikedTrackButton } from "@/components/LikedCollection";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import { captureTfSecurityGeneration, isCurrentTfSecurityGeneration, reportTfAuthError, TfApiError, tfRequestInit } from "@/lib/tf-session-client";
import { useTfAuth } from "@/auth/tf-auth";
import { Search, Music2, Loader2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type FilterType = TrackType | "all";
type SourceKey = "yt" | "sc" | "bc" | "dz";
type SourceMode = "auto" | "manual";
type HomeSearchRequest = SearchRequest & {
  mode: SourceMode;
  sources?: SourceKey[];
};

const SOURCE_INFO: { key: SourceKey; label: string; dot: string }[] = [
  { key: "yt", label: "YouTube", dot: "bg-red-400" },
  { key: "sc", label: "SoundCloud", dot: "bg-orange-400" },
  { key: "bc", label: "Bandcamp", dot: "bg-cyan-400" },
  { key: "dz", label: "Deezer", dot: "bg-purple-400" },
];

function loadSourcePrefs(): { mode: SourceMode; sources: Record<SourceKey, boolean> } {
  try {
    const raw = localStorage.getItem("tf_source_prefs");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { mode: "auto", sources: { yt: true, sc: true, bc: true, dz: true } };
}

function saveSourcePrefs(mode: SourceMode, sources: Record<SourceKey, boolean>) {
  localStorage.setItem("tf_source_prefs", JSON.stringify({ mode, sources }));
}

export default function Home() {
  const reduceMotion = useReducedMotion();
  const { session } = useTfAuth();
  const params = new URLSearchParams(window.location.search);
  const [artist, setArtist] = useState(params.get("artist") ?? "");
  const [title, setTitle] = useState(params.get("title") ?? "");
  const [suggestions, setSuggestions] = useState<TrackSuggestionsResponse["suggestions"]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsSuppressed, setSuggestionsSuppressed] = useState(
    Boolean(params.get("artist") && params.get("title")),
  );
  const suggestionRegionRef = useRef<HTMLDivElement>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [hasSearched, setHasSearched] = useState(false);

  const [sourceMode, setSourceMode] = useState<SourceMode>(
    () => loadSourcePrefs().mode,
  );
  const [sourcesState, setSourcesState] = useState<Record<SourceKey, boolean>>(
    () => loadSourcePrefs().sources,
  );

  const enabledSources = (Object.keys(sourcesState) as SourceKey[]).filter(
    (k) => sourcesState[k],
  );
  const isAllEnabled = enabledSources.length === 4;

  const toggleSource = useCallback((key: SourceKey) => {
    setSourcesState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (Object.values(next).filter(Boolean).length === 0) return prev;
      setSourceMode("manual");
      saveSourcePrefs("manual", next);
      return next;
    });
  }, []);

  const setAutoMode = useCallback(() => {
    const next = { yt: true, sc: true, bc: true, dz: true } as Record<
      SourceKey,
      boolean
    >;
    setSourceMode("auto");
    setSourcesState(next);
    saveSourcePrefs("auto", next);
  }, []);

  const searchMutation = useMutation({
    mutationFn: async (data: SearchRequest) => {
      const generation = captureTfSecurityGeneration();
      try {
        const result = await searchTracks(
          data,
          tfRequestInit({ method: "POST" }),
        );
        if (!isCurrentTfSecurityGeneration(generation)) {
          throw new TfApiError(
            0,
            "stale_response",
            "invalid",
            false,
            generation,
          );
        }
        return result;
      } catch (error) {
        if (isCurrentTfSecurityGeneration(generation)) reportTfAuthError(error);
        throw error;
      }
    },
  });

  function buildSearchData(a: string, t: string): HomeSearchRequest {
    if (
      sourceMode === "manual" &&
      enabledSources.length > 0 &&
      enabledSources.length < 4
    ) {
      return { artist: a, title: t, mode: "manual", sources: enabledSources };
    }
    return { artist: a, title: t, mode: "auto" };
  }

  useEffect(() => {
    setSuggestions([]);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    const query = `${artist.trim()} ${title.trim()}`.trim().slice(0, 500);
    if (!session || title.trim().length < 2 || suggestionsSuppressed) return;

    const generation = captureTfSecurityGeneration();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await getTrackSuggestions(
          { q: query },
          tfRequestInit({ method: "GET", signal: controller.signal }),
        );
        if (controller.signal.aborted || !isCurrentTfSecurityGeneration(generation)) return;
        setSuggestions(response.suggestions);
        setSuggestionsOpen(response.suggestions.length > 0);
      } catch (error) {
        if (controller.signal.aborted || !isCurrentTfSecurityGeneration(generation)) return;
        reportTfAuthError(error);
        setSuggestions([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [artist, title, session, suggestionsSuppressed]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!suggestionRegionRef.current?.contains(event.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [suggestionsOpen]);

  const chooseSuggestion = (suggestion: TrackSuggestionsResponse["suggestions"][number]) => {
    setSuggestionsSuppressed(true);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setArtist(suggestion.artist);
    setTitle(suggestion.title);
    setHasSearched(true);
    searchMutation.mutate(buildSearchData(suggestion.artist, suggestion.title));
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      if (activeSuggestion < 0 && artist.trim()) return;
      event.preventDefault();
      chooseSuggestion(suggestions[Math.max(activeSuggestion, 0)]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
    }
  };

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = p.get("artist");
    const t = p.get("title");
    if (a && t) {
      setHasSearched(true);
      searchMutation.mutate(buildSearchData(a, t));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!artist.trim() || !title.trim()) return;

    setHasSearched(true);
    setSuggestionsOpen(false);
    searchMutation.mutate(buildSearchData(artist, title));
  };

  const results = searchMutation.data?.results || [];
  const likedLookup = useLikedTrackLookup(results.map((track) => track.id));

  const filteredResults =
    activeFilter === "all"
      ? results
      : results.filter((track) => track.type === activeFilter);

  const filterOptions: { id: FilterType; label: string }[] = [
    { id: "all", label: "All Types" },
    { id: "original", label: "Originals" },
    { id: "remix", label: "Remixes" },
    { id: "live", label: "Live" },
    { id: "cover", label: "Covers" },
  ];

  return (
    <div className="min-h-full bg-[#09090b] pb-8">
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <h1 className="mb-4 text-xl font-semibold tracking-normal text-white">
            Apollo TF <span className="font-normal text-white/40">/ Поиск</span>
          </h1>
          <form
            onSubmit={handleSearch}
            aria-label="Поиск музыки"
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <label className="min-w-0 text-xs font-medium text-muted-foreground">
              Исполнитель
              <span className="mt-1.5 flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-secondary/50 px-3 focus-within:border-primary">
                <Music2 className="h-4 w-4 shrink-0" />
                <input
                  type="text"
                  placeholder="Artist name..."
                  value={artist}
                  onChange={(e) => {
                    setSuggestionsSuppressed(false);
                    setArtist(e.target.value);
                  }}
                  className="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                  required
                />
              </span>
            </label>
            <div ref={suggestionRegionRef} className="relative min-w-0">
              <label className="text-xs font-medium text-muted-foreground">
                Название трека
                <span className="mt-1.5 flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-secondary/50 px-3 focus-within:border-primary">
                  <Search className="h-4 w-4 shrink-0" />
                  <input
                    type="text"
                    placeholder="Track title..."
                    value={title}
                    onChange={(e) => {
                      setSuggestionsSuppressed(false);
                      setTitle(e.target.value);
                    }}
                    onKeyDown={handleTitleKeyDown}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={suggestionsOpen}
                    aria-controls={suggestionsOpen ? "tf-track-suggestions" : undefined}
                    aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? `tf-suggestion-${activeSuggestion}` : undefined}
                    className="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                    required
                  />
                </span>
              </label>
              {suggestionsOpen && (
                <div
                  id="tf-track-suggestions"
                  role="listbox"
                  aria-label="Подсказки треков"
                  className="relative z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-white/15 bg-[#17171b] p-1 shadow-xl sm:absolute sm:inset-x-0 sm:top-full"
                >
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.artist}:${suggestion.title}:${index}`}
                      id={`tf-suggestion-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === activeSuggestion}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSuggestion(suggestion)}
                      className={`block w-full truncate rounded-sm px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-white ${index === activeSuggestion ? "bg-white/10 text-white" : "text-foreground hover:bg-white/10"}`}
                    >
                      {suggestion.artist} - {suggestion.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={searchMutation.isPending}
              className="flex h-11 min-w-32 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
            >
              {searchMutation.isPending ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {searchMutation.isPending ? "Поиск..." : "Найти"}
            </button>
          </form>
          <fieldset className="mt-4">
            <legend className="mb-2 text-xs text-muted-foreground">
              Источники
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={setAutoMode}
                aria-pressed={isAllEnabled}
                className={`h-9 rounded-lg border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-white ${isAllEnabled ? "border-white/25 bg-white/10 text-white" : "border-white/10 text-muted-foreground"}`}
              >
                Авто
              </button>
              {SOURCE_INFO.map((source) => (
                <label
                  key={source.key}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-muted-foreground has-[:checked]:border-white/25 has-[:checked]:text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={sourcesState[source.key]}
                    onChange={() => toggleSource(source.key)}
                    className="h-3.5 w-3.5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  />
                  <span className={`h-1.5 w-1.5 rounded-full ${source.dot}`} />
                  {source.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </header>

      <section
        aria-label="Результаты поиска"
        aria-busy={searchMutation.isPending}
        className="mx-auto max-w-5xl px-4 py-5 sm:px-6"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-normal text-foreground">
            Результаты{" "}
            {searchMutation.data && !searchMutation.isPending && (
              <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                {filteredResults.length}
              </span>
            )}
          </h2>
          {!searchMutation.isPending && results.length > 0 && (
            <div
              role="group"
              aria-label="Тип записи"
              className="flex flex-wrap gap-1"
            >
              {filterOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setActiveFilter(opt.id)}
                  aria-pressed={activeFilter === opt.id}
                  className={`rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-white ${activeFilter === opt.id ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!hasSearched && (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Search className="h-5 w-5" />
            Нет результатов поиска
          </div>
        )}
        {searchMutation.isPending && (
          <div role="status" aria-label="Поиск треков" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex h-24 items-center gap-4 rounded-lg border border-white/5 p-4 motion-safe:animate-pulse"
              >
                <div className="h-14 w-14 shrink-0 rounded-md bg-secondary" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-secondary" />
                  <div className="h-3 w-1/3 rounded bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!searchMutation.isPending && searchMutation.isError && (
          <div
            role="alert"
            className="flex items-start gap-3 border-t border-white/10 py-6 text-sm"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <h3 className="tracking-normal text-foreground">Search Failed</h3>
              <p className="mt-1 text-muted-foreground">
                Не удалось выполнить поиск. Повторите попытку позже.
              </p>
            </div>
          </div>
        )}
        {!searchMutation.isPending && searchMutation.data && (
          <AnimatePresence mode="popLayout">
            {filteredResults.length === 0 ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.15 }}
                className="border-t border-white/10 py-8 text-sm text-muted-foreground"
              >
                <h3 className="mb-2 text-base tracking-normal text-foreground">
                  No tracks found
                </h3>
                <p>Совпадений нет.</p>
                {activeFilter !== "all" && (
                  <button
                    onClick={() => setActiveFilter("all")}
                    className="mt-3 text-primary underline focus-visible:outline-2 focus-visible:outline-white"
                  >
                    Все результаты
                  </button>
                )}
              </motion.div>
            ) : (
              <div className="space-y-3">
                {filteredResults.map((track, i) => (
                  <TrackCard
                    key={`${track.id}-${i}`}
                    track={track}
                    index={i}
                    compact
                    collectionAction={<SaveLikedTrackButton
                      track={track}
                      saved={likedLookup.data?.likedTrackIds.includes(track.id) ?? false}
                      checking={likedLookup.isFetching && !likedLookup.data}
                    />}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        )}
      </section>
    </div>
  );
}
