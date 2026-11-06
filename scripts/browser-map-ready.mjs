// Keep the normal readiness gate and its original error. On failure, expose
// startup errors/status instead of leaving only a generic selector timeout.
export async function waitForMapReady(page, errors, {log = console.error} = {}) {
  try {
    await page.waitForSelector('body[data-map-ready="true"]', {state: 'attached', timeout: 60000});
  } catch (error) {
    let status = null;
    try { status = await page.locator('#status').textContent({timeout: 1000}); } catch {}
    try { log('MAP_STARTUP_DIAGNOSTIC', JSON.stringify({errors: [...errors], status})); } catch {}
    throw error;
  }
}
