import assert from 'node:assert/strict';

// Controls inside the counter-scaled map already occupy viewport CSS pixels.
// Verify visibility, stability and hit targeting ourselves, then send a real
// pointer click. No forced/DOM click and no scroll-into-view protocol call.
export async function clickVisibleControl(page, selector, timeout = 5000) {
  const point = () => page.evaluate(selector => {
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
  }, selector);
  const same = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.5);
  const deadline = Date.now() + timeout;
  let previous;
  do {
    const current = await point();
    if (same(previous, current)) {
      // Hover can expose an overlay. Recheck the actual target after moving.
      await page.mouse.move(current.x, current.y);
      if (same(current, await point())) {
        await page.mouse.click(current.x, current.y);
        return;
      }
    }
    previous = current;
    await page.waitForTimeout(25);
  } while (Date.now() < deadline);
  assert.fail(`Control is not visible, stable, enabled and unobscured: ${selector}`);
}
