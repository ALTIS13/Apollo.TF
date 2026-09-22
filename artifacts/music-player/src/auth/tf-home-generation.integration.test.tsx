import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Home from "@/pages/Home";
import { PlayerProvider } from "@/hooks/use-player";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import { TfSessionBoundary } from "./TfSessionBoundary";

const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
let identity: string;
let auth: TfAuthContextValue;
let finishSearch: (response: Response) => void;
let searchStarted: boolean;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function Controls() {
  auth = useTfAuth();
  return (
    <span data-testid="account">
      {auth.status}:{auth.session?.accountId}
    </span>
  );
}
class ControlledAudio extends EventTarget {
  currentTime = 0;
  duration = 500;
  volume = 0.8;
  src = "";
  paused = true;
  pause() {
    this.paused = true;
  }
  load() {}
}
beforeEach(() => {
  clearTfSessionSecurityState();
  identity = A;
  searchStarted = false;
  vi.stubGlobal("Audio", ControlledAudio);
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    if (path.endsWith("/auth/me")) {
      const response = json({
        accountId: identity,
        installationId: "22222222-2222-4222-8222-222222222222",
        entitlements: ["tf.search", "tf.collections"],
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        csrfToken: "a".repeat(42) + "A",
      });
      response.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return response;
    }
    if (path.endsWith("/search")) {
      searchStarted = true;
      return new Promise<Response>((resolve) => {
        finishSearch = resolve;
      });
    }
    throw new Error(`Unexpected controlled request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});
async function startSearch() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <TfAuthProvider>
        <Controls />
        <TfSessionBoundary>
          <PlayerProvider>
            <Home />
          </PlayerProvider>
        </TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Artist name..."), {
    target: { value: "Artist" },
  });
  fireEvent.change(screen.getByPlaceholderText("Track title..."), {
    target: { value: "Title" },
  });
  fireEvent.submit(
    screen.getByPlaceholderText("Artist name...").closest("form")!,
  );
  await waitFor(() => expect(searchStarted).toBe(true));
}
async function settleSearch(response: Response) {
  await act(async () => {
    finishSearch(response);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("rendered Home ignores the generated client's delayed A401 after B becomes active", async () => {
  await startSearch();
  identity = B;
  await act(async () => {
    await auth.refresh();
  });
  expect(auth.session?.accountId).toBe(B);
  await settleSearch(json({ error: "unauthorized" }, 401));
  expect(auth.status).toBe("authenticated");
  expect(auth.session?.accountId).toBe(B);
  expect(screen.getByPlaceholderText("Artist name...")).toBeTruthy();
});
it("rendered Home cannot publish an old success after same-account generation renewal", async () => {
  await startSearch();
  await act(async () => {
    await auth.refresh();
  });
  await settleSearch(
    json({
      results: [
        {
          id: "old-a",
          title: "Stale A result",
          artist: "Old artist",
          duration: 50,
          thumbnailUrl: null,
          source: "youtube",
          type: "original",
          quality: [],
          score: 1,
        },
      ],
      cached: false,
      sources: ["yt"],
    }),
  );
  expect(auth.status).toBe("authenticated");
  expect(screen.queryByText("Stale A result")).toBeNull();
});
it("rendered Home still invalidates the current generation on a genuine current401", async () => {
  await startSearch();
  await settleSearch(json({ error: "unauthorized" }, 401));
  expect(auth.status).toBe("unauthenticated");
});
