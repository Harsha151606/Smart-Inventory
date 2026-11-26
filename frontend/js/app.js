'use strict';

// State
const state = {
  user: null,
  authMode: 'login',
  currentView: 'dash',
  layout: 'cards',
  statusFilter: '',
  categories: [],
  items: [],
  searchTimer: null,
  cameraStream: null,
  scanLoopId: null
};

// DOM helper: creates nodes safely with textContent (zero innerHTML XSS risk)
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
    } else node.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function clearEl(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function getCookie(name) {
  const prefix = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

function formatMoney(num) {
  return `$${Number(num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusOf(item) {
  if (item.quantity === 0) return 'out';
  if (item.quantity <= item.threshold) return 'low';
  return 'ok';
}

function statusLabel(cls) {
  if (cls === 'out') return 'Out of Stock';
  if (cls === 'low') return 'Low Stock';
  return 'In Stock';
}

// Toast Notifications (fixed warn/error/success handling)
function toast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  const cls = type === 'error' ? 'toast-error' : type === 'warn' ? 'toast-warn' : 'toast-success';
  const node = el('div', { className: `toast ${cls}`, text: message });
  region.appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

// API Wrapper with CSRF Header & Auto-Refresh on 401
async function api(url, opts = {}, retryAuth = true) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    let csrf = getCookie('csrf_token');
    if (!csrf) {
      await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      csrf = getCookie('csrf_token');
    }
    headers['X-CSRF-Token'] = csrf;
  }

  try {
    const res = await fetch(url, { credentials: 'same-origin', ...opts, method, headers });
    if (res.status === 401 && retryAuth && !url.startsWith('/api/auth/')) {
      let refreshCsrf = getCookie('csrf_token');
      if (!refreshCsrf) {
        await fetch('/api/auth/csrf', { credentials: 'same-origin' });
        refreshCsrf = getCookie('csrf_token');
      }
      const refreshed = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': refreshCsrf }
      });
      if (refreshed.ok) return api(url, opts, false);
      handleSessionExpired();
      return null;
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || `Request failed (${res.status})`);
    }
    return payload;
  } catch (err) {
    if (!opts.silent) toast(err.message || 'Network error', 'error');
    return null;
  }
}

function handleSessionExpired() {
  state.user = null;
  stopCamera();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

// Modal Helpers
function openModal(title, contentNode) {
  const box = document.getElementById('modal-box');
  clearEl(box);
  box.appendChild(el('h3', { id: 'modal-title', className: 'panel-title', text: title }));
  box.appendChild(contentNode);
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function confirmAction(title, message, confirmLabel, onConfirm) {
  const body = el('div', { className: 'form-stack' }, [
    el('p', { className: 'muted-text', text: message }),
    el('div', { className: 'form-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-danger',
        text: confirmLabel,
        onClick: async () => {
          closeModal();
          await onConfirm();
        }
      }),
      el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onClick: closeModal })
    ])
  ]);
  openModal(title, body);
}

// Auth UI
function setAuthMode(mode) {
  state.authMode = mode;
  const isReg = mode === 'register';
  document.getElementById('tab-login').classList.toggle('active', !isReg);
  document.getElementById('tab-register').classList.toggle('active', isReg);
  document.getElementById('tab-login').setAttribute('aria-selected', String(!isReg));
  document.getElementById('tab-register').setAttribute('aria-selected', String(isReg));
  document.getElementById('auth-name-group').classList.toggle('hidden', !isReg);
  document.getElementById('pw-checklist').classList.toggle('hidden', !isReg);
  document.getElementById('auth-submit').textContent = isReg ? 'Create Account' : 'Sign In';
  document.getElementById('auth-password').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
  document.getElementById('auth-error').classList.add('hidden');
}

function updatePasswordChecklist() {
  const val = document.getElementById('auth-password').value;
  const rules = {
    len: val.length >= 12,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    num: /[0-9]/.test(val),
    sym: /[^A-Za-z0-9]/.test(val)
  };
  document.querySelectorAll('#pw-checklist li').forEach((li) => {
    li.classList.toggle('pass', Boolean(rules[li.dataset.rule]));
  });
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');

  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const body = { email, password };
  if (state.authMode === 'register') {
    body.name = document.getElementById('auth-name').value.trim();
  }

  const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
  let csrf = getCookie('csrf_token');
  if (!csrf) {
    await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    csrf = getCookie('csrf_token');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    errEl.textContent = data.error || 'Authentication failed';
    errEl.classList.remove('hidden');
    return;
  }

  enterApp(data.user);
  toast(`Welcome, ${data.user.name}`);
}

async function enterApp(user) {
  state.user = user;
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-role').textContent = user.role;
  document.getElementById('btn-manage-users').classList.toggle('hidden', user.role !== 'admin');
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  await loadCategories();
  navigate('dash');
}

// Navigation
const PAGE_META = {
  dash: ['Dashboard', 'Real-time stock health, alerts, and cryptographic activity'],
  inv: ['Inventory', 'Search, filter, sort, and adjust SKU quantities atomically'],
  form: ['Item Editor', 'Create or update inventory items with signed QR labels'],
  detail: ['Item Details', 'Stock telemetry, demand forecast, and audit trail'],
  scan: ['QR Verification', 'Scan or paste QR payloads to validate HMAC-SHA256 signatures'],
  analytics: ['AI Analytics & Audit', 'Depletion forecasts, threshold recommendations, and SHA-256 ledger checks']
};

function navigate(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  document.querySelectorAll('.nav-link, .mnav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const [title, sub] = PAGE_META[view] || ['Smart Inventory', ''];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = sub;

  if (view !== 'scan') stopCamera();
  if (view === 'dash') loadDashboard();
  if (view === 'inv') loadItems();
  if (view === 'analytics') loadAnalytics();
}

// Dashboard
async function loadDashboard(silent = false) {
  const [items, insights, txns] = await Promise.all([
    api('/api/items', { silent }),
    api('/api/analytics', { silent }),
    api('/api/transactions?limit=8', { silent })
  ]);
  if (!items) return;
  state.items = items;

  const total = items.length;
  const low = items.filter((i) => i.quantity <= i.threshold && i.quantity > 0).length;
  const out = items.filter((i) => i.quantity === 0).length;
  const totalValue = items.reduce((s, i) => s + i.quantity * Number(i.unit_price || 0), 0);
  const summary = (insights || []).find((x) => x.type === 'summary');
  const health = summary ? summary.health_score : 100;

  const kpiGrid = document.getElementById('kpi-grid');
  clearEl(kpiGrid);
  const kpis = [
    { label: 'Total SKUs', value: String(total), sub: `Health Score: ${health}%`, cls: 'text-accent' },
    { label: 'Low Stock Alerts', value: String(low), sub: 'At or below threshold', cls: 'text-warn' },
    { label: 'Out of Stock', value: String(out), sub: 'Immediate reorder needed', cls: 'text-danger' },
    { label: 'Inventory Value', value: formatMoney(totalValue), sub: 'Current on-hand valuation', cls: 'text-ok' }
  ];
  for (const k of kpis) {
    kpiGrid.appendChild(el('div', { className: 'kpi-card' }, [
      el('div', { className: 'kpi-label', text: k.label }),
      el('div', { className: `kpi-value ${k.cls}`, text: k.value }),
      el('div', { className: 'kpi-sub', text: k.sub })
    ]));
  }

  // Alert Banner
  const alertItems = items.filter((i) => i.quantity <= i.threshold);
  const banner = document.getElementById('alert-banner');
  if (alertItems.length > 0) {
    const preview = alertItems.slice(0, 3).map((i) => i.name).join(', ');
    document.getElementById('alert-text').textContent = `${alertItems.length} item(s) need attention: ${preview}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Insights List
  const il = document.getElementById('insights-list');
  clearEl(il);
  if (insights && insights.length) {
    for (const ins of insights) {
      if (ins.type === 'summary') {
        const barCls = ins.health_score >= 70 ? 'progress-ok' : ins.health_score >= 40 ? 'progress-low' : 'progress-out';
        il.appendChild(el('div', { className: 'insight-item' }, [
          el('div', { className: 'label-row' }, [
            el('strong', { text: 'Inventory Health Score' }),
            el('strong', { className: 'text-accent', text: `${ins.health_score}%` })
          ]),
          el('progress', { className: `progress-bar ${barCls}`, max: 100, value: ins.health_score })
        ]));
      } else if (ins.type === 'critical_stock') {
        const names = ins.items.map((x) => `${x.name} (${x.quantity === 0 ? 'OUT' : `~${x.days ?? '?'}d`})`).join(', ');
        il.appendChild(el('div', { className: 'insight-item critical' }, [
          el('strong', { className: 'text-danger', text: ins.message }),
          el('p', { className: 'muted-text', text: names })
        ]));
      } else if (ins.type === 'threshold_adjustment') {
        il.appendChild(el('div', { className: 'insight-item' }, [
          el('div', { className: 'label-row' }, [
            el('strong', { className: 'text-warn', text: 'Threshold Suggestion' }),
            el('button', {
              type: 'button',
              className: 'btn-link',
              text: `Apply (${ins.suggested_threshold})`,
              onClick: () => applyThreshold(ins.item_id, ins.suggested_threshold)
            })
          ]),
          el('p', { className: 'muted-text', text: ins.message })
        ]));
      }
    }
  } else {
    il.appendChild(el('p', { className: 'muted-text', text: 'No AI insights yet.' }));
  }

  // Recent Activity
  const ra = document.getElementById('recent-activity');
  clearEl(ra);
  if (txns && txns.length) {
    for (const t of txns) {
      const sign = t.quantity_change > 0 ? `+${t.quantity_change}` : String(t.quantity_change);
      const deltaCls = t.quantity_change >= 0 ? 'text-ok' : 'text-danger';
      ra.appendChild(el('div', { className: 'activity-row' }, [
        el('div', {}, [
          el('div', { text: t.item_name || `Item #${t.item_id}` }),
          el('div', {
            className: 'muted-text',
            text: `${t.action_type} · ${t.actor_name || 'system'} · ${new Date(t.created_at).toLocaleDateString()}`
          })
        ]),
        el('div', { className: 'qty-controls' }, [
          el('span', { className: deltaCls, text: sign }),
          el('span', { className: 'hash-pill', title: t.record_hash, text: `#${(t.record_hash || '').slice(0, 8)}` })
        ])
      ]));
    }
  } else {
    ra.appendChild(el('p', { className: 'muted-text', text: 'No stock transactions recorded yet.' }));
  }
}

// Inventory Listing
function renderSkeletons(container) {
  clearEl(container);
  container.className = 'items-grid';
  for (let i = 0; i < 6; i++) {
    container.appendChild(el('div', { className: 'skeleton-card' }));
  }
}

async function loadItems(silent = false) {
  const container = document.getElementById('items-container');
  const empty = document.getElementById('empty-state');
  if (!silent) renderSkeletons(container);

  const q = document.getElementById('search-input').value.trim();
  const cat = document.getElementById('filter-cat').value;
  const sort = document.getElementById('sort-select').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cat) params.set('category', cat);
  if (state.statusFilter) params.set('status', state.statusFilter);
  if (sort) params.set('sort', sort);

  const items = await api(`/api/items?${params.toString()}`, { silent });
  if (!items) return;
  state.items = items;

  clearEl(container);
  if (!items.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  if (state.layout === 'table') {
    renderItemsTable(container, items);
  } else {
    renderItemsCards(container, items);
  }
}

function buildQtyControls(item) {
  const qtyLabel = el('span', { className: 'qty-num', text: String(item.quantity) });
  const decBtn = el('button', {
    type: 'button',
    className: 'qty-btn',
    'aria-label': `Decrease ${item.name}`,
    text: '-',
    onClick: (e) => {
      e.stopPropagation();
      quickUpdate(item, 'dec', qtyLabel);
    }
  });
  const incBtn = el('button', {
    type: 'button',
    className: 'qty-btn',
    'aria-label': `Increase ${item.name}`,
    text: '+',
    onClick: (e) => {
      e.stopPropagation();
      quickUpdate(item, 'inc', qtyLabel);
    }
  });
  return el('div', { className: 'qty-controls' }, [decBtn, qtyLabel, incBtn]);
}

function renderItemsCards(container, items) {
  container.className = 'items-grid';
  for (const item of items) {
    const cls = statusOf(item);
    const pct = item.threshold > 0 ? Math.min(100, Math.round((item.quantity / item.threshold) * 100)) : 100;
    const card = el('article', { className: 'item-card', onClick: () => viewItem(item.id) }, [
      el('div', { className: 'item-top' }, [
        el('div', {}, [
          el('div', { className: 'item-name', text: item.name }),
          el('div', {
            className: 'item-meta',
            text: `${item.category_name || 'Uncategorized'} · ${item.sku || `SKU-#${item.id}`}`
          })
        ]),
        el('span', { className: `badge badge-${cls}`, text: statusLabel(cls) })
      ]),
      el('div', { className: 'label-row' }, [
        el('span', { className: 'muted-text', text: `${item.quantity} ${item.unit || 'pcs'} (min ${item.threshold})` }),
        el('span', { className: 'muted-text', text: formatMoney(item.quantity * Number(item.unit_price || 0)) })
      ]),
      el('progress', { className: `progress-bar progress-${cls}`, max: 100, value: pct }),
      el('div', { className: 'item-bottom' }, [
        el('span', { className: 'muted-text', text: `${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}` }),
        buildQtyControls(item)
      ])
    ]);
    container.appendChild(card);
  }
}

function renderItemsTable(container, items) {
  container.className = 'table-wrap';
  const tbody = el('tbody');
  for (const item of items) {
    const cls = statusOf(item);
    tbody.appendChild(el('tr', { onClick: () => viewItem(item.id) }, [
      el('td', {}, [
        el('strong', { text: item.name }),
        el('div', { className: 'item-meta', text: item.sku || `#${item.id}` })
      ]),
      el('td', { text: item.category_name || 'Uncategorized' }),
      el('td', {}, [el('span', { className: `badge badge-${cls}`, text: statusLabel(cls) })]),
      el('td', { text: `${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}` }),
      el('td', { text: formatMoney(item.quantity * Number(item.unit_price || 0)) }),
      el('td', {}, [buildQtyControls(item)])
    ]));
  }
  const table = el('table', { className: 'inv-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Item' }),
        el('th', { text: 'Category' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Unit Price' }),
        el('th', { text: 'Total Value' }),
        el('th', { text: 'Stock' })
      ])
    ]),
    tbody
  ]);
  container.appendChild(table);
}

