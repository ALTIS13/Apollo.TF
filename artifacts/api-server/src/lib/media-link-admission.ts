import type { MediaLinkResolution } from "./media-link.js";

export type MediaLinkAdmissionCode = "media_link_rate_limited" | "media_link_overloaded";

export class MediaLinkAdmissionError extends Error {
  constructor(readonly code: MediaLinkAdmissionCode, readonly retryAfterSeconds: number) {
    super(code);
    this.name = "MediaLinkAdmissionError";
  }
}

export interface MediaLinkAdmissionOptions {
  readonly maxActive?: number;
  readonly maxFollowersPerFlight?: number;
  readonly maxRequestsPerAccount?: number;
  readonly maxAccountStates?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

export type AdmitMediaLink = (
  accountId: string,
  inputUrl: string,
  task: () => Promise<MediaLinkResolution>,
) => Promise<MediaLinkResolution>;

export function createMediaLinkAdmission(options: MediaLinkAdmissionOptions = {}): AdmitMediaLink {
  const maxActive = options.maxActive ?? 2;
  const maxFollowersPerFlight = options.maxFollowersPerFlight ?? 8;
  const maxRequestsPerAccount = options.maxRequestsPerAccount ?? 6;
  const maxAccountStates = options.maxAccountStates ?? 256;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const accounts = new Map<string, { used: number; resetAt: number }>();
  const flights = new Map<string, { promise: Promise<MediaLinkResolution>; followers: number }>();
  let active = 0;

  return (accountId, inputUrl, task) => {
    const key = JSON.stringify([accountId, inputUrl]);
    const flight = flights.get(key);
    if (flight) {
      if (flight.followers >= maxFollowersPerFlight) {
        return Promise.reject(new MediaLinkAdmissionError("media_link_overloaded", 1));
      }
      flight.followers += 1;
      return flight.promise;
    }

    const currentTime = now();
    for (const [account, budget] of accounts) {
      if (budget.resetAt <= currentTime) accounts.delete(account);
    }
    const budget = accounts.get(accountId);
    if (budget && budget.used >= maxRequestsPerAccount) {
      return Promise.reject(new MediaLinkAdmissionError(
        "media_link_rate_limited",
        Math.max(1, Math.ceil((budget.resetAt - currentTime) / 1_000)),
      ));
    }
    if (active >= maxActive || (!budget && accounts.size >= maxAccountStates)) {
      return Promise.reject(new MediaLinkAdmissionError("media_link_overloaded", 1));
    }

    if (budget) budget.used += 1;
    else accounts.set(accountId, { used: 1, resetAt: currentTime + windowMs });
    active += 1;
    const promise = Promise.resolve().then(task).finally(() => {
      active -= 1;
      flights.delete(key);
    });
    flights.set(key, { promise, followers: 0 });
    return promise;
  };
}

export const admitMediaLink = createMediaLinkAdmission();
