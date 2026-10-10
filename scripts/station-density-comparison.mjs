// Public MapLibre vector-source setters invalidate prior loaded/errored tiles.
// Reset both comparison pages before counting, including failures encountered
// while navigating or measuring an earlier view. Keep the same source URLs and
// templates; all requests still use the existing guarded station response cache.
export async function resetStationSources(map = window.reviewMap, {timeout = 120000} = {}) {
  // Protocol/request-pool errors may not reach the Node route again. Observe
  // each page too, so transport success cannot hide a protocol/decoding failure.
  if (!map.__atlasStationDensityState) {
    const state = {failures: 0};map.__atlasStationDensityState = state;
    map.on('error', event => {
      if (!['stationLow', 'stationMed'].includes(event.sourceId)) return;
      if (event.error?.name === 'AbortError' || event.error?.message === 'AbortError') return;
      state.failures++;
    });
  }
  const definitions = map.getStyle().sources;
  const sources = ['stationLow', 'stationMed'].map(id => {
    const source = map.getSource(id), definition = definitions[id];
    let update;
    if (typeof definition?.url === 'string' && typeof source?.setUrl === 'function') update = () => source.setUrl(definition.url);
    else if (Array.isArray(definition?.tiles) && typeof source?.setTiles === 'function') update = () => source.setTiles([...definition.tiles]);
    else throw new Error(`Station density source ${id} cannot be reset through its public API`);
    if (typeof source.on !== 'function' || typeof source.off !== 'function')
      throw new Error(`Station density source ${id} cannot report reset completion`);
    return {id, source, update};
  });
  const results = await Promise.allSettled(sources.map(({id, source, update}) => new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);source.off('data', changed);source.off('error', failed);
      if (error) reject(error);else resolve();
    };
    const changed = event => {
      if (event.dataType === 'source' && event.sourceDataType === 'content' && event.sourceDataChanged === true) finish();
    };
    const failed = event => finish(event.error || new Error(`Station density source ${id} reset failed`));
    const timer = setTimeout(() => finish(new Error(`Station density source ${id} did not confirm reset`)), timeout);
    source.on('data', changed);source.on('error', failed);
    try { update(); } catch (error) { finish(error); }
  })));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export function stationFailureCount(map = window.reviewMap) {
  return map.__atlasStationDensityState?.failures || 0;
}

// A failed baseline tile and a recovered after tile are not comparable. Retry
// the whole pair once, never just one page, and never publish a failed pair.
// Read the generation before resetting: reset-triggered failures count too.
export async function measureStationDensity({failureCount, reset, measure, onDiscard = () => {}}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const beforeFailures = await failureCount();
    let counts, error;
    try { await reset();counts = await measure(); }
    catch (caught) { error = caught; }
    const afterFailures = await failureCount();
    if (afterFailures === beforeFailures) {
      if (error) throw error;
      return counts;
    }
    await onDiscard({attempt, beforeFailures, afterFailures, counts, measurementError: Boolean(error)});
    if (attempt === 2) throw new Error('Station density comparison failed after two paired attempts; unequal inputs were discarded', {cause: error});
  }
}