// Optimistic Quick Stock Update with Rollback
async function quickUpdate(item, dir, qtyLabelNode) {
  const previous = item.quantity;
  const optimistic = dir === 'inc' ? previous + 1 : Math.max(0, previous - 1);
  if (optimistic === previous) return;

  item.quantity = optimistic;
  if (qtyLabelNode) qtyLabelNode.textContent = String(optimistic);

  const url = `/api/items/${item.id}/${dir === 'inc' ? 'increment' : 'decrement'}`;
  const res = await api(url, { method: 'POST', body: JSON.stringify({ amount: 1 }) });
  if (!res) {
    item.quantity = previous;
    if (qtyLabelNode) qtyLabelNode.textContent = String(previous);
    return;
  }

  item.quantity = res.quantity;
  toast(dir === 'inc' ? `Added 1 unit (${res.record_hash.slice(0, 8)})` : `Removed 1 unit (${res.record_hash.slice(0, 8)})`);
  if (state.currentView === 'detail') viewItem(item.id);
  else loadItems(true);
}

// Item Detail View
async function viewItem(id) {
  const item = await api(`/api/items/${id}`);
  if (!item) return;

  const cls = statusOf(item);
  const dc = document.getElementById('detail-content');
  clearEl(dc);

  const detailCanvas = el('canvas', { width: 640, height: 220 });
  const leftCol = el('div', { className: 'stack' }, [
    el('div', { className: 'panel' }, [
      el('div', { className: 'item-top' }, [
        el('div', {}, [
          el('h3', { className: 'page-title', text: item.name }),
          el('p', {
            className: 'muted-text',
            text: `${item.category_name || 'Uncategorized'} · SKU: ${item.sku || 'N/A'} · ID #${item.id}`
          })
        ]),
        el('span', { className: `badge badge-${cls}`, text: `${item.quantity} ${item.unit || 'pcs'} · ${statusLabel(cls)}` })
      ]),
      item.description ? el('p', { className: 'muted-text mb-16', text: item.description }) : null,
      el('div', { className: 'grid-3 mb-16' }, [
        el('div', { className: 'kpi-card' }, [
          el('div', { className: 'kpi-label', text: 'Threshold' }),
          el('div', { className: 'kpi-value text-warn', text: String(item.threshold) })
        ]),
        el('div', { className: 'kpi-card' }, [
          el('div', { className: 'kpi-label', text: 'Unit Price' }),
          el('div', { className: 'kpi-value text-accent', text: formatMoney(item.unit_price) })
        ]),
        el('div', { className: 'kpi-card' }, [
          el('div', { className: 'kpi-label', text: 'Total Value' }),
          el('div', { className: 'kpi-value text-ok', text: formatMoney(item.quantity * Number(item.unit_price || 0)) })
        ])
      ]),
      el('div', { className: 'form-actions' }, [
        el('button', { type: 'button', className: 'btn btn-danger', text: '-1 Consume', onClick: () => quickUpdate(item, 'dec') }),
        el('button', { type: 'button', className: 'btn btn-primary', text: '+1 Restock', onClick: () => quickUpdate(item, 'inc') }),
        el('button', { type: 'button', className: 'btn btn-secondary', text: 'Edit Item', onClick: () => editItem(item.id) }),
        state.user?.role === 'admin'
          ? el('button', {
              type: 'button',
              className: 'btn btn-danger',
              text: 'Delete',
              onClick: () =>
                confirmAction('Delete Item', `Permanently delete "${item.name}" and its transaction history?`, 'Delete Item', async () => {
                  const res = await api(`/api/items/${item.id}`, { method: 'DELETE' });
                  if (res) {
                    toast('Item deleted');
                    navigate('inv');
                  }
                })
            })
          : null
      ])
    ]),
    el('div', { className: 'panel' }, [
      el('div', { className: 'panel-head' }, [
        el('h3', { text: '14-Day Projected Stock Level' }),
        item.suggested_threshold
          ? el('button', {
              type: 'button',
              className: 'btn-link',
              text: `AI Suggested Threshold: ${item.suggested_threshold}`,
              onClick: () => applyThreshold(item.id, item.suggested_threshold)
            })
          : null
      ]),
      el('div', { className: 'chart-wrap' }, [detailCanvas])
    ]),
    el('div', { className: 'panel' }, [
      el('h3', { className: 'panel-title', text: 'Recent Cryptographic Audit Trail' }),
      el('div', { className: 'stack' },
        (item.transactions || []).length
          ? item.transactions.map((t) =>
              el('div', { className: 'activity-row' }, [
                el('div', {}, [
                  el('strong', { text: `${t.action_type} (${t.previous_quantity} -> ${t.new_quantity})` }),
                  el('div', { className: 'muted-text', text: `${t.actor_name || 'system'} · ${new Date(t.created_at).toLocaleString()}` })
                ]),
                el('span', { className: 'hash-pill', title: t.record_hash, text: `#${(t.record_hash || '').slice(0, 10)}` })
              ])
            )
          : [el('p', { className: 'muted-text', text: 'No transactions yet.' })]
      )
    ])
  ]);

  const rightCol = el('div', { className: 'stack' }, [
    el('div', { className: 'panel' }, [
      el('h3', { className: 'panel-title', text: 'HMAC-Signed QR Label' }),
      item.qr_image
        ? el('img', { className: 'qr-preview', alt: `QR code for ${item.name}`, src: `data:image/png;base64,${item.qr_image}` })
        : el('p', { className: 'muted-text', text: 'QR unavailable' }),
      el('div', { className: 'code-block mb-12', text: item.qr_data || '' }),
      el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-full',
        text: 'Copy Signed QR Payload',
        onClick: async () => {
          await navigator.clipboard?.writeText(item.qr_data || '');
          toast('Signed QR payload copied');
        }
      })
    ]),
    el('div', { className: 'panel' }, [
      el('h3', { className: 'panel-title', text: 'AI Depletion Telemetry' }),
      el('div', { className: 'stack' }, [
        el('div', { className: 'activity-row' }, [
          el('span', { className: 'muted-text', text: 'Daily usage rate' }),
          el('strong', { text: `${item.prediction?.daily_rate ?? 0} / day` })
        ]),
        el('div', { className: 'activity-row' }, [
          el('span', { className: 'muted-text', text: 'Days until empty' }),
          el('strong', { text: item.prediction?.days_until_empty != null ? `${item.prediction.days_until_empty} days` : 'Stable' })
        ]),
        el('div', { className: 'activity-row' }, [
          el('span', { className: 'muted-text', text: 'Anomalies detected (60d)' }),
          el('strong', { text: String((item.anomalies || []).length) })
        ])
      ])
    ])
  ]);

  dc.appendChild(el('button', {
    type: 'button',
    className: 'btn btn-ghost mb-16',
    text: '<- Back to Inventory',
    onClick: () => navigate('inv')
  }));
  dc.appendChild(el('div', { className: 'detail-grid' }, [leftCol, rightCol]));

  navigate('detail');
  drawForecastChart(detailCanvas, item.forecast || [], item.threshold);
}

