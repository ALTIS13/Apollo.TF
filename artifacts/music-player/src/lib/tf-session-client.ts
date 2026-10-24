import { API_BASE, apiUrl } from "./api-config";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_32_BYTE_BASE64URL_PATTERN =
  /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

let csrfToken: string | null = null;
let securityGeneration = 0;
let securitySession: TfBrowserSession | null = null;
let accessBlocked: TfApiError | null = null;
let playbackActive = false;
const activityListeners = new Set<() => void>();
export function subscribeTfActivitySuspension(
  listener: () => void,
): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}
export function setTfPlaybackActive(active: boolean): void {
  playbackActive = active;
}
export function isTfPlaybackActive(): boolean {
  return playbackActive;
}
export function captureTfSecurityGeneration(): number {
  return securityGeneration;
}
export function isCurrentTfSecurityGeneration(generation: number): boolean {
  return generation === securityGeneration;
}
export function suspendTfProtectedActivity(error: TfApiError): void {
  accessBlocked = error;
  securityGeneration += 1;
  for (const listener of [...activityListeners]) listener();
}
export function canUseTfProtectedActivity(expectedSession?: TfBrowserSession | null): boolean {
  return (
    securitySession !== null &&
    (expectedSession === undefined || securitySession === expectedSession) &&
    accessBlocked === null &&
    Date.parse(securitySession.expiresAt) > Date.now()
  );
}

export interface TfBrowserSession {
  accountId: string;
  installationId: string;
  entitlements: string[];
  expiresAt: string;
  csrfToken: string;
  /** Local adapter metadata from the response header, never a wire/body field. */
  renewalProfile?: "renewal-v1";
}

export type TfApiErrorKind =
  | "provider"
  | "unauthenticated"
  | "forbidden"
  | "unavailable"
  | "invalid"
  | "transport"
  | "expired";

export class TfApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly kind: TfApiErrorKind,
    readonly retryable = false,
    readonly generation?: number,
    readonly renewalProfile?: "renewal-v1",
    readonly retryAfter = 1,
  ) {
    super(code);
    this.name = "TfApiError";
  }
}

export type TfAuthSecurityEvent =
  | {
      type: "invalidated" | "revalidate" | "expired" | "unavailable";
      error: TfApiError;
    }
  | { type: "ws-recovery"; error: TfApiError; notBefore: number };

type TfAuthSecurityListener = (event: TfAuthSecurityEvent) => void;

const CORE_POLICY_ERROR_CODES = new Set([
  "module_access_denied",
  "policy_revoked",
  "policy_unavailable",
  "websocket_unavailable",
]);
const authSecurityListeners = new Set<TfAuthSecurityListener>();

export function subscribeTfAuthSecurityEvents(
  listener: TfAuthSecurityListener,
): () => void {
  authSecurityListeners.add(listener);
  let subscribed = true;

  return () => {
    if (!subscribed) return;
    subscribed = false;
    authSecurityListeners.delete(listener);
  };
}

export function reportTfAuthError(error: unknown): boolean {
  const apiError = toReportedTfApiError(error);
  if (apiError === null) return false;
  if (
    apiError.generation !== undefined &&
    apiError.generation !== securityGeneration
  )
    return false;

  const type =
    apiError.kind === "expired"
      ? "expired"
      : apiError.kind === "unauthenticated"
        ? "invalidated"
        : apiError.kind === "forbidden"
          ? "revalidate"
          : CORE_POLICY_ERROR_CODES.has(apiError.code) ||
              ["unavailable", "transport", "invalid"].includes(apiError.kind)
            ? "unavailable"
            : null;
  if (type === null) return false;

  suspendTfProtectedActivity(apiError);

  const event: TfAuthSecurityEvent = { type, error: apiError };
  for (const listener of [...authSecurityListeners]) {
    listener(event);
  }
  return true;
}

/** Local coordination only: no authority is restored until the provider revalidates. */
export function reportTfWebSocketRecovery(
  error: TfApiError,
  notBefore: number,
): void {
  if (
    error.generation === undefined ||
    !isCurrentTfSecurityGeneration(error.generation)
  )
    return;
  if (
    error.kind !== "unavailable" ||
    !error.retryable ||
    Number.isNaN(notBefore) ||
    notBefore < Date.now()
  )
    return;
  suspendTfProtectedActivity(error);
  for (const listener of [...authSecurityListeners])
    listener({ type: "ws-recovery", error, notBefore });
}

