import { expect, it } from "vitest";
import { successorWebSocketEnabled } from "./tf-successor-ws-config.js";
it("is default-off and requires renewal composition for explicit enable", () => {
  expect(successorWebSocketEnabled({}, false)).toBe(false);
  expect(
    successorWebSocketEnabled(
      { APOLLO_TF_SUCCESSOR_WS_ENABLED: "false" },
      true,
    ),
  ).toBe(false);
  expect(
    successorWebSocketEnabled({ APOLLO_TF_SUCCESSOR_WS_ENABLED: "true" }, true),
  ).toBe(true);
  expect(() =>
    successorWebSocketEnabled(
      { APOLLO_TF_SUCCESSOR_WS_ENABLED: "true" },
      false,
    ),
  ).toThrow();
  for (const value of ["", "1", "TRUE", " true", "secret-like-invalid"])
    expect(() =>
      successorWebSocketEnabled(
        { APOLLO_TF_SUCCESSOR_WS_ENABLED: value },
        true,
      ),
    ).toThrow("TF successor WebSocket configuration is invalid");
});