// Form
function resetForm() {
  document.getElementById('f-id').value = '';
  document.getElementById('f-name').value = '';
  document.getElementById('f-qty').value = '0';
  document.getElementById('f-thresh').value = '5';
  document.getElementById('f-price').value = '0.00';
  document.getElementById('f-unit').value = 'pcs';
  document.getElementById('f-sku').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-qr').checked = true;
  document.getElementById('form-title').textContent = 'Add New Item';
  populateCategorySelects();
}

async function editItem(id) {
  const item = await api(`/api/items/${id}`);
  if (!item) return;
  document.getElementById('f-id').value = item.id;
  document.getElementById('f-name').value = item.name;
  document.getElementById('f-qty').value = item.quantity;
  document.getElementById('f-thresh').value = item.threshold;
  document.getElementById('f-price').value = Number(item.unit_price || 0).toFixed(2);
  document.getElementById('f-unit').value = item.unit || 'pcs';
  document.getElementById('f-sku').value = item.sku || '';
  document.getElementById('f-desc').value = item.description || '';
  document.getElementById('form-title').textContent = `Edit Item #${item.id}`;
  populateCategorySelects(item.category_id);
  navigate('form');
}

async function saveItem(e) {
  e.preventDefault();
  const id = document.getElementById('f-id').value;
  const catRaw = document.getElementById('f-cat').value;
  const payload = {
    name: document.getElementById('f-name').value.trim(),
    category_id: catRaw ? Number(catRaw) : null,
    quantity: Number.parseInt(document.getElementById('f-qty').value, 10) || 0,
    threshold: Number.parseInt(document.getElementById('f-thresh').value, 10) || 0,
    unit_price: Number.parseFloat(document.getElementById('f-price').value) || 0,
    unit: document.getElementById('f-unit').value.trim() || 'pcs',
    sku: document.getElementById('f-sku').value.trim(),
    description: document.getElementById('f-desc').value.trim()
  };
  if (!id) payload.auto_qr = document.getElementById('f-qr').checked;

  const url = id ? `/api/items/${id}` : '/api/items';
  const method = id ? 'PUT' : 'POST';
  const res = await api(url, { method, body: JSON.stringify(payload) });
  if (res) {
    toast(id ? 'Item updated' : 'Item created with signed QR');
    await loadCategories();
    navigate('inv');
  }
}