function toReportedTfApiError(error: unknown): TfApiError | null {
  if (error instanceof TfApiError) return error;
  if (!isRecord(error) || typeof error.status !== "number") return null;

  const data = isRecord(error.data) ? error.data : null;
  if (data && "code" in data)
    return localRenewalError(
      {
        status: error.status,
        headers:
          error.headers instanceof Headers ? error.headers : new Headers(),
      },
      data,
    );
  const code =
    typeof error.code === "string"
      ? error.code
      : data && typeof data.error === "string"
        ? data.error
        : null;

  if (error.status === 401) {
    return new TfApiError(401, code ?? "unauthorized", "unauthenticated");
  }
  if (error.status === 403 && code === "module_access_denied") {
    return new TfApiError(403, code, "forbidden");
  }
  if (error.status === 503 && code === "policy_unavailable") {
    return new TfApiError(503, code, "unavailable");
  }
  return null;
}

export function normalizeTfApiError(error: unknown): TfApiError {
  return error instanceof TfApiError
    ? error
    : new TfApiError(0, "transport_unavailable", "transport");
}

export function clearTfSessionSecurityState(): void {
  securityGeneration += 1;
  csrfToken = null;
  securitySession = null;
  accessBlocked = new TfApiError(401, "unauthorized", "unauthenticated");
  playbackActive = false;
  for (const listener of [...activityListeners]) listener();
}

export function tfRequestInit(init: RequestInit = {}): RequestInit {
  if (!canUseTfProtectedActivity()) {
    const error =
      accessBlocked ??
      new TfApiError(
        401,
        securitySession?.renewalProfile
          ? "TF_RENEWAL_ACCESS_EXPIRED"
          : "unauthorized",
        securitySession?.renewalProfile ? "expired" : "unauthenticated",
      );
    if (!accessBlocked) reportTfAuthError(error);
    throw error;
  }
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (UNSAFE_METHODS.has(method)) {
    if (csrfToken === null) {
      throw new TfApiError(0, "csrf_unavailable", "unauthenticated");
    }
    headers.set("X-CSRF-Token", csrfToken);
  }

  return {
    ...init,
    method,
    credentials: "include",
    headers: Object.fromEntries(headers.entries()),
  };
}

export async function tfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const generation = securityGeneration;
  const requestInit = tfRequestInit(init);
  let response: Response;

  try {
    response = await fetch(apiUrl(path), requestInit);
  } catch (error) {
    throw normalizeTfApiError(error);
  }

  if (!response.ok) {
    const body = await parseJson(response).catch(() => undefined);
    const code =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : "invalid_response";
    const kind =
      response.status === 401 && code === "not_connected" &&
      /^\/spotify\/(?:liked(?:-all)?|playlists(?:\/[^/?]+\/tracks)?|top-tracks)(?:\?|$)/.test(path)
        ? "provider"
        : response.status === 401
          ? "unauthenticated"
          : response.status === 403
            ? "forbidden"
            : response.status === 503
              ? "unavailable"
              : "invalid";
    const apiError =
      isRecord(body) && "code" in body
        ? localRenewalError(response, body, generation)
        : new TfApiError(response.status, code, kind, false, generation);
    reportTfAuthError(apiError);
    throw apiError;
  }

  try {
    const body = (await parseJson(response)) as T;
    if (!isCurrentTfSecurityGeneration(generation))
      throw new TfApiError(0, "stale_response", "invalid", false, generation);
    return body;
  } catch (error) {
    throw normalizeTfApiError(error);
  }
}

