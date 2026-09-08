import {
  TfApiError,
  normalizeTfApiError,
  captureTfSecurityGeneration,
  isCurrentTfSecurityGeneration,
} from "./tf-session-client";

const INITIAL_RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const TERMINAL_ERROR_KINDS = new Set([
  "unauthenticated",
  "forbidden",
  "unavailable",
]);
const POLICY_REVOKED_CLOSE = { code: 4403, reason: "policy_revoked" };
const POLICY_UNAVAILABLE_CLOSE = { code: 1013, reason: "policy_unavailable" };
const BUFFER_UNAVAILABLE_CLOSE = { code: 1013, reason: "buffer_unavailable" };

export interface TfWebSocketLifecycleOptions {
  successor?: boolean;
  recoveryBudget?: TfWebSocketRecoveryBudget;
  onRetryableError?: (error: TfApiError, notBefore: number) => void;
  createTicket: (signal?: AbortSignal) => Promise<string>;
  buildUrl: (ticket: string) => string;
  createSocket: (url: string) => WebSocket;
  onMessage: (event: MessageEvent, isCurrent: () => boolean) => void;
  onTerminalError: (error: TfApiError) => void;
  schedule?: typeof window.setTimeout;
  cancelSchedule?: typeof window.clearTimeout;
}

/** Non-authorizing budget retained by the player across auth/socket recreation. */
export class TfWebSocketRecoveryBudget {
  startedAt: number | null = null;
  attempts = 0;
  delayMs = INITIAL_RECONNECT_DELAY_MS;
  retryAt = 0;
  exhausted = false;
}

export class TfWebSocketLifecycle {
  private running = false;
  private attempt = 0;
  private timer: number | null = null;
  private socket: WebSocket | null = null;
  private abort: AbortController | null = null;
  private attemptTimer: number | null = null;
  private stableTimer: number | null = null;
  private readonly budget: TfWebSocketRecoveryBudget;
  private securityGeneration = 0;

