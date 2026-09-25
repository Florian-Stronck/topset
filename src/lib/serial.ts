/**
 * Runs async jobs one at a time. A job that comes in while another runs waits for it, then
 * goes. `busy()` says whether one is running right now.
 */
export function serial() {
  let running: Promise<unknown> | null = null;

  function run<T>(job: () => Promise<T>): Promise<T> {
    const result = (running ?? Promise.resolve()).then(job, job);
    // Cleared only if nothing queued behind this one since; compared against the promise
    // actually stored, or the flag never clears and the queue looks busy forever.
    const tracked: Promise<unknown> = result.then(
      () => {
        if (running === tracked) running = null;
      },
      () => {
        if (running === tracked) running = null;
      },
    );
    running = tracked;
    return result;
  }

  return { run, busy: () => running !== null };
}
