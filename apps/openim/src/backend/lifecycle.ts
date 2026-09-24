// OpenIM's Go native library can loop in Node's default SIGINT/SIGTERM handler.
// Keep JS handlers installed until exit, including when shutdown is already pending.
export function installOpenIMShutdownHandlers(
  cleanup: () => void | Promise<void>,
  timeoutMs = 4_000,
) {
  let shutdownPromise: Promise<void> | null = null;

  function shutdown(): Promise<void> {
    if (!shutdownPromise) {
      setTimeout(() => {
        console.error("[OpenIM] Backend shutdown timed out; exiting");
        process.exit(1);
      }, timeoutMs);
      shutdownPromise = Promise.resolve().then(cleanup).then(
        () => process.exit(0),
        (error: unknown) => {
          console.error("[OpenIM] Backend shutdown failed", error);
          process.exit(1);
        },
      );
    }
    return shutdownPromise;
  }

  const exit = () => { void shutdown(); };
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
  return shutdown;
}
