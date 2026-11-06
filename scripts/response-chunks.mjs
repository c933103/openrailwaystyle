// Stream transport only. Callers retain their existing byte accounting,
// limits and decisions about retries, subdivision and publication.
// Async iteration over a ReadableStream normally awaits cancellation on
// break/throw. That cleanup must not hold a budget error or checkpoint open.
export async function* responseChunks(response) {
  const reader = response.body.getReader();
  let complete = false;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) { complete = true; return; }
      yield value;
    }
  } finally {
    if (!complete) {
      try { reader.cancel().catch(() => {}); } catch { /* Preserve the caller's outcome. */ }
    }
    reader.releaseLock();
  }
}
