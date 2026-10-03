import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  lyricsFeedbackStatusSchema,
  lyricsFeedbackTriageUpdateSchema,
  lyricsFeedbackTriageUpdateResultSchema,
  parseDashboardSnapshot,
  parseLyricsFeedbackList,
  parseLyricsFeedbackTriageList,
  type LyricsFeedbackStatus,
  type LyricsFeedbackTriageUpdate,
} from "@workspace/admin-dashboard-contract";
import {
  adminRequestTelemetry,
  createAdminDashboardSnapshot,
} from "../lib/admin-telemetry.js";
import { loadAdminDashboardToken } from "../lib/admin-dashboard-token.js";
import { moduleHeartbeatService } from "../lib/module-heartbeat.js";
import {
  loadRuntimeAdminAccountOverview,
  unavailableAdminAccountOverview,
} from "../lib/admin-account-overview-client.js";
import type { LyricsFeedbackUpdateOutcome } from "../lib/lyrics-feedback-store.js";

const DATABASE_PROBE_TIMEOUT_MS = 1_000;
const DATABASE_PROBE_CACHE_MS = 5_000;

interface CreateAdminRouterOptions {
  token?: string | null;
  loadSnapshot?: () => Promise<unknown>;
  loadLyricsFeedback?: () => Promise<unknown>;
  loadLyricsFeedbackTriage?: (status: LyricsFeedbackStatus, before: number | null) => Promise<unknown>;
  updateLyricsFeedback?: (
    id: number,
    input: LyricsFeedbackTriageUpdate,
    requestId: string,
  ) => Promise<LyricsFeedbackUpdateOutcome>;
}

interface CachedProbeOptions {
  ttlMs: number;
  now?: () => number;
}

export function isDashboardTokenValid(
  providedToken: string | undefined,
  expectedToken: string | null | undefined,
): boolean {
  if (!providedToken || !expectedToken) return false;

  const providedDigest = createHash("sha256").update(providedToken).digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function createCachedProbe(
  sourceProbe: () => Promise<boolean>,
  options: CachedProbeOptions,
): () => Promise<boolean> {
  const now = options.now ?? Date.now;
  const ttlMs = Math.max(0, options.ttlMs);
  let cachedAt: number | undefined;
  let cachedValue = false;
  let activeProbe: Promise<boolean> | undefined;

  return () => {
    const requestedAt = now();
    if (cachedAt !== undefined && requestedAt - cachedAt < ttlMs) {
      return Promise.resolve(cachedValue);
    }
    if (activeProbe !== undefined) return activeProbe;

    const nextProbe = Promise.resolve()
      .then(sourceProbe)
      .then((value) => {
        cachedValue = value;
        cachedAt = now();
        return value;
      })
      .finally(() => {
        if (activeProbe === nextProbe) activeProbe = undefined;
      });
    activeProbe = nextProbe;
    return nextProbe;
  };
}

const probeDatabase = createCachedProbe(
  async () => {
    try {
      const { probeDatabaseHealth } = await import("@workspace/db");
      return probeDatabaseHealth({ timeoutMs: DATABASE_PROBE_TIMEOUT_MS });
    } catch {
      return false;
    }
  },
  { ttlMs: DATABASE_PROBE_CACHE_MS },
);

function parseOptionalIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? undefined
    : new Date(timestamp).toISOString();
}

async function loadRuntimeSnapshot(): Promise<unknown> {
  const [queueTelemetry, { isRedisAvailable }, databaseReady, accountOverview] =
    await Promise.all([
      import("../lib/background-queue.js").then(
        ({ getDownloadQueueTelemetry }) => getDownloadQueueTelemetry(),
      ),
      import("../lib/redis.js"),
      probeDatabase(),
      loadRuntimeAdminAccountOverview(process.env).catch(
        () => unavailableAdminAccountOverview,
      ),
    ]);

  return createAdminDashboardSnapshot({
    now: () => new Date(),
    deployedAt: parseOptionalIsoDate(process.env["APOLLO_DEPLOYED_AT"]),
    version: process.env["APOLLO_API_VERSION"] ?? "unknown",
    telemetry: adminRequestTelemetry,
    getQueueTelemetry: async () => queueTelemetry,
    isDatabaseReady: () => databaseReady,
    isRedisAvailable,
    getModuleHeartbeats: () => moduleHeartbeatService.snapshot(),
    accountOverview,
  });
}

