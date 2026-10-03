import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";
import { createRuntimeCatalogLookup, createRuntimeProviders, createRuntimeSourceMetadataLookup } from "./runtime-providers.js";

const runtimeProvidersPath = fileURLToPath(
  new URL("./runtime-providers.ts", import.meta.url),
);

it("provides a dedicated runtime provider selection boundary", async () => {
  await expect(access(runtimeProvidersPath)).resolves.toBeUndefined();
});

it("uses deterministic no-network providers only when fixture mode is enabled", async () => {
  const providers = createRuntimeProviders(true);

  expect(providers.map(({ source }) => source)).toEqual(["yt", "sc", "bc", "dz"]);
  for (const provider of providers) {
    await expect(provider.search("private query", 2)).resolves.toEqual([
      expect.objectContaining({
        id: `${provider.source}_fixture-track`,
        title: "Fixture Track",
        artist: "Fixture Artist",
        duration: 180,
        sourceUrl: `https://fixture.invalid/${provider.source}/fixture-track`,
      }),
    ]);
  }
});

it("selects the production provider adapters by default", () => {
  const providers = createRuntimeProviders(false);

  expect(providers.map(({ source }) => source)).toEqual(["yt", "sc", "bc", "dz"]);
  expect(providers.every(({ search }) => search.name !== "fixtureSearch")).toBe(
    true,
  );
});

it("keeps fixture catalog admission deterministic and network-free", async () => {
  const network = vi.fn(() => { throw new Error("unexpected network"); });
  vi.stubGlobal("fetch", network);
  try {
    await expect(createRuntimeCatalogLookup(true)("Artist Track", 10)).resolves.toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps cold source lookup unknown in fixture mode without inspecting external sources", async () => {
  const network = vi.fn(() => { throw new Error("unexpected network"); });
  vi.stubGlobal("fetch", network);
  try {
    await expect(createRuntimeSourceMetadataLookup(true)("https://www.youtube.com/watch?v=BaW_jenozKc"))
      .resolves.toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
