import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import Home from "@/pages/Home";

const defaultSources = { yt: true, sc: true, bc: true, dz: true };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
let searchBodies: unknown[];

function AuthStatus() {
  return <span data-testid="auth-status">{useTfAuth().status}</span>;
}

function renderHome() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <TfAuthProvider>
        <AuthStatus />
        <Home />
      </TfAuthProvider>
    </QueryClientProvider>,
  );
}

async function search() {
  await waitFor(() =>
    expect(screen.getByTestId("auth-status")).toHaveTextContent(
      "authenticated",
    ),
  );
  fireEvent.change(screen.getByPlaceholderText("Трек или исполнитель"), {
    target: { value: "Unfamiliar song" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(searchBodies).toHaveLength(1));
  return searchBodies[0];
}

beforeEach(() => {
  clearTfSessionSecurityState();
  localStorage.clear();
  searchBodies = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    if (path.endsWith("/auth/me")) {
      const response = json({
        accountId: "11111111-1111-4111-8111-111111111111",
        installationId: "22222222-2222-4222-8222-222222222222",
        entitlements: ["tf.search"],
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        csrfToken: "a".repeat(42) + "A",
      });
      response.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return response;
    }
    if (path.endsWith("/free-search")) {
      searchBodies.push(JSON.parse(String(init?.body)));
      return json({ results: [], cached: false, sources: ["yt"] });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["null", "null"],
  [
    "missing source key",
    JSON.stringify({
      mode: "manual",
      sources: { yt: true, sc: false, bc: false },
    }),
  ],
  [
    "all sources disabled",
    JSON.stringify({
      mode: "manual",
      sources: { yt: false, sc: false, bc: false, dz: false },
    }),
  ],
])(
  "falls back from %s preferences to usable auto search",
  async (_name, stored) => {
    localStorage.setItem("tf_source_prefs", stored);
    renderHome();

    for (const label of ["YouTube", "SoundCloud", "Bandcamp", "Deezer"]) {
      expect(screen.getByLabelText(label)).toBeChecked();
    }
    expect(await search()).toMatchObject({
      query: "Unfamiliar song",
      mode: "auto",
    });
    expect(searchBodies[0]).not.toHaveProperty("sources");
  },
);

it("preserves a valid manual source choice", async () => {
  localStorage.setItem(
    "tf_source_prefs",
    JSON.stringify({
      mode: "manual",
      sources: { yt: false, sc: true, bc: false, dz: false },
    }),
  );
  renderHome();

  expect(screen.getByLabelText("SoundCloud")).toBeChecked();
  expect(screen.getByLabelText("YouTube")).not.toBeChecked();
  expect(await search()).toMatchObject({
    query: "Unfamiliar song",
    mode: "manual",
    sources: ["sc"],
  });
});

it("preserves a valid auto choice", async () => {
  localStorage.setItem(
    "tf_source_prefs",
    JSON.stringify({ mode: "auto", sources: defaultSources }),
  );
  renderHome();

  expect(screen.getByLabelText("YouTube")).toBeChecked();
  expect(await search()).toMatchObject({
    query: "Unfamiliar song",
    mode: "auto",
  });
  expect(searchBodies[0]).not.toHaveProperty("sources");
});

it("keeps an in-memory source choice when storage rejects writes", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === "tf_source_prefs")
      throw new DOMException("Blocked", "SecurityError");
    return setItem.call(this, key, value);
  });
  renderHome();
  await waitFor(() =>
    expect(screen.getByTestId("auth-status")).toHaveTextContent(
      "authenticated",
    ),
  );

  fireEvent.click(screen.getByLabelText("SoundCloud"));
  expect(screen.getByLabelText("SoundCloud")).not.toBeChecked();
  expect(await search()).toMatchObject({
    query: "Unfamiliar song",
    mode: "manual",
    sources: ["yt", "bc", "dz"],
  });
  expect(localStorage.getItem("tf_source_prefs")).toBeNull();
});