// Categories
async function loadCategories() {
  state.categories = (await api('/api/categories', { silent: true })) || [];
  populateCategorySelects();
}

function populateCategorySelects(selectedFormCat = null) {
  const filterSel = document.getElementById('filter-cat');
  const prevFilter = filterSel.value;
  clearEl(filterSel);
  filterSel.appendChild(el('option', { value: '', text: 'All Categories' }));
  for (const c of state.categories) {
    filterSel.appendChild(el('option', { value: String(c.id), text: `${c.name} (${c.item_count})` }));
  }
  filterSel.value = prevFilter;

  const formSel = document.getElementById('f-cat');
  clearEl(formSel);
  formSel.appendChild(el('option', { value: '', text: 'None' }));
  for (const c of state.categories) {
    formSel.appendChild(el('option', { value: String(c.id), text: c.name }));
  }
  if (selectedFormCat != null) formSel.value = String(selectedFormCat);
}

function openCategoryModal() {
  const input = el('input', { type: 'text', placeholder: 'Category name (e.g., Networking)', maxlength: 100 });
  const colorInput = el('input', { type: 'text', value: '#0ea5e9', maxlength: 7 });
  const body = el('div', { className: 'form-stack' }, [
    el('div', { className: 'field' }, [el('label', { text: 'Category Name' }), input]),
    el('div', { className: 'field' }, [el('label', { text: 'Hex Color' }), colorInput]),
    el('div', { className: 'form-actions' }, [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: 'Create Category',
        onClick: async () => {
          const name = input.value.trim();
          if (!name) return toast('Category name is required', 'warn');
          const res = await api('/api/categories', {
            method: 'POST',
            body: JSON.stringify({ name, color: colorInput.value.trim() || '#0ea5e9' })
          });
          if (res) {
            toast('Category created');
            closeModal();
            await loadCategories();
            document.getElementById('f-cat').value = String(res.id);
          }
        }
      }),
      el('button', { type: 'button', className: 'btn btn-secondary', text: 'Cancel', onClick: closeModal })
    ])
  ]);
  openModal('New Category', body);
  input.focus();
}