export async function fetchTfSession(
  signal?: AbortSignal,
): Promise<TfBrowserSession> {
  let response: Response;

  try {
    response = await fetch(apiUrl("/auth/me"), {
      method: "GET",
      credentials: "include",
      signal,
      cache: "no-store",
    });
  } catch (error) {
    throw normalizeTfApiError(error);
  }

  if (!response.ok) {
    const body = await parseJson(response).catch(() => undefined);
    const expectedError: Record<number, string> = {
      401: "unauthorized",
      403: "forbidden",
      503: "authentication_unavailable",
    };
    if (
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      body.error !== expectedError[response.status]
    ) {
      throw new TfApiError(
        response.status,
        "invalid_session_response",
        "invalid",
      );
    }
    const code =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : "invalid_response";
    const kind =
      response.status === 401
        ? "unauthenticated"
        : response.status === 403
          ? "forbidden"
          : response.status === 503
            ? "unavailable"
            : "invalid";
    throw new TfApiError(
      response.status,
      code,
      kind,
      response.status === 503,
      undefined,
      response.headers.get("Apollo-TF-Session-Profile") === "renewal-v1"
        ? "renewal-v1"
        : undefined,
    );
  }

  let session: unknown;
  try {
    session = await parseJson(response);
  } catch (error) {
    throw normalizeTfApiError(error);
  }

  if (!isTfBrowserSession(session)) {
    throw new TfApiError(200, "invalid_session", "invalid");
  }

  // Never trust a similarly named body field as profile negotiation.
  const { accountId, installationId, entitlements, expiresAt, csrfToken } =
    session;
  return {
    accountId,
    installationId,
    entitlements,
    expiresAt,
    csrfToken,
    ...(response.headers.get("Apollo-TF-Session-Profile") === "renewal-v1"
      ? { renewalProfile: "renewal-v1" as const }
      : {}),
  };
}

export function commitTfSessionSecurityState(session: TfBrowserSession): void {
  if (!isTfBrowserSession(session)) {
    clearTfSessionSecurityState();
    throw new TfApiError(200, "invalid_session", "invalid");
  }

  csrfToken = session.csrfToken;
  securityGeneration += 1;
  securitySession = session;
  accessBlocked = null;
}

const RENEWAL_ERRORS: Record<
  string,
  readonly [number[], boolean, TfApiErrorKind]
> = {
  INVALID_REQUEST: [[400, 405, 413, 415, 503], false, "invalid"],
  UNSUPPORTED_VERSION: [[503], false, "invalid"],
  INVALID_CLIENT: [[503], false, "unavailable"],
  INVALID_REFERENCE: [[401], false, "unauthenticated"],
  SESSION_REVOKED: [[401], false, "unauthenticated"],
  FAMILY_EXPIRED: [[401], false, "unauthenticated"],
  REAUTH_REQUIRED: [[401], false, "unauthenticated"],
  ACCESS_EXPIRED: [[401], false, "expired"],
  ACCESS_DENIED: [[403], false, "forbidden"],
  POLICY_CHANGED: [[403], false, "forbidden"],
  CSRF_REJECTED: [[403], false, "invalid"],
  IDEMPOTENCY_CONFLICT: [[409], false, "unauthenticated"],
  REFERENCE_SPENT: [[409], false, "unauthenticated"],
  RETRY_EXPIRED: [[409], false, "unauthenticated"],
  OPERATION_IN_PROGRESS: [[409], true, "unavailable"],
  RATE_LIMITED: [[429], true, "unavailable"],
  AUTHORITY_UNAVAILABLE: [[503], true, "unavailable"],
  OPERATION_UNCERTAIN: [[503], true, "unavailable"],
};

function localRenewalError(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
  generation?: number,
): TfApiError {
  const code = isRecord(body) && typeof body.code === "string" ? body.code : "";
  const reason = code.slice(11);
  const spec =
    code.startsWith("TF_RENEWAL_") && Object.hasOwn(RENEWAL_ERRORS, reason)
      ? RENEWAL_ERRORS[reason]
      : undefined;
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 2 ||
    !spec ||
    !spec[0].includes(response.status) ||
    body.retryable !== spec[1]
  ) {
    return new TfApiError(
      response.status,
      "invalid_renewal_response",
      "invalid",
      false,
      generation,
    );
  }
  const retry = response.headers.get("Retry-After");
  const retryAfter =
    retry && /^(?:[1-9]|[12][0-9]|30)$/.test(retry) ? Number(retry) : 1;
  return new TfApiError(
    response.status,
    code,
    spec[2],
    spec[1],
    generation,
    undefined,
    retryAfter,
  );
}
async function renewalRequest(
  path: string,
  signal?: AbortSignal,
  csrf?: string,
): Promise<Response> {
  let response: Response;
  try {
    signal?.throwIfAborted();
    response = await fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: "{}",
    });
  } catch (error) {
    throw normalizeTfApiError(error);
  }
  if (response.ok) return response;
  throw localRenewalError(
    response,
    await parseLocalRenewalBody(response).catch(() => undefined),
  );
}

