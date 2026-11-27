let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export function getCookie(name) {
  const prefix = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return '';
}

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function ensureCsrfToken() {
  let csrf = getCookie('csrf_token');
  if (!csrf) {
    const csrfRes = await fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const csrfData = await csrfRes.json().catch(() => ({}));
    csrf = getCookie('csrf_token') || csrfData.csrfToken || '';
  }
  return csrf;
}

/**
 * Fetch helper preserving backend CSRF, Idempotency-Key, no-store GET caching,
 * and automatic 401 refresh contracts.
 * Throws Error with the exact server error message on failure.
 */
export async function api(url, opts = {}, retryAuth = true) {
  const method = (opts.method || 'GET').toUpperCase();
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };

  if (isMutating) {
    if (!headers['X-CSRF-Token']) {
      headers['X-CSRF-Token'] = await ensureCsrfToken();
    }
    if (!headers['Idempotency-Key']) {
      headers['Idempotency-Key'] = generateIdempotencyKey();
    }
  }

  const fetchOpts = {
    credentials: 'same-origin',
    ...(method === 'GET' ? { cache: 'no-store' } : {}),
    ...opts,
    method,
    headers
  };

  if (isMutating && fetchOpts.body === undefined) {
    fetchOpts.body = JSON.stringify({});
  }

  const res = await fetch(url, fetchOpts);

  if (res.status === 401 && retryAuth && !url.startsWith('/api/auth/')) {
    const refreshCsrf = await ensureCsrfToken();
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': refreshCsrf,
        'Idempotency-Key': generateIdempotencyKey()
      },
      body: JSON.stringify({})
    });

    if (refreshed.ok) {
      return api(url, opts, false);
    }

    if (typeof unauthorizedHandler === 'function') {
      unauthorizedHandler();
    }
    throw new Error('Session expired. Please sign in again.');
  }

  const rawText = await res.text().catch(() => '');
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const serverMsg =
      payload.error ||
      payload.message ||
      (rawText && rawText.trim()) ||
      `Request failed (${res.status})`;
    throw new Error(serverMsg);
  }

  return payload;
}