// QR Camera & HMAC Verification
async function toggleCamera() {
  if (state.cameraStream) {
    stopCamera();
    return;
  }
  const statusEl = document.getElementById('scanner-status');
  const video = document.getElementById('qr-video');
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    statusEl.textContent = 'Native BarcodeDetector camera scanning is unavailable in this browser. Paste a signed QR payload on the right to verify.';
    return;
  }
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = state.cameraStream;
    await video.play();
    video.classList.remove('hidden');
    statusEl.classList.add('hidden');
    document.getElementById('btn-toggle-camera').textContent = 'Stop Camera';

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!state.cameraStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0 && codes[0].rawValue) {
          stopCamera();
          document.getElementById('qr-payload-input').value = codes[0].rawValue;
          await verifyQrText(codes[0].rawValue);
          return;
        }
      } catch {
        // Ignore transient decode frame error
      }
      state.scanLoopId = requestAnimationFrame(tick);
    };
    state.scanLoopId = requestAnimationFrame(tick);
  } catch {
    statusEl.textContent = 'Camera permission denied or unavailable. Use manual payload verification on the right.';
  }
}

function stopCamera() {
  if (state.scanLoopId) cancelAnimationFrame(state.scanLoopId);
  state.scanLoopId = null;
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) {
    video.srcObject = null;
    video.classList.add('hidden');
  }
  const statusEl = document.getElementById('scanner-status');
  if (statusEl) statusEl.classList.remove('hidden');
  const btn = document.getElementById('btn-toggle-camera');
  if (btn) btn.textContent = 'Start Camera';
}

