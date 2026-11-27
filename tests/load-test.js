import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const errorRate = new Rate('errors');
const catalogLatency = new Trend('catalog_latency', true);
const stockLatency = new Trend('stock_latency', true);

export const options = {
  vus: 50,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.1'],
  },
};

function extractCookies(res, target = {}) {
  for (const [name, cookieList] of Object.entries(res.cookies || {})) {
    if (Array.isArray(cookieList) && cookieList.length > 0) {
      target[name] = cookieList[cookieList.length - 1].value;
    }
  }
  return target;
}

function authParams(data, method = 'GET', extraHeaders = {}) {
  const headers = Object.assign({}, extraHeaders);
  const upper = method.toUpperCase();
  if ((upper === 'POST' || upper === 'PATCH' || upper === 'PUT' || upper === 'DELETE') && data.csrfToken) {
    headers['X-CSRF-Token'] = data.csrfToken;
  }
  return {
    cookies: data.cookies || {},
    headers,
  };
}

// Setup: fetch CSRF cookie, login once, extract all cookies, and forward to VUs
export function setup() {
  // 1. Fetch CSRF cookie and token from /api/auth/csrf
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  if (csrfRes.status !== 200) {
    throw new Error(`CSRF fetch failed (HTTP ${csrfRes.status}): ${csrfRes.body}`);
  }

  const sessionCookies = extractCookies(csrfRes);
  let csrfToken = sessionCookies.csrf_token || '';
  if (!csrfToken) {
    try {
      csrfToken = csrfRes.json('csrfToken') || '';
    } catch {
      csrfToken = '';
    }
  }
  if (!csrfToken) {
    throw new Error(`Missing csrf_token cookie/token from /api/auth/csrf: ${csrfRes.body}`);
  }
  sessionCookies.csrf_token = csrfToken;

  // 2. Login with csrf_token cookie + X-CSRF-Token header
  const loginPayload = JSON.stringify({
    email: __ENV.ADMIN_EMAIL || 'admin@inventory.local',
    password: __ENV.ADMIN_PASSWORD || 'Adm!96a5de98ce219Z',
  });

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    loginPayload,
    authParams(
      { cookies: sessionCookies, csrfToken },
      'POST',
      { 'Content-Type': 'application/json' }
    )
  );

  console.log(`[setup] POST /api/auth/login -> status=${loginRes.status} body=${loginRes.body}`);

  if (loginRes.status !== 200) {
    throw new Error(`Login failed (HTTP ${loginRes.status}): ${loginRes.body}`);
  }

  // Extract all cookies (access_token, refresh_token, csrf_token) from res.cookies
  extractCookies(loginRes, sessionCookies);
  csrfToken = sessionCookies.csrf_token || csrfToken;

  if (!sessionCookies.access_token) {
    throw new Error('Login succeeded (HTTP 200) but access_token session cookie was not set');
  }

  // 3. Get item list to find a valid item ID for stock endpoint testing
  const itemsRes = http.get(
    `${BASE_URL}/api/items`,
    authParams({ cookies: sessionCookies, csrfToken }, 'GET')
  );
  let testItemId = 1;
  if (itemsRes.status === 200) {
    const items = JSON.parse(itemsRes.body);
    if (items.length > 0) {
      testItemId = items[0].id;
    }
  }

  return { authenticated: true, testItemId, cookies: sessionCookies, csrfToken };
}

export default function (data) {
  if (!data || !data.authenticated) {
    throw new Error('Aborting VU: setup() did not provide an authenticated session');
  }

  // Scenario 1: GET product catalog (read-heavy)
  const catalogStart = Date.now();
  const catalogRes = http.get(`${BASE_URL}/api/items`, authParams(data, 'GET'));
  catalogLatency.add(Date.now() - catalogStart);
  const catalogOk = check(catalogRes, {
    'catalog status 200': (r) => r.status === 200,
    'catalog returns array': (r) => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  });
  errorRate.add(!catalogOk);

  sleep(0.3);

  // Scenario 2: GET categories
  const catRes = http.get(`${BASE_URL}/api/categories`, authParams(data, 'GET'));
  check(catRes, { 'categories status 200': (r) => r.status === 200 });

  sleep(0.2);

  // Scenario 3: GET single item with stock (live stock query)
  const stockStart = Date.now();
  const stockRes = http.get(`${BASE_URL}/api/items/${data.testItemId}`, authParams(data, 'GET'));
  stockLatency.add(Date.now() - stockStart);
  const stockOk = check(stockRes, {
    'stock status 200': (r) => r.status === 200,
    'stock has quantity': (r) => {
      try { return JSON.parse(r.body).quantity !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!stockOk);

  sleep(0.3);

  // Scenario 4: GET analytics
  const analyticsRes = http.get(`${BASE_URL}/api/analytics`, authParams(data, 'GET'));
  check(analyticsRes, { 'analytics status 200': (r) => r.status === 200 });

  sleep(0.2);

  // Scenario 5: GET health probes (always available)
  const liveRes = http.get(`${BASE_URL}/health/live`, authParams(data, 'GET'));
  check(liveRes, { 'liveness 200': (r) => r.status === 200 });

  const readyRes = http.get(`${BASE_URL}/health/ready`, authParams(data, 'GET'));
  check(readyRes, { 'readiness 200': (r) => r.status === 200 });

  sleep(0.5);
}

// k6 built-in text summary
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const rps = data.metrics.http_reqs?.values?.rate?.toFixed(2) || 'N/A';
  const errRate = data.metrics.errors?.values?.rate?.toFixed(4) || 'N/A';
  
  console.log('\n=== Load Test Summary ===');
  console.log(`p95 Latency: ${p95}ms`);
  console.log(`RPS: ${rps}`);  
  console.log(`Error Rate: ${errRate}`);
  console.log('=========================\n');
  
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
