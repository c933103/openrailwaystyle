// Serialized by Playwright into the page. Keep the predicate self-contained.
// This fixture deliberately returns 503 for ORM, so both the error state and
// retryable, provider-specific warning must survive while references render.
export function mainlineOutageVisible() {
  const status = document.getElementById('map-status');
  return Boolean(status?.classList.contains('error') &&
    /^OpenRailwayMap (?:station|railway|station and track) data unavailable\. Retrying failed tiles\. Independent map references remain where available; detail may be missing\.$/.test(status.textContent));
}
