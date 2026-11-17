// These timers run in Node, not in the renderer that may have stopped responding.
export async function withinDeadline(operation, label, timeout = 30000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(
        new Error(`${label} exceeded ${timeout} ms`), {code:'MAINLINE_DEADLINE'})), timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}

// A transport that never closes can retain Node handles after a rejected race.
// Attempt both closes independently, then fail the process rather than hanging.
export async function closeBrowser(context, browser, {timeout = 5000, primaryError, terminate = code => process.exit(code)} = {}) {
  const errors = [];
  for (const [label, close] of [['context close', () => context.close()], ['browser close', () => browser.close()]]) {
    try { await withinDeadline(close, label, timeout); }
    catch (error) { errors.push(error); console.error('MAINLINE_CLEANUP_FAILURE', error.message); }
  }
  if (errors.some(error => error.code === 'MAINLINE_DEADLINE')) terminate(1);
  if (errors.length) throw primaryError || new AggregateError(errors, 'Mainline browser cleanup failed');
}

// Covers setup/fetches and APIs without operation-level deadlines as well.
// It is a failure-only backstop; it never substitutes for geometry evidence.
export function armWatchdog(describe, {timeout = 30 * 60 * 1000, terminate = code => process.exit(code)} = {}) {
  const timer = setTimeout(() => {
    console.error('MAINLINE_CHECK_DEADLINE', JSON.stringify(describe()));
    terminate(1);
  }, timeout);
  timer.unref();
  return () => clearTimeout(timer);
}
