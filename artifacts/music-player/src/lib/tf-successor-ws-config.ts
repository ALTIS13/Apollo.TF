/** Deployment opt-in only, never session or capability authority. */
export function successorWebSocketEnabled(): boolean {
  return import.meta.env.VITE_APOLLO_TF_SUCCESSOR_WS_ENABLED === "true";
}
