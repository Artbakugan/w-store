const HTTP_DATE_FORMATS = [
  /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  /^[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/,
];

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

class RequestError extends Error {
  constructor({ error, code, details = [], requestId, status = null, transient = false }) {
    const http = status === null ? '' : `HTTP ${status} `;
    super(`${http}${error} [${code}] (reqId: ${requestId})`);
    Object.assign(this, { error, code, details, requestId, status, transient });
  }
}

function retryAfterMs(value, now) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : 0;
  }
  if (!HTTP_DATE_FORMATS.some((format) => format.test(value))) return 0;
  // The asctime format has no timezone field. HTTP dates are expressed in UTC.
  const timestamp = Date.parse(value.endsWith('GMT') ? value : value + ' GMT');
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

function createResilientClient({
  fetchRequest = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  now = Date.now,
  newRequestId = () => crypto.randomUUID(),
  onRetry = () => {},
} = {}) {
  async function attempt(url, options, headers, requestId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);

    let response;
    let text;
    try {
      response = await fetchRequest(url, { ...options, headers, signal: controller.signal });
      text = await response.text();
    } catch (err) {
      const timedOut = controller.signal.aborted;
      if (!timedOut && !(err instanceof TypeError)) throw err;
      throw new RequestError({
        error: timedOut ? 'Таймаут 1000 мс' : 'Мережева помилка',
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        requestId: response?.headers.get('X-Request-Id') || requestId,
        transient: true,
      });
    } finally {
      clearTimeout(timer);
    }

    requestId = response.headers.get('X-Request-Id') || requestId;
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new RequestError({
            error: 'Некоректна відповідь сервера',
            code: 'INVALID_RESPONSE',
            requestId,
            status: response.status,
          });
        }
      }
    }

    if (!response.ok) {
      const error = new RequestError({
        error: data?.error || response.statusText || 'Помилка HTTP',
        code: data?.code || `HTTP_${response.status}`,
        details: Array.isArray(data?.details) ? data.details : [],
        requestId,
        status: response.status,
        transient: isRetryableStatus(response.status),
      });
      error.retryAfter = response.headers.get('Retry-After');
      throw error;
    }

    return { data, requestId };
  }

  return async function fetchWithResilience(url, options = {}) {
    const headers = new Headers(options.headers);
    const method = (options.method || 'GET').toUpperCase();
    const canRetry = method === 'GET' || method === 'HEAD' ||
      (method === 'POST' && Boolean(headers.get('Idempotency-Key')?.trim()));

    for (let index = 0; ; index++) {
      const requestId = newRequestId();
      headers.set('X-Request-Id', requestId);
      try {
        return await attempt(url, options, headers, requestId);
      } catch (err) {
        if (!err.transient || !canRetry || index === 2) throw err;

        const backoff = 250 * (2 ** index);
        const serverDelay = retryAfterMs(err.retryAfter, now());
        const waitMs = Math.max(backoff, serverDelay) + Math.floor(random() * 100);
        onRetry({ error: err, retry: index + 1, waitMs, serverDelay });
        // Browser timers clamp values above a signed 32-bit integer.
        let remaining = waitMs;
        while (remaining > 2_147_483_647) {
          await sleep(2_147_483_647);
          remaining -= 2_147_483_647;
        }
        await sleep(remaining);
      }
    }
  };
}

function createDegradedMode(onChange, schedule = setTimeout) {
  let failures = 0;
  let active = false;

  return {
    get active() {
      return active;
    },
    record(failed) {
      if (active) return;
      failures = failed ? failures + 1 : 0;
      if (failures < 3) return;

      active = true;
      onChange(true);
      schedule(() => {
        failures = 0;
        active = false;
        onChange(false);
      }, 5000);
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createResilientClient, createDegradedMode };
}