  constructor(private readonly options: TfWebSocketLifecycleOptions) {
    this.budget = options.recoveryBudget ?? new TfWebSocketRecoveryBudget();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.options.successor)
      Object.assign(this.budget, new TfWebSocketRecoveryBudget());
    this.budget.startedAt ??= Date.now();
    this.securityGeneration = captureTfSecurityGeneration();
    const attempt = ++this.attempt;
    void this.connect(attempt);
  }

  stop(): void {
    this.running = false;
    this.attempt += 1;
    this.clearReconnectTimer();
    this.clearAttempt();

    const socket = this.socket;
    this.socket = null;
    if (socket !== null) this.detachSocket(socket, true);
  }

  private async connect(attempt: number): Promise<void> {
    if (!this.live(attempt)) return;
    if (
      this.options.successor &&
      (this.budget.exhausted ||
        this.budget.attempts >= 3 ||
        (this.budget.startedAt !== null &&
          Date.now() - this.budget.startedAt >= 60_000))
    ) {
      this.exhaust(attempt);
      return;
    }
    this.budget.attempts += 1;
    this.abort = new AbortController();
    if (this.options.successor)
      this.attemptTimer = window.setTimeout(() => {
        this.terminate(
          attempt,
          new TfApiError(503, "websocket_unavailable", "unavailable"),
        );
      }, 10_000);

    try {
      const ticket = await this.options.createTicket(this.abort.signal);
      if (!this.live(attempt)) return;

      const socket = this.options.createSocket(this.options.buildUrl(ticket));
      if (!this.live(attempt)) {
        this.detachSocket(socket, true);
        return;
      }

      this.socket = socket;
      let opened = false;
      socket.onopen = () => {
        if (!this.ownsSocket(attempt, socket)) return;
        opened = true;
        if (this.attemptTimer !== null) window.clearTimeout(this.attemptTimer);
        this.attemptTimer = null;
        if (this.options.successor)
          this.stableTimer = window.setTimeout(() => {
            if (!this.ownsSocket(attempt, socket)) return;
            Object.assign(this.budget, new TfWebSocketRecoveryBudget());
          }, 60_000);
        else this.budget.delayMs = INITIAL_RECONNECT_DELAY_MS;
      };
      socket.onmessage = (event) => {
        if (!this.ownsSocket(attempt, socket)) return;
        this.options.onMessage(event, () => this.ownsSocket(attempt, socket));
      };
      socket.onerror = () => {
        if (!this.ownsSocket(attempt, socket)) return;
        socket.close();
      };
      socket.onclose = (event) => {
        if (!this.ownsSocket(attempt, socket)) return;

        this.socket = null;
        this.detachSocket(socket, false);
        this.clearAttempt();

        const terminalError = terminalCloseError(event, this.options.successor);
        if (terminalError !== null) {
          this.terminate(attempt, terminalError);
          return;
        }
        if (!opened && !isClosePair(event, BUFFER_UNAVAILABLE_CLOSE)) {
          this.terminate(
            attempt,
            new TfApiError(503, "websocket_unavailable", "unavailable"),
          );
          return;
        }
        this.scheduleReconnect(attempt);
      };
    } catch (error) {
      if (!this.live(attempt)) return;
      this.clearAttempt();
      const apiError = normalizeTfApiError(error);
      if (
        this.options.successor &&
        apiError.kind === "unavailable" &&
        apiError.retryable &&
        this.options.onRetryableError
      ) {
        const delay = Math.max(
          this.budget.delayMs,
          Math.min(30_000, apiError.retryAfter * 1000),
        );
        this.budget.exhausted =
          this.budget.attempts >= 3 ||
          (this.budget.startedAt !== null &&
            Date.now() + delay - this.budget.startedAt >= 60_000);
        this.budget.delayMs = Math.min(
          this.budget.delayMs * 2,
          MAX_RECONNECT_DELAY_MS,
        );
        this.budget.retryAt = this.budget.exhausted
          ? Infinity
          : Date.now() + delay;
        // The provider owns suspension/revalidation; this generation's lifecycle is finished.
        const reported = new TfApiError(
          apiError.status,
          apiError.code,
          apiError.kind,
          true,
          this.securityGeneration,
          apiError.renewalProfile,
          apiError.retryAfter,
        );
        this.stop();
        this.options.onRetryableError(reported, this.budget.retryAt);
        return;
      }
      if (
        TERMINAL_ERROR_KINDS.has(apiError.kind) ||
        (this.options.successor &&
          ["expired", "invalid", "transport"].includes(apiError.kind))
      ) {
        this.terminate(attempt, apiError);
        return;
      }
      this.scheduleReconnect(attempt, apiError.retryAfter * 1000);
    }
  }

  private ownsSocket(attempt: number, socket: WebSocket): boolean {
    return this.live(attempt) && this.socket === socket;
  }
  private exhaust(attempt: number): void {
    if (!this.live(attempt)) return;
    this.budget.exhausted = true;
    this.budget.retryAt = Infinity;
    const error = new TfApiError(
      503,
      "websocket_unavailable",
      "unavailable",
      true,
      this.securityGeneration,
    );
    if (this.options.successor && this.options.onRetryableError) {
      this.stop();
      this.options.onRetryableError(error, Infinity);
    } else this.terminate(attempt, error);
  }
  private live(attempt: number): boolean {
    return (
      this.running &&
      attempt === this.attempt &&
      (!this.options.successor ||
        isCurrentTfSecurityGeneration(this.securityGeneration))
    );
  }
  private clearAttempt(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.attemptTimer !== null) window.clearTimeout(this.attemptTimer);
    if (this.stableTimer !== null) window.clearTimeout(this.stableTimer);
    this.attemptTimer = null;
    this.stableTimer = null;
  }

  private detachSocket(socket: WebSocket, close: boolean): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (close && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  }

  private terminate(attempt: number, error: TfApiError): void {
    if (!this.live(attempt)) return;

    this.running = false;
    this.attempt += 1;
    this.clearReconnectTimer();
    this.clearAttempt();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) this.detachSocket(socket, true);
    this.options.onTerminalError(
      this.options.successor
        ? new TfApiError(
            error.status,
            error.code,
            error.kind,
            error.retryable,
            this.securityGeneration,
            error.renewalProfile,
            error.retryAfter,
          )
        : error,
    );
  }

  private clearReconnectTimer(): void {
    if (this.timer === null) return;
    (this.options.cancelSchedule ?? window.clearTimeout)(this.timer);
    this.timer = null;
  }

  private scheduleReconnect(attempt: number, retryAfter = 0): void {
    if (!this.live(attempt) || this.timer !== null) return;
    this.budget.startedAt ??= Date.now();
    if (
      this.options.successor &&
      (this.budget.exhausted ||
        this.budget.attempts >= 3 ||
        Date.now() - this.budget.startedAt >= 60_000)
    ) {
      this.exhaust(attempt);
      return;
    }

    const delay = Math.max(this.budget.delayMs, Math.min(30_000, retryAfter));
    this.budget.delayMs = Math.min(
      (this.options.successor ? this.budget.delayMs : delay) * 2,
      MAX_RECONNECT_DELAY_MS,
    );
    this.timer = (this.options.schedule ?? window.setTimeout)(() => {
      this.timer = null;
      if (!this.running || attempt !== this.attempt) return;
      const nextAttempt = ++this.attempt;
      void this.connect(nextAttempt);
    }, delay);
  }
}

function terminalCloseError(
  event: CloseEvent,
  successor = false,
): TfApiError | null {
  if (
    successor &&
    isClosePair(event, { code: 4401, reason: "session_revoked" })
  )
    return new TfApiError(401, "session_revoked", "unauthenticated");
  if (
    successor &&
    isClosePair(event, { code: 4409, reason: "access_revalidation_required" })
  )
    return new TfApiError(401, "TF_RENEWAL_ACCESS_EXPIRED", "expired");
  if (successor && event.code === 1006)
    return new TfApiError(503, "websocket_unavailable", "unavailable");
  if (isClosePair(event, POLICY_REVOKED_CLOSE)) {
    return new TfApiError(403, POLICY_REVOKED_CLOSE.reason, "forbidden");
  }
  if (isClosePair(event, POLICY_UNAVAILABLE_CLOSE)) {
    return new TfApiError(503, POLICY_UNAVAILABLE_CLOSE.reason, "unavailable");
  }
  return null;
}

function isClosePair(
  event: CloseEvent,
  expected: { code: number; reason: string },
): boolean {
  return event.code === expected.code && event.reason === expected.reason;
}
