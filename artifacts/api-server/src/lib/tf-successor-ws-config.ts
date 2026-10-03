export function successorWebSocketEnabled(
  environment: NodeJS.ProcessEnv,
  renewal: boolean,
): boolean {
  const value = environment.APOLLO_TF_SUCCESSOR_WS_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value !== "true" || !renewal)
    throw new Error("TF successor WebSocket configuration is invalid");
  return true;
}