export function createAdminRouter(
  options: CreateAdminRouterOptions = {},
): IRouter {
  const router = Router();
  const configuredToken =
    options.token === undefined
      ? loadAdminDashboardToken(process.env)
      : options.token;
  const loadSnapshot = options.loadSnapshot ?? loadRuntimeSnapshot;
  const loadLyricsFeedback = options.loadLyricsFeedback ?? (async () => {
    const store = await import("../lib/lyrics-feedback-store.js");
    return store.loadLyricsFeedback();
  });
  const loadLyricsFeedbackTriage = options.loadLyricsFeedbackTriage ?? (async (
    status: LyricsFeedbackStatus,
    before: number | null,
  ) => {
    const store = await import("../lib/lyrics-feedback-store.js");
    return store.loadLyricsFeedbackTriage(status, before);
  });
  const updateLyricsFeedback = options.updateLyricsFeedback ?? (async (
    id: number,
    input: LyricsFeedbackTriageUpdate,
    requestId: string,
  ) => {
    const store = await import("../lib/lyrics-feedback-store.js");
    return store.updateLyricsFeedback(id, input, requestId);
  });

  router.get("/admin/dashboard", async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });

    if (!configuredToken) {
      res.status(503).json({ error: "admin_dashboard_disabled" });
      return;
    }

    if (
      !isDashboardTokenValid(
        req.get("X-Admin-Dashboard-Token"),
        configuredToken,
      )
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const snapshot = parseDashboardSnapshot(await loadSnapshot());
      res.status(200).json(snapshot);
    } catch (error) {
      req.log?.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Admin dashboard snapshot unavailable",
      );
      res.status(503).json({ error: "admin_dashboard_unavailable" });
    }
  });

  router.get("/admin/lyrics-feedback", async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (!configuredToken) {
      res.status(503).json({ error: "admin_dashboard_disabled" });
      return;
    }
    if (!isDashboardTokenValid(req.get("X-Admin-Dashboard-Token"), configuredToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      res.status(200).json(parseLyricsFeedbackList(await loadLyricsFeedback()));
    } catch (error) {
      req.log?.warn(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Admin lyrics feedback unavailable",
      );
      res.status(503).json({ error: "admin_lyrics_feedback_unavailable" });
    }
  });

  router.get("/admin/lyrics-feedback/triage", async (req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" });
    if (!configuredToken) {
      res.status(503).json({ error: "admin_dashboard_disabled" });
      return;
    }
    if (!isDashboardTokenValid(req.get("X-Admin-Dashboard-Token"), configuredToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const status = lyricsFeedbackStatusSchema.safeParse(req.query.status ?? "open");
    const beforeRaw = req.query.before;
    const before = typeof beforeRaw === "string" && /^[1-9]\d*$/.test(beforeRaw)
      ? Number(beforeRaw)
      : null;
    if (!status.success || (beforeRaw !== undefined && (!Number.isSafeInteger(before) || before === null))) {
      res.status(400).json({ error: "admin_lyrics_feedback_invalid_request" });
      return;
    }
    try {
      res.status(200).json(parseLyricsFeedbackTriageList(
        await loadLyricsFeedbackTriage(status.data, before),
      ));
    } catch (error) {
      req.log?.warn({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Admin lyrics triage unavailable");
      res.status(503).json({ error: "admin_lyrics_feedback_unavailable" });
    }
  });

  router.patch("/admin/lyrics-feedback/:id", async (req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" });
    if (!configuredToken) {
      res.status(503).json({ error: "admin_dashboard_disabled" });
      return;
    }
    if (!isDashboardTokenValid(req.get("X-Admin-Dashboard-Token"), configuredToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    const parsed = lyricsFeedbackTriageUpdateSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      res.status(400).json({ error: "admin_lyrics_feedback_invalid_request" });
      return;
    }
    const requestId = randomUUID();
    res.set("X-Request-ID", requestId);
    try {
      const result = await updateLyricsFeedback(id, parsed.data, requestId);
      if (result.kind === "not_found") {
        res.status(404).json({ error: "admin_lyrics_feedback_not_found" });
      } else if (result.kind === "conflict") {
        res.status(409).json({ error: "admin_lyrics_feedback_conflict" });
      } else {
        res.status(200).json(lyricsFeedbackTriageUpdateResultSchema.parse({
          schemaVersion: 1,
          report: result.report,
        }));
      }
    } catch (error) {
      req.log?.warn({ requestId, errorType: error instanceof Error ? error.name : "UnknownError" }, "Admin lyrics triage update unavailable");
      res.status(503).json({ error: "admin_lyrics_feedback_unavailable" });
    }
  });

  return router;
}

export const adminRouter = createAdminRouter();
