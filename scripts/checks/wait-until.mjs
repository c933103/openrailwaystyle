// page.waitForFunction treats the promise an async function returns as a
// truthy result, so an async condition (one that imports the app module to
// reach the map) returns at once without waiting. This polls the condition
// from Node instead, with waitForFunction's arguments and the page's default
// timeout (set through setDefaultTimeout below; Playwright's 30 s otherwise).
const defaults = new WeakMap();
export function setDefaultTimeout(page, timeout) {
  page.setDefaultTimeout(timeout);
  defaults.set(page, timeout);
}
export async function waitUntil(page, condition, arg, {timeout = defaults.get(page) ?? 30000, polling = 100} = {}) {
  const end = Date.now() + timeout;
  const timedOut = () => new Error(`Timed out after ${timeout} ms waiting for ${String(condition).replace(/\s+/g, ' ').slice(0, 160)}`);
  for (;;) {
    // A navigation can replace the page between polls; try again. An
    // evaluation that never settles (a stalled renderer) still ends at the
    // deadline.
    let timer;
    const value = await Promise.race([
      page.evaluate(condition, arg).catch(error => {
        if (/Execution context was destroyed|Cannot find context/.test(error.message)) return false;
        throw error;
      }),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(timedOut()), Math.max(0, end - Date.now())); }),
    ]).finally(() => clearTimeout(timer));
    if (value) return value;
    if (Date.now() > end) throw timedOut();
    await new Promise(resolve => setTimeout(resolve, typeof polling === 'number' ? polling : 100));
  }
}
