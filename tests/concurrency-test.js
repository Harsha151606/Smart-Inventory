#!/usr/bin/env node
'use strict';

/**
 * Concurrency race-condition test for the Smart Inventory adjustStock endpoint.
 *
 * Creates an item with quantity=1, fires 20 concurrent decrement requests,
 * and verifies that exactly 1 succeeds and the final stock is 0 (never negative).
 *
 * Usage:
 *   API_URL=http://localhost:8080/api ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret node tests/concurrency-test.js
 */

import crypto from 'node:crypto';

const API_URL = (process.env.API_URL || 'http://localhost:8080/api').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CONCURRENCY = 20;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Cookie helpers (built-in fetch only, no external deps)
// ---------------------------------------------------------------------------

function parseCookies(response) {
  const cookies = {};
  const raw = response.headers.getSetCookie?.() || [];
  for (const header of raw) {
    const [pair] = header.split(';');
    const [name, ...rest] = pair.split('=');
    cookies[name.trim()] = rest.join('=').trim();
  }
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, { body, cookies = {}, csrfToken, idempotencyKey } = {}) {
  const url = `${API_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (Object.keys(cookies).length) {
    headers['Cookie'] = cookieHeader(cookies);
  }
  const upperMethod = method.toUpperCase();
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(upperMethod)) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const opts = { method: upperMethod, headers };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, response: res };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🔧 Concurrency test — ${CONCURRENCY} simultaneous decrements on quantity=1 item`);
  console.log(`   API_URL: ${API_URL}\n`);

  // 1. Fetch CSRF cookie & login
  console.log('1️⃣  Fetching CSRF token & logging in…');
  const csrfRes = await api('GET', '/auth/csrf');
  if (csrfRes.status !== 200) {
    console.error(`   ❌ CSRF fetch failed (${csrfRes.status}):`, csrfRes.json);
    process.exit(1);
  }
  const cookies = parseCookies(csrfRes.response);
  let csrfToken = cookies['csrf_token'] || csrfRes.json?.csrfToken || '';
  if (!csrfToken) {
    console.error('   ❌ Failed to obtain CSRF token from /auth/csrf');
    process.exit(1);
  }
  if (!cookies['csrf_token']) {
    cookies['csrf_token'] = csrfToken;
  }

  const loginRes = await api('POST', '/auth/login', {
    cookies,
    csrfToken,
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (loginRes.status !== 200) {
    console.error(`   ❌ Login failed (${loginRes.status}):`, loginRes.json);
    process.exit(1);
  }
  Object.assign(cookies, parseCookies(loginRes.response));
  csrfToken = cookies['csrf_token'] || csrfToken;
  console.log('   ✅ Logged in');

  // 2. Create test item with quantity = 1
  console.log('2️⃣  Creating test item (quantity=1)…');
  const createRes = await api('POST', '/items', {
    cookies,
    csrfToken,
    idempotencyKey: crypto.randomUUID(),
    body: {
      name: `__concurrency_test_${Date.now()}`,
      sku: `CT-${Date.now()}`,
      quantity: 1,
      threshold: 0,
      unit_price: 10,
      unit: 'pcs',
      description: 'Concurrency test item',
    },
  });
  if (createRes.status !== 201 && createRes.status !== 200) {
    console.error(`   ❌ Create failed (${createRes.status}):`, createRes.json);
    process.exit(1);
  }
  const itemId = createRes.json.id || createRes.json.item?.id;
  console.log(`   ✅ Created item id=${itemId}`);

  // 3. Fire CONCURRENCY concurrent decrements
  console.log(`3️⃣  Firing ${CONCURRENCY} concurrent decrement requests…`);
  const promises = Array.from({ length: CONCURRENCY }, () =>
    api('POST', `/items/${itemId}/decrement`, {
      cookies,
      csrfToken,
      idempotencyKey: crypto.randomUUID(),
      body: { amount: 1 },
    })
  );

  const results = await Promise.all(promises);
  const succeeded = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status === 409);
  const errors = results.filter((r) => r.status !== 200 && r.status !== 409);

  console.log(`   ✅ Succeeded (200): ${succeeded.length}`);
  console.log(`   🚫 Rejected  (409): ${rejected.length}`);
  if (errors.length) {
    console.log(`   ⚠️  Other errors:    ${errors.length}`);
    for (const e of errors) {
      console.log(`      status=${e.status}`, e.json);
    }
  }

  // 4. Fetch final item state
  console.log('4️⃣  Verifying final stock…');
  const getRes = await api('GET', `/items/${itemId}`, { cookies, csrfToken });
  const finalQty = getRes.json?.quantity ?? getRes.json?.item?.quantity;
  console.log(`   Final quantity: ${finalQty}`);

  // 5. Determine PASS/FAIL
  let pass = true;
  if (finalQty < 0) {
    console.error('   ❌ FAIL: Stock went negative (race condition!)');
    pass = false;
  }
  if (succeeded.length !== 1) {
    console.error(`   ❌ FAIL: Expected exactly 1 success, got ${succeeded.length}`);
    pass = false;
  }
  if (finalQty !== 0) {
    console.error(`   ❌ FAIL: Expected final quantity 0, got ${finalQty}`);
    pass = false;
  }

  // 6. Cleanup — delete the item
  console.log('5️⃣  Cleaning up…');
  const delRes = await api('DELETE', `/items/${itemId}`, { cookies, csrfToken });
  if (delRes.status === 200 || delRes.status === 204) {
    console.log('   ✅ Test item deleted');
  } else {
    console.log(`   ⚠️  Cleanup returned status ${delRes.status}`);
  }

  // 7. Final verdict
  console.log('');
  if (pass) {
    console.log('✅ PASS — Race condition properly handled. Only 1 of 20 decrements succeeded.');
    process.exit(0);
  } else {
    console.log('❌ FAIL — Race condition detected or unexpected results.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
