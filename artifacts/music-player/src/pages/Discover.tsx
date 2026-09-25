import { useState, useEffect } from "react";
import { TrackCard } from "@/components/TrackCard";
import { CollectionActions } from "@/components/CollectionActions";
import { useLikedTrackLookup } from "@/hooks/use-liked-collection";
import { Sparkles, Music2, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { TrackResult } from "@workspace/api-client-react";
import { tfFetch } from "@/lib/tf-session-client";

type RecommendationBasis = "liked_tracks" | "listening_history" | "mixed" | "none";

const basisLabels: Record<RecommendationBasis, string> = {
  liked_tracks: "По вашим сохранённым трекам",
  listening_history: "По вашей истории прослушивания",
  mixed: "По любимому и истории прослушивания",
  none: "Подборка для вас",
};

export default function Discover() {
  const [recommendations, setRecommendations] = useState<TrackResult[]>([]);
  const [basis, setBasis] = useState<RecommendationBasis>("none");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const likedLookup = useLikedTrackLookup(recommendations.map((track) => track.id));

  useEffect(() => {
    setIsLoading(true);
    tfFetch<{ results: TrackResult[]; basis?: RecommendationBasis }>("/tracks/recommendations?limit=20")
      .then((data) => {
        setRecommendations(data.results ?? []);
        setBasis(
          data.basis === "liked_tracks" ||
          data.basis === "listening_history" ||
          data.basis === "mixed"
            ? data.basis
            : "none",
        );
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center border border-white/10">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Рекомендации</h1>
          <p className="text-white/50 text-sm">{basisLabels[basis]}</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 py-24"
          >
            <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
            <p className="text-white/30 text-sm">Подбираем треки…</p>
          </motion.div>
        )}

        {!isLoading && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24 glass-card rounded-3xl"
          >
            <Music2 className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="text-white/50">{error}</p>
          </motion.div>
        )}

        {!isLoading && !error && recommendations.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24"
          >
            <div className="w-12 h-12 rounded-md bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Music2 className="w-6 h-6 text-white/30" />
            </div>
            <h2 className="text-xl font-semibold text-white/50 mb-2">Пока нет рекомендаций</h2>
            <p className="text-white/25 text-sm max-w-xs mx-auto">
              Сохраните понравившиеся треки или послушайте музыку, чтобы появились рекомендации.
            </p>
          </motion.div>
        )}

        {!isLoading && !error && recommendations.length > 0 && (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {recommendations.map((track, i) => (
              <TrackCard key={`${track.id}-${i}`} track={track} index={i} collectionAction={<CollectionActions
                track={track}
                saved={likedLookup.data?.likedTrackIds.includes(track.id) ?? false}
                checking={likedLookup.isFetching && !likedLookup.data}
              />} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