async function parseLocalRenewalBody(response: Response): Promise<unknown> {
  if (
    response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return undefined;
  const source = await response.text();
  if (source.length > 2048) return undefined;
  const result: unknown = JSON.parse(source);
  // These local DTOs are flat objects. Retain duplicate-member evidence before JSON.parse collapses it.
  const keys = new Set<string>();
  const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i + 1] !== ":" || !tokens[i].startsWith('"')) continue;
    const key = JSON.parse(tokens[i]) as string;
    if (keys.has(key)) return undefined;
    keys.add(key);
  }
  return result;
}

export async function renewTfSession(signal?: AbortSignal): Promise<void> {
  const response = await renewalRequest("/auth/renew-context", signal);
  const body = await parseLocalRenewalBody(response).catch(() => undefined);
  if (
    response.status !== 200 ||
    !isRecord(body) ||
    Object.keys(body).length !== 1 ||
    typeof body.csrf_token !== "string" ||
    !CANONICAL_32_BYTE_BASE64URL_PATTERN.test(body.csrf_token)
  ) {
    throw new TfApiError(response.status, "invalid_renewal_context", "invalid");
  }
  signal?.throwIfAborted();
  const renewed = await renewalRequest("/auth/renew", signal, body.csrf_token);
  if (renewed.status !== 204)
    throw new TfApiError(renewed.status, "invalid_renewal_response", "invalid");
}

export function startTfLogin(): void {
  window.location.assign(apiUrl("/auth/start"));
}

export async function logoutTfSession(): Promise<void> {
  if (!csrfToken)
    throw new TfApiError(401, "csrf_unavailable", "unauthenticated");
  // Capture before local signout; logout remains allowed while short access is suspended.
  await fetch(apiUrl("/auth/logout"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: "{}",
  });
}

export async function createWebSocketTicket(
  signal?: AbortSignal,
): Promise<string> {
  const generation = captureTfSecurityGeneration();
  try {
    signal?.throwIfAborted();
    const response = await fetch(
      apiUrl("/ws/tickets"),
      tfRequestInit({ method: "POST", signal }),
    );
    const body = await parseLocalRenewalBody(response);
    if (!isCurrentTfSecurityGeneration(generation) || signal?.aborted)
      throw new TfApiError(0, "stale_response", "invalid", false, generation);
    if (!response.ok) {
      if (isRecord(body) && "code" in body)
        throw localRenewalError(response, body, generation);
      throw new TfApiError(
        response.status,
        "websocket_unavailable",
        response.status === 401
          ? "unauthenticated"
          : response.status === 403
            ? "forbidden"
            : "unavailable",
        false,
        generation,
      );
    }
    if (
      response.status !== 201 ||
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.ticket !== "string" ||
      !CANONICAL_32_BYTE_BASE64URL_PATTERN.test(body.ticket)
    )
      throw new TfApiError(
        response.status,
        "invalid_websocket_ticket",
        "invalid",
        false,
        generation,
      );
    return body.ticket;
  } catch (error) {
    const e = normalizeTfApiError(error);
    throw new TfApiError(
      e.status,
      e.code,
      e.kind,
      e.retryable,
      generation,
      e.renewalProfile,
      e.retryAfter,
    );
  }
}

export function buildTfWebSocketUrl(ticket: string): string {
  if (
    !TICKET_PATTERN.test(ticket) ||
    !CANONICAL_32_BYTE_BASE64URL_PATTERN.test(ticket)
  )
    throw new TfApiError(0, "invalid_websocket_ticket", "invalid");
  const url = new URL(API_BASE, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = `ticket=${encodeURIComponent(ticket)}`;
  return url.toString();
}

async function parseJson(response: Response): Promise<unknown> {
  if (
    response.status === 204 ||
    !response.headers.get("Content-Type")?.includes("application/json")
  ) {
    return undefined;
  }

  return response.json();
}

function isTfBrowserSession(value: unknown): value is TfBrowserSession {
  const expiresAt =
    isRecord(value) && typeof value.expiresAt === "string"
      ? Date.parse(value.expiresAt)
      : Number.NaN;

  return (
    isRecord(value) &&
    typeof value.accountId === "string" &&
    UUID_PATTERN.test(value.accountId) &&
    typeof value.installationId === "string" &&
    UUID_PATTERN.test(value.installationId) &&
    Array.isArray(value.entitlements) &&
    value.entitlements.every(
      (entitlement) => typeof entitlement === "string",
    ) &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() &&
    typeof value.csrfToken === "string" &&
    CANONICAL_32_BYTE_BASE64URL_PATTERN.test(value.csrfToken)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
