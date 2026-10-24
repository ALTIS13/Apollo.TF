export type RevokeDrainStatus = "drained" | "pending" | "unavailable";

/** The driver is the existing <=10-item consumer drain with bounded Redis/HTTP I/O. */
export function createRevokeScheduler(
  drain: () => Promise<Exclude<RevokeDrainStatus, "unavailable">>,
  report: (status: RevokeDrainStatus) => void,
  cancelTransport: () => void,
) {
  let started = false,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const emit = (status: RevokeDrainStatus) => {
    try {
      report(status);
    } catch {
      /* Logging must not strand the lifecycle. */
    }
  };
  const run = () => {
    timer = undefined;
    if (stopped || inFlight) return;
    inFlight = Promise.resolve()
      .then(async () => {
        if (!stopped) emit(await drain());
      })
      .catch(() => emit("unavailable"))
      .finally(() => {
        inFlight = undefined;
        if (!stopped) {
          timer = setTimeout(run, 30_000);
          timer.unref();
        }
      });
  };
  return {
    start() {
      if (started || stopped) return;
      started = true;
      run();
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      cancelTransport();
      stopping = inFlight ?? Promise.resolve();
      return stopping;
    },
  };
}
