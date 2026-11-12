import { Link } from "wouter";
import { useTfAuth } from "@/auth/tf-auth";
import { artistHref } from "@/lib/artist-navigation";

export function ArtistLink({ artist, enabled = true }: {
  artist: string | null;
  enabled?: boolean;
}) {
  const { status, hasEntitlement } = useTfAuth();
  const href = enabled && artist && status === "authenticated" && hasEntitlement("tf.search")
    ? artistHref(artist)
    : null;
  const label = artist || "Неизвестный исполнитель";

  return href ? (
    <Link href={href} title={label}
      className="min-w-0 truncate underline decoration-current/40 underline-offset-2 hover:text-[#8ddbd4] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-[#8ddbd4]">
      {label}
    </Link>
  ) : (
    <span className="min-w-0 truncate" title={label}>{label}</span>
  );
}
