import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRemoveLikedTrack } from "@/hooks/use-liked-collection";
import {
  canUseTfProtectedActivity, captureTfSecurityGeneration, isCurrentTfSecurityGeneration,
  subscribeTfActivitySuspension, type TfBrowserSession,
} from "@/lib/tf-session-client";

type Remainder = { ids: readonly string[]; confirmed: number };
type Snapshot = Remainder & { session: TfBrowserSession; generation: number };

export function LikedRemovalAction({ trackIds, disabled, canStart, onConfirmed, onPendingChange, onEmptySelectionFocus }: {
  trackIds: readonly string[];
  disabled: boolean;
  canStart: () => boolean;
  onConfirmed: (trackId: string) => void;
  onPendingChange: (pending: boolean, operation: object) => void;
  onEmptySelectionFocus: () => void;
}) {
  const auth = useTfAuth();
  const remove = useRemoveLikedTrack();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const intent = useRef<Snapshot | null>(null);
  const [result, setResult] = useState<Remainder | null>(null);
  const remainder = useRef<Remainder | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState(false);
  const operation = useRef<{ cancelled: boolean } | null>(null);
  const mounted = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const current = useRef({ auth, disabled, canStart, onConfirmed, onPendingChange });
  current.current = { auth, disabled, canStart, onConfirmed, onPendingChange };
  const ownerKey = auth.session
    ? `${auth.session.accountId}:${auth.session.installationId}:${auth.session.entitlements.includes("tf.collections")}` : "none";

  const scopeCurrent = (scope: Snapshot) => mounted.current &&
    current.current.auth.status === "authenticated" && current.current.auth.session === scope.session &&
    current.current.auth.hasEntitlement("tf.collections") && canUseTfProtectedActivity(scope.session) &&
    isCurrentTfSecurityGeneration(scope.generation);
  const invalidate = () => {
    const run = operation.current;
    operation.current = null;
    intent.current = null;
    if (run) {
      run.cancelled = true;
      current.current.onPendingChange(false, run);
    }
    if (mounted.current) {
      setOpen(false);
      setSnapshot(null);
      setPending(false);
      setError(false);
      if (run) setStopped(true);
    }
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeTfActivitySuspension(invalidate);
    return () => {
      mounted.current = false;
      invalidate();
      unsubscribe();
    };
  }, []);
  useEffect(() => { invalidate(); }, [auth.session, auth.status]);
  useEffect(() => {
    remainder.current = null;
    setResult(null);
    setStopped(false);
  }, [ownerKey]);

  const openSnapshot = (state: Remainder, retry = false) => {
    const scope = current.current;
    if (operation.current || scope.disabled || !scope.canStart() || !scope.auth.session ||
      state.ids.length === 0 || state.ids.length > 20) return;
    const next = { ...state, ids: Object.freeze([...state.ids]),
      session: scope.auth.session, generation: captureTfSecurityGeneration() };
    if (!scopeCurrent(next)) return;
    intent.current = next;
    setSnapshot(next);
    setAttempted(retry);
    setError(false);
    setStopped(false);
    setOpen(true);
  };
  const stopOrClose = () => {
    if (operation.current) {
      operation.current.cancelled = true;
      setStopped(true);
      // Keep the current-scope lock until the sent request settles; cancellation is not rollback.
      return;
    }
    intent.current = null;
    setOpen(false);
  };
  const runRemoval = async () => {
    const scope = intent.current;
    if (!scope || operation.current || current.current.disabled || !current.current.canStart() ||
      !scopeCurrent(scope)) return;
    const run = { cancelled: false };
    operation.current = run;
    current.current.onPendingChange(true, run);
    setPending(true);
    setAttempted(true);
    setStopped(false);
    setError(false);
    let remaining: Remainder = { ids: scope.ids, confirmed: scope.confirmed };
    const publish = () => {
      remainder.current = remaining;
      setResult(remaining);
      intent.current = { ...scope, ...remaining };
      setSnapshot(intent.current);
    };
    publish();
    const live = () => operation.current === run && !run.cancelled && scopeCurrent(scope);
    try {
      for (const id of scope.ids) {
        if (!live()) break;
        await remove.mutateAsync(id);
        if (!live()) break;
        remaining = { ids: remaining.ids.slice(1), confirmed: remaining.confirmed + 1 };
        current.current.onConfirmed(id);
        publish();
      }
    } catch {
      if (live()) setError(true);
    } finally {
      // Invalidation can release this run before transport settles and a replacement can already be active.
      if (operation.current === run) {
        operation.current = null;
        current.current.onPendingChange(false, run);
        setPending(false);
        if (!scopeCurrent(scope)) invalidate();
        else if (remaining.ids.length === 0) {
          intent.current = null;
          setOpen(false);
        }
      }
    }
  };
  const summary = result && <p role="status" className="break-words text-sm tabular-nums text-[#aaa9ba]">
    Удалено: {result.confirmed} · Не подтверждено: {result.ids.length}
  </p>;

  return <>
    <Button ref={trigger} type="button" variant="ghost" size="icon"
      className="h-11 w-11 shrink-0 rounded-md text-[#8ddbd4] hover:bg-[#8ddbd4]/10 focus-visible:ring-[#8ddbd4] motion-reduce:transition-none"
      aria-label="Удалить выбранные из избранного" title="Удалить выбранные из избранного"
      disabled={disabled || pending || trackIds.length === 0}
      onClick={() => openSnapshot({ ids: trackIds, confirmed: 0 })}
    ><Trash2 className="h-4 w-4" /></Button>
    {!open && result && <div className="w-full min-w-0 space-y-2">
      {summary}
      {result.ids.length > 0 && <Button type="button" variant="ghost"
        className="min-h-11 max-w-full whitespace-normal rounded-md px-2 text-sm text-[#8ddbd4] focus-visible:ring-[#8ddbd4] motion-reduce:transition-none"
        disabled={disabled || pending || !auth.hasEntitlement("tf.collections")}
        onClick={() => { if (remainder.current) openSnapshot(remainder.current, true); }}
      ><RotateCcw className="h-4 w-4" />Повторить неподтверждённые</Button>}
    </div>}
    <Dialog open={open} onOpenChange={(next) => { if (!next) stopOrClose(); }}>
      <DialogContent
        className="max-h-[85vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border-white/10 bg-[#111217] p-4 text-[#f5f3ff] motion-reduce:animate-none! motion-reduce:transition-none! [&>button:last-child]:right-1 [&>button:last-child]:top-1 [&>button:last-child]:size-11"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (snapshot && scopeCurrent(snapshot)) {
            if (trigger.current?.disabled) onEmptySelectionFocus();
            else trigger.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words pr-9 text-base leading-snug tracking-normal">Удалить выбранные из избранного</DialogTitle>
          <DialogDescription className="break-words text-sm text-[#aaa9ba]">
            Только избранное: {snapshot?.ids.length ?? 0}. Плейлисты и очередь не изменятся.
          </DialogDescription>
        </DialogHeader>
        {attempted && summary}
        {(pending || stopped || error || (attempted && Boolean(result?.ids.length))) && <p className="break-words text-sm text-[#aaa9ba]">
          Отправленный запрос может завершиться. Остановка отменяет только следующие запросы; неподтверждённые можно повторить отдельно.
        </p>}
        {error && <p role="alert" className="break-words text-sm text-red-300">Не удалось подтвердить удаление. Следующие треки не отправлены.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button ref={cancel} type="button" variant="outline"
            className="min-h-11 min-w-0 flex-1 whitespace-normal rounded-md border-white/15 bg-transparent px-3 py-2 text-[#f5f3ff] focus-visible:ring-[#8ddbd4] motion-reduce:transition-none"
            disabled={pending && stopped} onClick={stopOrClose}
          >{pending ? "Остановить" : "Отмена"}</Button>
          <Button type="button"
            className="min-h-11 min-w-0 flex-1 whitespace-normal rounded-md bg-[#8ddbd4] px-3 py-2 text-[#09090b] hover:bg-[#abe9e3] focus-visible:ring-[#8ddbd4] motion-reduce:transition-none"
            disabled={pending || disabled || !auth.hasEntitlement("tf.collections") || !snapshot?.ids.length}
            onClick={() => void runRemoval()}
          >{pending && <Loader2 className="h-4 w-4 motion-safe:animate-spin" />}{attempted ? "Повторить неподтверждённые" : "Удалить из избранного"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
