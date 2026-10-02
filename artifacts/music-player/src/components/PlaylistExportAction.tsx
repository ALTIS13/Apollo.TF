import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import type { PlaylistDetailResponse } from "@workspace/api-client-react";
import { useTfAuth } from "@/auth/tf-auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { buildPlaylistExport } from "@/lib/playlist-export";
import { canUseTfProtectedActivity, subscribeTfActivitySuspension } from "@/lib/tf-session-client";

export function PlaylistExportAction({ detail, ownerAccountId, disabled }: {
  detail: PlaylistDetailResponse;
  ownerAccountId: string | null;
  disabled: boolean;
}) {
  const auth = useTfAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const allowed = auth.status === "authenticated" && auth.session?.accountId === ownerAccountId &&
    auth.hasEntitlement("tf.collections");
  const unavailable = disabled || !allowed || detail.playlist.trackCount !== detail.tracks.length;
  const canExport = () => !unavailable && canUseTfProtectedActivity(auth.session);

  useEffect(() => { setOpen(false); }, [auth.session, auth.status, detail.playlist.id]);
  useEffect(() => subscribeTfActivitySuspension(() => setOpen(false)), []);

  const download = (format: "json" | "csv") => {
    if (!canExport()) return;
    try {
      const file = buildPlaylistExport(detail, format);
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      try {
        link.href = url;
        link.download = file.filename;
        link.hidden = true;
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        // Let the browser consume the download before releasing its temporary URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast({ title: "Не удалось экспортировать плейлист", description: "Повторите попытку.", variant: "destructive" });
    }
  };

  return <DropdownMenu open={open} onOpenChange={(next) => setOpen(next && canExport())}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" disabled={unavailable}
        className="h-11 w-11 shrink-0 rounded-md text-[#8ddbd4] hover:bg-[#8ddbd4]/10 focus-visible:ring-[#8ddbd4] motion-reduce:transition-none"
        aria-label="Экспортировать плейлист" title="Экспортировать плейлист">
        <FileDown className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-36 rounded-lg border-white/10 bg-[#17171f] text-[#f5f3ff] motion-reduce:animate-none! motion-reduce:transition-none!">
      <DropdownMenuItem disabled={unavailable} className="min-h-11 focus:bg-white/10 focus:text-white motion-reduce:transition-none" onSelect={() => download("json")}>JSON</DropdownMenuItem>
      <DropdownMenuItem disabled={unavailable} className="min-h-11 focus:bg-white/10 focus:text-white motion-reduce:transition-none" onSelect={() => download("csv")}>CSV</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
