import {isRetryableRailError} from './rail-provider-recovery.mjs';
import {retryAfterMs} from './retry-after.mjs';

const DELAYS = [5_000,15_000,45_000];
const statusOf = error => Number(error?.status || /(?:returned|HTTP|AJAXError:)\s*(\d{3})\b/i.exec(String(error?.message ?? error))?.[1]);

export function flatFailure(error,retries,now) {
  const delay=DELAYS[retries];
  const retryAfter=Math.max(0,Number(error?.retryAfter)||0);
  const retryable=delay!==undefined&&isRetryableRailError(error);
  const transportError=/failed to fetch|fetch failed|networkerror|net::err_|connection (?:lost|reset|refused)/i.test(String(error?.message??error));
  return {error,due:retryable?now+Math.max(delay,retryAfter):Infinity,
    // A real reconnect warrants one prompt network retry, but never bypasses
    // a provider response, Retry-After, or the budget of subsequent attempts.
    reconnect:retryable&&retries===0&&transportError&&!retryAfter&&!Number.isFinite(statusOf(error))};
}

export const flatRetryDue = (failure,now,reconnect=false) =>
  Boolean(failure&&(failure.due<=now||reconnect&&failure.reconnect));

export function flatHttpError(response,type) {
  const error=new Error('Tile '+type+' returned '+response.status);
  error.status=response.status;
  error.retryAfter=retryAfterMs(response.headers?.get?.('retry-after'));
  return error;
}

export const canvasMapStatus = ({errors,loading,clamped,railFallback}) =>
  railFallback?'some railway tiles could not load. Neutral reference lines, where shown, do not show the selected view’s values.'
    : errors.length===1&&errors[0]==='bathymetry'?'bathymetry tiles could not load. Seabed shading may be incomplete.'
    : errors.length?'some visible tile data could not load.'
    : loading?'loading railway tiles…'
    : clamped?'the requested polar position is beyond the flat map edge.'
    :'drag or use the arrow keys to move.';
