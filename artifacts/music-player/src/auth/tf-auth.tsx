import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TfWebSocketRecoveryBudget } from "@/lib/tf-websocket";
import {
  clearTfSessionSecurityState,
  commitTfSessionSecurityState,
  fetchTfSession,
  TfApiError,
  type TfBrowserSession,
  logoutTfSession,
  normalizeTfApiError,
  startTfLogin,
  subscribeTfAuthSecurityEvents,
  renewTfSession,
  suspendTfProtectedActivity,
  canUseTfProtectedActivity,
  isTfPlaybackActive,
} from "@/lib/tf-session-client";

export type TfAuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";
interface TfAuthState {
  status: TfAuthStatus;
  session: TfBrowserSession | null;
  error: TfApiError | null;
}
export interface TfAuthContextValue extends TfAuthState {
  webSocketRecoveryBudget: TfWebSocketRecoveryBudget;
  refresh: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
  hasEntitlement: (capability: string) => boolean;
}
type Mode = "standard" | "renew" | "policy";
const TfAuthContext = createContext<TfAuthContextValue | null>(null);
const visibleOrPlaying = () =>
  document.visibilityState !== "hidden" || isTfPlaybackActive();
const tuple = (s: TfBrowserSession) => `${s.accountId}:${s.installationId}`;
const maxTimeoutDelay = 2_147_483_647;

function armUntil(
  dueAt: number,
  timer: { current: ReturnType<typeof setTimeout> | null },
  onDue: () => void,
): void {
  timer.current = setTimeout(() => {
    if (Date.now() < dueAt) {
      armUntil(dueAt, timer, onDue);
      return;
    }
    onDue();
  }, Math.max(0, Math.min(dueAt - Date.now(), maxTimeoutDelay)));
}

