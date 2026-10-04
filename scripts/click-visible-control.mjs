import assert from 'node:assert/strict';

// Controls inside the counter-scaled map already occupy viewport CSS pixels.
// Verify visibility, stability and hit targeting on consecutive animation
// frames before real pointer input. DOM geometry can settle before Chromium's
// input hit testing catches up with the counter-scaled control container.
// No forced/DOM click and no scroll-into-view protocol call.
// Three frame checks plus pointer input share the page's 10-second action
// budget; software-rendered CI frames can take about two seconds each. The
// caller separately checks the resulting state within five seconds.
export async function clickVisibleControl(page, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  const message = `Control is not visible, stable, enabled and unobscured: ${selector}`;
  const withinDeadline = async (promise, phase) => {
    const phaseStarted = Date.now();
    let timer;
    try {
      return await Promise.race([promise, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new assert.AssertionError({message: `${message} (${timeout} ms budget expired during ${phase}; ${Date.now() - phaseStarted} ms in this phase)`})), Math.max(0, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  const point = () => withinDeadline(page.evaluate(async selector => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const elements = document.querySelectorAll(selector);
    if (elements.length !== 1) return null;
    const element = elements[0], rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' ||
        style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 ||
        rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 ||
        rect.right > innerWidth || rect.bottom > innerHeight ||
        !element.contains(document.elementFromPoint(x, y))) return null;
    return {x, y, width: rect.width, height: rect.height};
  }, selector), 'animation frame and hit test');
  const same = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.5);
  let previous;
  do {
    const current = await point();
    if (same(previous, current)) {
      // Hover can expose an overlay. Recheck the actual target after moving.
      await withinDeadline(page.mouse.move(current.x, current.y), 'pointer hover');
      if (same(current, await point())) {
        await withinDeadline(page.mouse.click(current.x, current.y), 'pointer click');
        return;
      }
    }
    previous = current;
  } while (Date.now() < deadline);
  assert.fail(message);
}