async function verifyQrText(rawPayload) {
  const box = document.getElementById('scan-result');
  clearEl(box);
  box.classList.remove('hidden');

  const res = await api('/api/qr/verify', {
    method: 'POST',
    body: JSON.stringify({ payload: rawPayload.trim() }),
    silent: true
  });

  if (!res || !res.valid) {
    box.appendChild(el('strong', { className: 'text-danger', text: 'Signature Rejected' }));
    box.appendChild(el('p', { className: 'muted-text', text: 'This QR payload failed HMAC-SHA256 authenticity checks.' }));
    return;
  }

  box.appendChild(el('strong', { className: 'text-ok', text: 'HMAC-SHA256 Verified' }));
  box.appendChild(el('p', { className: 'muted-text mb-12', text: `${res.item.name} · Stock: ${res.item.quantity} ${res.item.unit}` }));
  box.appendChild(el('button', {
    type: 'button',
    className: 'btn btn-primary',
    text: 'Open Item Details',
    onClick: () => viewItem(res.item.id)
  }));
}

// Analytics, Audit Verification & Native Canvas Chart
async function loadAnalytics(silent = false) {
  const [insights, items] = await Promise.all([
    api('/api/analytics', { silent }),
    state.items.length ? Promise.resolve(state.items) : api('/api/items', { silent })
  ]);
  if (!insights) return;
  if (items) state.items = items;

  const sel = document.getElementById('forecast-item-select');
  const prev = sel.value;
  clearEl(sel);
  for (const item of state.items) {
    sel.appendChild(el('option', { value: String(item.id), text: `${item.name} (${item.quantity} ${item.unit})` }));
  }
  if (prev && state.items.some((i) => String(i.id) === prev)) sel.value = prev;
  if (sel.value) await loadForecastForItem(Number(sel.value));

  const ac = document.getElementById('analytics-content');
  clearEl(ac);
  for (const ins of insights) {
    if (ins.type === 'summary') {
      ac.appendChild(el('div', { className: 'panel' }, [
        el('div', { className: 'label-row' }, [
          el('h3', { text: 'Overall Inventory Health' }),
          el('strong', { className: 'text-accent', text: `${ins.health_score}%` })
        ]),
        el('progress', {
          className: `progress-bar ${ins.health_score >= 70 ? 'progress-ok' : ins.health_score >= 40 ? 'progress-low' : 'progress-out'}`,
          max: 100,
          value: ins.health_score
        }),
        el('p', {
          className: 'muted-text',
          text: `${ins.total_items} SKUs · ${ins.low_stock} low · ${ins.out_of_stock} out · Total value ${formatMoney(ins.total_value)}`
        })
      ]));
    } else if (ins.type === 'critical_stock') {
      ac.appendChild(el('div', { className: 'panel' }, [
        el('h3', { className: 'panel-title text-danger', text: 'Critical Depletion Watchlist' }),
        el('div', { className: 'stack' },
          ins.items.map((x) =>
            el('div', { className: 'activity-row' }, [
              el('strong', { text: x.name }),
              el('button', {
                type: 'button',
                className: 'btn-link',
                text: x.quantity === 0 ? 'OUT -> Inspect' : `~${x.days ?? '?'} days -> Inspect`,
                onClick: () => viewItem(x.id)
              })
            ])
          )
        )
      ]));
    } else if (ins.type === 'threshold_adjustment') {
      ac.appendChild(el('div', { className: 'insight-item' }, [
        el('div', { className: 'label-row' }, [
          el('strong', { className: 'text-warn', text: ins.item_name }),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary',
            text: `Set Threshold to ${ins.suggested_threshold}`,
            onClick: () => applyThreshold(ins.item_id, ins.suggested_threshold)
          })
        ]),
        el('p', { className: 'muted-text', text: ins.message })
      ]));
    }
  }
}