export function TfAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TfAuthState>({
    status: "loading",
    session: null,
    error: null,
  });
  const current = useRef(state),
    mounted = useRef(false),
    generation = useRef(0);
  const active = useRef<{
    promise: Promise<void>;
    abort: AbortController;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0),
    retryAt = useRef(0),
    renewalDue = useRef(0);
  const cycleStarted = useRef<number | null>(null);
  const recoveryEpoch = useRef(0);
  const wsRecovery = useRef({
    key: "",
    budget: new TfWebSocketRecoveryBudget(),
  });
  const runRef = useRef<(mode: Mode) => Promise<void>>(async () => {});
  const publish = useCallback((next: TfAuthState) => {
    current.current = next;
    if (mounted.current) setState(next);
  }, []);
  const clearTimers = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (deadline.current) clearTimeout(deadline.current);
    timer.current = null;
    deadline.current = null;
  }, []);
  const discard = useCallback(() => {
    recoveryEpoch.current += 1;
    clearTimers();
    generation.current += 1;
    active.current?.abort.abort();
    active.current = null;
    clearTfSessionSecurityState();
    void queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
  }, [clearTimers, queryClient]);
  const suspend = useCallback(
    (error: TfApiError) => {
      suspendTfProtectedActivity(error);
      void queryClient.cancelQueries().catch(() => {});
      publish({ ...current.current, status: "unavailable", error });
    },
    [publish, queryClient],
  );
  const schedule = useCallback(
    (session: TfBrowserSession) => {
      clearTimers();
      failures.current = 0;
      retryAt.current = 0;
      cycleStarted.current = null;
      const expiresAt = Date.parse(session.expiresAt);
      const remaining = expiresAt - Date.now();
      renewalDue.current =
        Date.now() + remaining - Math.min(60_000, Math.max(0, remaining / 5));
      armUntil(expiresAt, deadline, () => {
        if (current.current.status === "authenticated")
          suspend(
            new TfApiError(401, "TF_RENEWAL_ACCESS_EXPIRED", "expired"),
          );
        if (
          session.renewalProfile &&
          visibleOrPlaying() &&
          Date.now() >= retryAt.current
        )
          void runRef.current("renew");
      });
      if (session.renewalProfile)
        armUntil(renewalDue.current, timer, () => {
          if (visibleOrPlaying()) void runRef.current("renew");
        });
    },
    [clearTimers, suspend],
  );

  const run = useCallback(
    (mode: Mode): Promise<void> => {
      if (!mounted.current) return Promise.resolve();
      if (active.current && mode !== "policy") return active.current.promise;
      if (
        mode !== "policy" &&
        (failures.current >= 3 ||
          (cycleStarted.current !== null &&
            Date.now() - cycleStarted.current >= 60_000))
      ) {
        retryAt.current = Infinity;
        return Promise.resolve();
      }
      if (mode !== "policy" && Date.now() < retryAt.current)
        return Promise.resolve();
      cycleStarted.current ??= Date.now();
      if (mode === "policy") {
        active.current?.abort.abort();
        active.current = null;
      }
      const version = ++generation.current,
        abort = new AbortController();
      const live = () =>
        mounted.current &&
        generation.current === version &&
        !abort.signal.aborted;
      const prior = current.current.session;
      const fail = (e: TfApiError) => {
        if (e.kind === "unauthenticated") {
          discard();
          publish({ status: "unauthenticated", session: null, error: e });
        } else {
          suspend(e);
          if (timer.current) clearTimeout(timer.current);
          failures.current += 1;
          if ((e.retryable || e.kind === "transport") && failures.current < 3) {
            retryAt.current = Date.now() + Math.max(1000, e.retryAfter * 1000);
            timer.current = setTimeout(() => {
              if (visibleOrPlaying())
                void runRef.current(
                  prior?.renewalProfile ? "renew" : "standard",
                );
            }, retryAt.current - Date.now());
          } else retryAt.current = Infinity;
        }
      };
      const timeout = setTimeout(() => {
        abort.abort();
        if (mounted.current && generation.current === version)
          fail(new TfApiError(0, "transport_unavailable", "transport", true));
      }, 10_000);
      const work = (async () => {
        try {
          let session: TfBrowserSession;
          const shouldRenew =
            prior?.renewalProfile &&
            mode !== "policy" &&
            (mode === "renew" ||
              current.current.status === "unavailable" ||
              Date.now() >= renewalDue.current);
          if (shouldRenew) {
            await renewTfSession(abort.signal);
            if (!live()) return;
            session = await fetchTfSession(abort.signal);
          } else {
            try {
              session = await fetchTfSession(abort.signal);
            } catch (error) {
              if (!live()) return;
              if (
                !(error instanceof TfApiError) ||
                error.status !== 401 ||
                error.renewalProfile !== "renewal-v1" ||
                mode === "policy"
              )
                throw error;
              await renewTfSession(abort.signal);
              if (!live()) return;
              session = await fetchTfSession(abort.signal);
            }
          }
          if (!live()) return;
          if (
            prior &&
            (tuple(prior) !== tuple(session) ||
              prior.entitlements.some(
                (cap) => !session.entitlements.includes(cap),
              ))
          ) {
            suspendTfProtectedActivity(
              new TfApiError(403, "policy_revoked", "forbidden"),
            );
            await queryClient.cancelQueries().catch(() => {});
            queryClient.clear();
            if (!live()) return;
          }
          commitTfSessionSecurityState(session);
          publish({ status: "authenticated", session, error: null });
          schedule(session);
        } catch (error) {
          if (!live()) return;
          fail(normalizeTfApiError(error));
        } finally {
          clearTimeout(timeout);
        }
      })();
      // Abort ends the coordinator even if a nonconforming transport never settles.
      // Every continuation checks the aborted generation before another request/publication.
      let onAbort!: () => void;
      const cancelled = new Promise<void>((resolve) => {
        onAbort = resolve;
        abort.signal.addEventListener("abort", onAbort, { once: true });
      });
      const promise = Promise.race([work, cancelled]).finally(() => {
        clearTimeout(timeout);
        abort.signal.removeEventListener("abort", onAbort);
      });
      const record = { promise, abort };
      active.current = record;
      void promise.finally(() => {
        if (active.current === record) active.current = null;
      });
      return promise;
    },
    [discard, publish, queryClient, schedule, suspend],
  );
  runRef.current = run;
  const refresh = useCallback(() => {
    if (active.current) return active.current.promise;
    recoveryEpoch.current += 1;
    failures.current = 0;
    cycleStarted.current = null;
    retryAt.current = 0;
    return run("standard");
  }, [run]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeTfAuthSecurityEvents((event) => {
      if (!mounted.current) return;
      if (event.type === "ws-recovery") {
        // Cancel older publication, not shared producer work, and retain BR1's counters.
        generation.current += 1;
        active.current?.abort.abort();
        active.current = null;
        clearTimers();
        retryAt.current = Math.max(retryAt.current, event.notBefore);
        suspend(event.error);
        if (Number.isFinite(retryAt.current))
          timer.current = setTimeout(
            () => {
              if (visibleOrPlaying()) void run("renew");
            },
            Math.max(0, retryAt.current - Date.now()),
          );
      } else if (event.type === "invalidated") {
        discard();
        publish({
          status: "unauthenticated",
          session: null,
          error: event.error,
        });
      } else if (event.type === "revalidate") {
        suspend(event.error);
        void run("policy");
      } else {
        suspend(event.error);
        if (event.type === "expired" && current.current.session?.renewalProfile)
          void run("renew");
      }
    });
    const wake = () => {
      if (!visibleOrPlaying() || !current.current.session) return;
      const session = current.current.session;
      if (
        current.current.status === "authenticated" &&
        Date.now() >= Date.parse(session.expiresAt)
      )
        suspend(new TfApiError(401, "TF_RENEWAL_ACCESS_EXPIRED", "expired"));
      if (
        Date.now() >= retryAt.current &&
        (current.current.status === "unavailable" ||
          Date.now() >= renewalDue.current)
      )
        void run(session.renewalProfile ? "renew" : "standard");
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void run("standard");
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      discard();
    };
  }, [clearTimers, discard, publish, run, suspend]);
  const login = useCallback(() => {
    discard();
    publish({ status: "unauthenticated", session: null, error: null });
    startTfLogin();
  }, [discard, publish]);
  const logout = useCallback(async () => {
    const remote = logoutTfSession().catch(() => {});
    discard();
    publish({ status: "unauthenticated", session: null, error: null });
    await remote;
  }, [discard, publish]);
  const hasEntitlement = useCallback(
    (capability: string) =>
      current.current.status === "authenticated" &&
      canUseTfProtectedActivity() &&
      (current.current.session?.entitlements.includes(capability) ?? false),
    [],
  );
  const value = useMemo(() => {
    const key = `${state.session ? tuple(state.session) : "none"}:${recoveryEpoch.current}`;
    if (wsRecovery.current.key !== key)
      wsRecovery.current = { key, budget: new TfWebSocketRecoveryBudget() };
    return {
      ...state,
      webSocketRecoveryBudget: wsRecovery.current.budget,
      refresh,
      login,
      logout,
      hasEntitlement,
    };
  }, [state, refresh, login, logout, hasEntitlement]);
  return (
    <TfAuthContext.Provider value={value}>{children}</TfAuthContext.Provider>
  );
}
export function useTfAuth(): TfAuthContextValue {
  const context = useContext(TfAuthContext);
  if (context === null)
    throw new Error("useTfAuth must be used within a TfAuthProvider");
  return context;
}
