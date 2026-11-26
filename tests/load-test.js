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

// Setup: login once and return auth cookies + a test item ID
export function setup() {
  // Get CSRF token
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  const csrfCookies = csrfRes.cookies;

  // Login  
  const loginPayload = JSON.stringify({
    email: __ENV.ADMIN_EMAIL || 'admin@inventory.local',
    password: __ENV.ADMIN_PASSWORD || 'Adm!96a5de98ce219Z',
  });

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfCookies.csrf_token ? csrfCookies.csrf_token[0].value : '',
    },
  });

  if (loginRes.status !== 200) {
    console.error(`Login failed: ${loginRes.status} ${loginRes.body}`);
    return { authenticated: false };
  }

  // Get item list to find a valid item ID for stock endpoint testing
  const itemsRes = http.get(`${BASE_URL}/api/items`);
  let testItemId = 1;
  if (itemsRes.status === 200) {
    const items = JSON.parse(itemsRes.body);
    if (items.length > 0) {
      testItemId = items[0].id;
    }
  }

  return { authenticated: true, testItemId };
}

export default function (data) {
  if (!data.authenticated) {
    console.error('Skipping: not authenticated');
    return;
  }

  // Scenario 1: GET product catalog (read-heavy)
  const catalogStart = Date.now();
  const catalogRes = http.get(`${BASE_URL}/api/items`);
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
  const catRes = http.get(`${BASE_URL}/api/categories`);
  check(catRes, { 'categories status 200': (r) => r.status === 200 });

  sleep(0.2);

  // Scenario 3: GET single item with stock (live stock query)
  const stockStart = Date.now();
  const stockRes = http.get(`${BASE_URL}/api/items/${data.testItemId}`);
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
  const analyticsRes = http.get(`${BASE_URL}/api/analytics`);
  check(analyticsRes, { 'analytics status 200': (r) => r.status === 200 });

  sleep(0.2);

  // Scenario 5: GET health probes (always available)
  const liveRes = http.get(`${BASE_URL}/health/live`);
  check(liveRes, { 'liveness 200': (r) => r.status === 200 });

  const readyRes = http.get(`${BASE_URL}/health/ready`);
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