async function loadForecastForItem(itemId) {
  const data = await api(`/api/analytics/${itemId}`, { silent: true });
  if (!data || !data.forecast) return;
  const threshold = data.forecast[0]?.threshold ?? 0;
  drawForecastChart(document.getElementById('forecast-chart'), data.forecast, threshold);
}

async function verifyAuditChain() {
  const box = document.getElementById('audit-status-box');
  box.className = 'audit-box';
  box.textContent = 'Verifying SHA-256 hash chain...';
  const res = await api('/api/audit/verify');
  if (!res) return;

  if (res.valid) {
    box.className = 'audit-box valid';
    box.textContent = `VERIFIED: ${res.checked_count} transaction records checked. Zero tampering detected. Chain head: ${res.latest_hash}`;
    toast('Audit ledger verified intact');
  } else {
    box.className = 'audit-box invalid';
    box.textContent = `TAMPER ALERT: Chain broken at record #${res.tampered_record_id} (${res.reason}).`;
    toast('Audit ledger tampering detected', 'error');
  }
}

async function applyThreshold(itemId, value) {
  const res = await api(`/api/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ threshold: value })
  });
  if (res) {
    toast(`Threshold updated to ${value}`);
    if (state.currentView === 'analytics') loadAnalytics();
    if (state.currentView === 'dash') loadDashboard();
    if (state.currentView === 'detail') viewItem(itemId);
  }
}

// Native Zero-Dependency Canvas Forecast Chart (Strict CSP compatible)
function drawForecastChart(canvas, forecast, threshold) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!forecast || !forecast.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText('Not enough transaction data to plot forecast.', 24, h / 2);
    return;
  }

  const pad = { top: 24, right: 24, bottom: 36, left: 48 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxVal = Math.max(threshold * 1.25, ...forecast.map((d) => d.predicted_stock), 10);

  // Grid lines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    const val = Math.round(maxVal * (1 - i / 4));
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(val), 8, y + 4);
  }

  // Threshold dashed line
  const threshY = pad.top + plotH * (1 - threshold / maxVal);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, threshY);
  ctx.lineTo(w - pad.right, threshY);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fcd34d';
  ctx.fillText(`Threshold (${threshold})`, w - pad.right - 110, Math.max(16, threshY - 6));

  // Projected stock curve
  const xStep = plotW / Math.max(1, forecast.length - 1);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  forecast.forEach((pt, idx) => {
    const x = pad.left + idx * xStep;
    const y = pad.top + plotH * (1 - pt.predicted_stock / maxVal);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Points & day labels
  forecast.forEach((pt, idx) => {
    const x = pad.left + idx * xStep;
    const y = pad.top + plotH * (1 - pt.predicted_stock / maxVal);
    ctx.fillStyle = pt.predicted_stock <= threshold ? '#f87171' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (idx % 2 === 0 || idx === forecast.length - 1) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`D${pt.day}`, x - 8, h - 12);
    }
  });
}

// Event Wiring
function bindEvents() {
  document.getElementById('tab-login').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('tab-register').addEventListener('click', () => setAuthMode('register'));
  document.getElementById('auth-password').addEventListener('input', updatePasswordChecklist);
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

  document.querySelectorAll('.nav-link, .mnav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      if (target === 'form') resetForm();
      navigate(target);
    });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', silent: true });
    handleSessionExpired();
    toast('Signed out');
  });

  document.getElementById('btn-quick-add').addEventListener('click', () => {
    resetForm();
    navigate('form');
  });

  document.getElementById('btn-empty-add').addEventListener('click', () => {
    resetForm();
    navigate('form');
  });

  document.getElementById('btn-sync-stock').addEventListener('click', async () => {
    const res = await api('/api/check-stock', { method: 'POST' });
    if (res) {
      toast(`Stock check complete (${res.alerts_created} new alerts)`);
      if (state.currentView === 'dash') loadDashboard();
    }
  });

  document.getElementById('btn-view-low').addEventListener('click', () => {
    state.statusFilter = 'low';
    document.querySelectorAll('#status-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'low'));
    navigate('inv');
  });

  document.getElementById('btn-open-analytics').addEventListener('click', () => navigate('analytics'));
  document.getElementById('btn-verify-shortcut').addEventListener('click', async () => {
    navigate('analytics');
    await verifyAuditChain();
  });

  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadItems(), 250);
  });

  document.getElementById('filter-cat').addEventListener('change', () => loadItems());
  document.getElementById('sort-select').addEventListener('change', () => loadItems());

  document.getElementById('btn-layout-cards').addEventListener('click', () => {
    state.layout = 'cards';
    document.getElementById('btn-layout-cards').classList.add('active');
    document.getElementById('btn-layout-table').classList.remove('active');
    loadItems(true);
  });

  document.getElementById('btn-layout-table').addEventListener('click', () => {
    state.layout = 'table';
    document.getElementById('btn-layout-table').classList.add('active');
    document.getElementById('btn-layout-cards').classList.remove('active');
    loadItems(true);
  });

  document.querySelectorAll('#status-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.statusFilter = chip.dataset.status;
      document.querySelectorAll('#status-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      loadItems();
    });
  });

  document.getElementById('item-form').addEventListener('submit', saveItem);
  document.getElementById('btn-cancel-form').addEventListener('click', () => navigate('inv'));
  document.getElementById('btn-new-cat').addEventListener('click', openCategoryModal);

  document.getElementById('btn-toggle-camera').addEventListener('click', toggleCamera);
  document.getElementById('qr-verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = document.getElementById('qr-payload-input').value.trim();
    if (!val) return toast('Paste a QR JSON payload first', 'warn');
    await verifyQrText(val);
  });

  document.getElementById('btn-verify-chain').addEventListener('click', verifyAuditChain);
  document.getElementById('forecast-item-select').addEventListener('change', (e) => {
    if (e.target.value) loadForecastForItem(Number(e.target.value));
  });

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('btn-export-csv').addEventListener('click', exportInventoryCsv);
  document.getElementById('btn-manage-users').addEventListener('click', openTeamModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && state.user && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      navigate('inv');
      document.getElementById('search-input').focus();
    }
  });

  // Auto-sync every 20s only while tab is visible and authenticated
  setInterval(() => {
    if (!state.user || document.hidden) return;
    if (state.currentView === 'dash') loadDashboard(true);
    if (state.currentView === 'inv') loadItems(true);
  }, 20000);
}

// Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await fetch('/api/auth/csrf', { credentials: 'same-origin' }).catch(() => {});
  const status = await api('/api/auth/status', { silent: true });
  if (status && !status.registrationOpen) {
    document.getElementById('tab-register').classList.add('hidden');
  } else if (status && status.needsBootstrap) {
    setAuthMode('register');
  }

  const me = await api('/api/auth/me', { silent: true });
  if (me && me.user) {
    enterApp(me.user);
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
  }
});


// CSV Export with Spreadsheet Formula-Injection Neutralization
function csvEscapeCell(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

async function exportInventoryCsv() {
  const items = state.items.length ? state.items : (await api('/api/items')) || [];
  if (!items.length) return toast('No inventory items to export', 'warn');

  const headers = ['ID', 'Name', 'SKU', 'Category', 'Quantity', 'Threshold', 'Unit', 'Unit Price', 'Total Value', 'Status'];
  const lines = [headers.map(csvEscapeCell).join(',')];
  for (const item of items) {
    const row = [
      item.id,
      item.name,
      item.sku || '',
      item.category_name || 'Uncategorized',
      item.quantity,
      item.threshold,
      item.unit || 'pcs',
      Number(item.unit_price || 0).toFixed(2),
      (item.quantity * Number(item.unit_price || 0)).toFixed(2),
      statusLabel(statusOf(item))
    ];
    lines.push(row.map(csvEscapeCell).join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `smart-inventory-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('CSV exported safely');
}

// Admin Team Management Modal
async function openTeamModal() {
  const users = await api('/api/auth/users');
  if (!users) return;

  const listWrap = el('div', { className: 'stack mb-16' },
    users.map((u) =>
      el('div', { className: 'activity-row' }, [
        el('div', {}, [
          el('strong', { text: u.name }),
          el('div', { className: 'muted-text', text: u.email })
        ]),
        el('span', { className: 'role-pill', text: u.role })
      ])
    )
  );

  const nameIn = el('input', { type: 'text', placeholder: 'Staff full name', required: true });
  const emailIn = el('input', { type: 'email', placeholder: 'staff@inventory.local', required: true });
  const passIn = el('input', { type: 'password', placeholder: '12+ chars (upper/lower/num/symbol)', required: true });
  const roleSel = el('select', {}, [
    el('option', { value: 'staff', text: 'Staff (Read/Write Stock)' }),
    el('option', { value: 'admin', text: 'Admin (Full Control)' })
  ]);

  const form = el('form', {
    className: 'form-stack',
    onSubmit: async (e) => {
      e.preventDefault();
      const created = await api('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          name: nameIn.value.trim(),
          email: emailIn.value.trim(),
          password: passIn.value,
          role: roleSel.value
        })
      });
      if (created) {
        toast(`Created ${created.role} account for ${created.name}`);
        openTeamModal();
      }
    }
  }, [
    el('div', { className: 'field' }, [el('label', { text: 'New Member Name' }), nameIn]),
    el('div', { className: 'field' }, [el('label', { text: 'Email' }), emailIn]),
    el('div', { className: 'field' }, [el('label', { text: 'Temporary Strong Password' }), passIn]),
    el('div', { className: 'field' }, [el('label', { text: 'Role' }), roleSel]),
    el('div', { className: 'form-actions' }, [
      el('button', { type: 'submit', className: 'btn btn-primary', text: 'Create User' }),
      el('button', { type: 'button', className: 'btn btn-secondary', text: 'Close', onClick: closeModal })
    ])
  ]);

  openModal('Team Access Management', el('div', {}, [listWrap, form]));
}
