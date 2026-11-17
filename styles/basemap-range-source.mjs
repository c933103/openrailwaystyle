import {retryAfterMs} from './retry-after.mjs';
import {providerRetryDelay} from './provider-retry.mjs';

// PMTiles 4.2.1's FetchSource range/ETag contract, with response-header pauses
// retained across archive replacement. Based on its BSD-3-Clause implementation;
// the distribution includes vendor/pmtiles-4.2.1-LICENSE.txt.
// Pass the same PMTiles namespace that reads this source: its EtagMismatch
// constructor is part of the archive's bounded repair protocol.
export function createBasemapSourceFactory({FetchSource, EtagMismatch}, {
  fetcher = (...args) => fetch(...args), now = () => performance.now(), wallNow = Date.now,
  delay = providerRetryDelay,
} = {}) {
  const pauses = new Map();
  async function request(url, options) {
    const origin = new URL(url).origin;
    while ((pauses.get(origin) || 0) > now()) {
      options.signal.throwIfAborted();
      await delay(Math.min(2147483647, pauses.get(origin) - now()), options.signal);
    }
    options.signal.throwIfAborted();
    const response = await fetcher(url, options);
    const duration = retryAfterMs(response.headers.get('retry-after'), wallNow());
    if (duration > 0) pauses.set(origin, Math.max(pauses.get(origin) || 0, now() + duration));
    return response;
  }
  const discard = response => { Promise.resolve(response.body?.cancel()).catch(() => {}); };
  return url => new class extends FetchSource {
    async getBytes(offset, length, passedSignal, etag) {
      const controller = passedSignal ? null : new AbortController();
      const signal = passedSignal || controller.signal;
      const headers = new Headers(this.customHeaders);
      headers.set('range', `bytes=${offset}-${offset + length - 1}`);
      const cache = this.mustReload ? 'reload' : this.chromeWindowsNoCache ? 'no-store' : undefined;
      let response = await request(this.url, {signal, cache, headers});
      if (offset === 0 && response.status === 416) {
        const contentRange = response.headers.get('content-range');
        discard(response);
        if (!contentRange?.startsWith('bytes */')) throw new Error('Missing content-length on 416 response');
        response = await request(this.url, {signal, cache:'reload', headers:{range:`bytes=0-${Number(contentRange.slice(8)) - 1}`}});
      }
      let newEtag = response.headers.get('etag');
      if (newEtag?.startsWith('W/')) newEtag = null;
      if (response.status === 416 || (etag && newEtag && newEtag !== etag)) {
        this.mustReload = true; discard(response);
        throw new EtagMismatch(`Server returned non-matching ETag ${etag} after one retry. Check browser extensions and servers for issues that may affect correct ETag headers.`);
      }
      if (response.status >= 300) {
        discard(response);
        const error = new Error(`Bad response code: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const contentLength = response.headers.get('content-length');
      if (response.status === 200 && (!contentLength || Number(contentLength) > length)) {
        discard(response); controller?.abort();
        throw new Error('Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving.');
      }
      const data = await response.arrayBuffer();
      signal.throwIfAborted();
      return {data, etag:newEtag || undefined, cacheControl:response.headers.get('cache-control') || undefined, expires:response.headers.get('expires') || undefined};
    }
  }(url);
}
