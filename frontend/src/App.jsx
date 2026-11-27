import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { buildInventoryCsv } from './utils/format.js';
import AuthView from './components/AuthView.jsx';
import Sidebar from './components/Sidebar.jsx';
import DashboardView from './components/DashboardView.jsx';
import InventoryView from './components/InventoryView.jsx';
import ItemDetailView from './components/ItemDetailView.jsx';
import AnalyticsView from './components/AnalyticsView.jsx';
import QrVerifyView from './components/QrVerifyView.jsx';
import ItemModal from './components/ItemModal.jsx';
import TeamModal from './components/TeamModal.jsx';
import ToastContainer from './components/ToastContainer.jsx';

const PAGE_META = {
  dash: ['Dashboard', 'Real-time stock health, alerts, and cryptographic activity'],
  inv: ['Inventory', 'Search, filter, sort, and adjust SKU quantities atomically'],
  detail: ['Item Details', 'Stock telemetry, demand forecast, and audit trail'],
  scan: ['QR Verification', 'Scan or paste QR payloads to validate HMAC-SHA256 signatures'],
  analytics: ['AI Analytics & Audit', 'Depletion forecasts, threshold recommendations, and SHA-256 ledger checks']
};

const THEME_STORAGE_KEY = 'sim_theme';

function getInitialTheme() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  }
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage read failure
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [user, setUser] = useState(null);

  const [currentView, setCurrentView] = useState('dash');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  const [toasts, setToasts] = useState([]);
  const toastSeqRef = useRef(0);

  // Core data state
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [dashItems, setDashItems] = useState([]);
  const [insights, setInsights] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loadingDash, setLoadingDash] = useState(false);
  const [loadingInv, setLoadingInv] = useState(false);

  // Inventory filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [layout, setLayout] = useState('cards');

  // Detail state
  const [detailItem, setDetailItem] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Analytics state
  const [forecastItemId, setForecastItemId] = useState(null);
  const forecastItemIdRef = useRef(null);
  const [forecastData, setForecastData] = useState([]);
  const [auditResult, setAuditResult] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // Modals
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastSeqRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setDrawerOpen(false);
    setItemModalOpen(false);
    setTeamModalOpen(false);
    setDetailItem(null);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Listen for OS color-scheme changes when user has no manual preference in localStorage
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleOsThemeChange = (e) => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') return;
      } catch {
        // Ignore storage read failure
      }
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };
    mq.addEventListener('change', handleOsThemeChange);
    return () => mq.removeEventListener('change', handleOsThemeChange);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write failure
      }
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleSessionExpired);
    return () => setUnauthorizedHandler(null);
  }, [handleSessionExpired]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Bootstrap CSRF + Auth check
  useEffect(() => {
    let active = true;
    async function init() {
      await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
      try {
        const status = await api('/api/auth/status');
        if (active) setAuthStatus(status);
      } catch {
        // Ignore silent status error
      }
      try {
        const me = await api('/api/auth/me');
        if (active && me?.user) {
          setUser(me.user);
        }
      } catch {
        // Not signed in yet
      }
      if (active) setBootstrapped(true);
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await api('/api/categories');
      setCategories(cats || []);
    } catch {
      // Keep existing categories on transient error
    }
  }, []);

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingDash(true);
      try {
        const [allItems, nextInsights, nextTxns] = await Promise.all([
          api('/api/items'),
          api('/api/analytics'),
          api('/api/transactions?limit=8')
        ]);
        setDashItems(allItems || []);
        setInsights(nextInsights || []);
        setTransactions(nextTxns || []);
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load dashboard', 'error');
      } finally {
        if (!silent) setLoadingDash(false);
      }
    },
    [addToast]
  );

  const loadItems = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingInv(true);
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (sortBy) params.set('sort', sortBy);

      try {
        const query = params.toString();
        const nextItems = await api(`/api/items${query ? `?${query}` : ''}`);
        setItems(nextItems || []);
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load inventory', 'error');
      } finally {
        if (!silent) setLoadingInv(false);
      }
    },
    [debouncedSearch, categoryFilter, statusFilter, sortBy, addToast]
  );

  const loadItemDetail = useCallback(
    async (id, { silent = false } = {}) => {
      if (!silent) setLoadingDetail(true);
      try {
        const item = await api(`/api/items/${id}`);
        setDetailItem(item);
        return item;
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load item details', 'error');
        return null;
      } finally {
        if (!silent) setLoadingDetail(false);
      }
    },
    [addToast]
  );

  const loadForecastForItem = useCallback(async (itemId) => {
    try {
      const data = await api(`/api/analytics/${itemId}`);
      if (data?.forecast) {
        setForecastData(data.forecast);
      }
    } catch {
      // Ignore silent forecast error
    }
  }, []);

  const loadAnalytics = useCallback(
    async (silent = false) => {
      try {
        const [nextInsights, allItems] = await Promise.all([
          api('/api/analytics'),
          api('/api/items')
        ]);
        setInsights(nextInsights || []);
        const list = allItems || [];
        setDashItems(list);
        if (list.length) {
          const currentSelected = forecastItemIdRef.current;
          const targetId =
            currentSelected && list.some((i) => i.id === currentSelected)
              ? currentSelected
              : list[0].id;
          forecastItemIdRef.current = targetId;
          setForecastItemId(targetId);
          await loadForecastForItem(targetId);
        }
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load analytics', 'error');
      }
    },
    [loadForecastForItem, addToast]
  );

  // Load categories once on sign-in
  useEffect(() => {
    if (!user) return;
    loadCategories();
  }, [user, loadCategories]);

  // Fetch active view data when view or inventory filters change
  useEffect(() => {
    if (!user) return;
    if (currentView === 'dash') {
      loadDashboard();
    } else if (currentView === 'inv') {
      loadItems();
    } else if (currentView === 'analytics') {
      loadAnalytics();
    }
  }, [user, currentView, loadDashboard, loadItems, loadAnalytics]);

  // Auto-sync active view every 20s when tab is visible
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (currentView === 'dash') loadDashboard(true);
      if (currentView === 'inv') loadItems(true);
    }, 20000);
    return () => clearInterval(timer);
  }, [user, currentView, loadDashboard, loadItems]);

  // Refetch ONLY active view data after mutations to avoid 429 rate-limit bursts
  const refreshActiveView = useCallback(
    async (targetItemId = null, { includeCategories = false } = {}) => {
      if (includeCategories) {
        await loadCategories();
      }
      if (currentView === 'dash') {
        await loadDashboard(true);
      } else if (currentView === 'inv') {
        await loadItems(true);
      } else if (currentView === 'detail' && (targetItemId || detailItem?.id)) {
        await loadItemDetail(targetItemId || detailItem.id, { silent: true });
      } else if (currentView === 'analytics') {
        await loadAnalytics(true);
      }
    },
    [currentView, detailItem, loadCategories, loadDashboard, loadItems, loadItemDetail, loadAnalytics]
  );

  function updateLocalQuantity(itemId, nextQuantity) {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, quantity: nextQuantity } : it))
    );
    setDashItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, quantity: nextQuantity } : it))
    );
    setDetailItem((prev) =>
      prev && prev.id === itemId ? { ...prev, quantity: nextQuantity } : prev
    );
  }

  async function handleQuickUpdate(item, dir) {
    const previous = item.quantity;
    const optimistic = dir === 'inc' ? previous + 1 : Math.max(0, previous - 1);
    if (optimistic === previous) return;

    updateLocalQuantity(item.id, optimistic);

    const url = `/api/items/${item.id}/${dir === 'inc' ? 'increment' : 'decrement'}`;
    try {
      const res = await api(url, {
        method: 'POST',
        body: JSON.stringify({ amount: 1 })
      });
      updateLocalQuantity(item.id, res.quantity);
      addToast(
        dir === 'inc'
          ? `Added 1 unit (${res.record_hash.slice(0, 8)})`
          : `Removed 1 unit (${res.record_hash.slice(0, 8)})`
      );
      await refreshActiveView(item.id);
    } catch (err) {
      updateLocalQuantity(item.id, previous);
      addToast(err.message || 'Stock update failed', 'error');
    }
  }

  async function handleApplyThreshold(itemId, value) {
    try {
      const updated = await api(`/api/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({ threshold: value })
      });
      setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
      setDashItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
      setDetailItem((prev) =>
        prev && prev.id === updated.id ? { ...prev, ...updated } : prev
      );
      addToast(`Threshold updated to ${value}`);
      await refreshActiveView(itemId);
    } catch (err) {
      addToast(err.message || 'Failed to update threshold', 'error');
    }
  }

  async function handleDeleteItem(item) {
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setDashItems((prev) => prev.filter((it) => it.id !== item.id));
      setDetailItem(null);
      addToast('Item deleted');
      setCurrentView('inv');
      await loadCategories();
    } catch (err) {
      addToast(err.message || 'Failed to delete item', 'error');
    }
  }

  async function handleItemSaved(saved, isEdit) {
    setItemModalOpen(false);
    setEditingItem(null);

    const mergeItem = (list) => {
      const exists = list.some((it) => it.id === saved.id);
      return exists
        ? list.map((it) => (it.id === saved.id ? { ...it, ...saved } : it))
        : [...list, saved];
    };

    setItems(mergeItem);
    setDashItems(mergeItem);
    setDetailItem((prev) => (prev && prev.id === saved.id ? { ...prev, ...saved } : prev));

    if (isEdit && currentView === 'detail') {
      await refreshActiveView(saved.id, { includeCategories: true });
    } else if (currentView === 'inv') {
      await refreshActiveView(saved.id, { includeCategories: true });
    } else {
      setCurrentView('inv');
      await loadCategories();
    }
  }

  async function handleSelectItem(id) {
    setCurrentView('detail');
    await loadItemDetail(id);
  }

  async function handleEditItem(item) {
    setEditingItem(item);
    setItemModalOpen(true);
  }

  function handleOpenAddItem() {
    setEditingItem(null);
    setItemModalOpen(true);
  }

  async function handleVerifyAuditChain() {
    setAuditLoading(true);
    try {
      const res = await api('/api/audit/verify');
      setAuditResult(res);
      if (res.valid) {
        addToast('Audit ledger verified intact');
      } else {
        addToast('Audit ledger tampering detected', 'error');
      }
    } catch (err) {
      addToast(err.message || 'Audit verification failed', 'error');
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleSyncStock() {
    try {
      const res = await api('/api/check-stock', {
        method: 'POST',
        body: JSON.stringify({})
      });
      addToast(`Stock check complete (${res.alerts_created} new alerts)`);
      if (currentView === 'dash') {
        await loadDashboard(true);
      } else if (currentView === 'analytics') {
        await loadAnalytics(true);
      }
    } catch (err) {
      addToast(err.message || 'Stock check failed', 'error');
    }
  }

  async function handleExportCsv() {
    let sourceItems = items.length ? items : dashItems;
    if (!sourceItems.length) {
      try {
        sourceItems = (await api('/api/items')) || [];
      } catch (err) {
        addToast(err.message || 'Export failed', 'error');
        return;
      }
    }
    if (!sourceItems.length) {
      addToast('No inventory items to export', 'warn');
      return;
    }
    const csv = buildInventoryCsv(sourceItems);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smart-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addToast('CSV exported safely');
  }

  async function handleLogout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // Clear local session regardless
    }
    handleSessionExpired();
    addToast('Signed out');
  }

  const alertSource = dashItems.length ? dashItems : items;
  const alertItems = alertSource.filter((i) => i.quantity <= i.threshold);
  const [pageTitle, pageSubtitle] = PAGE_META[currentView] || ['Smart Inventory', ''];

  return (
    <>
      <ToastContainer toasts={toasts} />

      {!bootstrapped ? (
        <div className="auth-screen">
          <div className="auth-card">
            <p className="muted-text">Initializing secure session...</p>
          </div>
        </div>
      ) : !user ? (
        <AuthView
          authStatus={authStatus}
          onAuthSuccess={(loggedInUser) => {
            setUser(loggedInUser);
            setCurrentView('dash');
          }}
          addToast={addToast}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      ) : (
        <div id="app-shell" className="app-shell">
          <Sidebar
            user={user}
            currentView={currentView}
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onNavigate={(view) => setCurrentView(view)}
            onOpenAddItem={handleOpenAddItem}
            onOpenTeam={() => setTeamModalOpen(true)}
            onLogout={handleLogout}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />

          <div className="main-wrap">
            <header className="topbar">
              <div className="topbar-title-group">
                <button
                  type="button"
                  className="hamburger-btn"
                  aria-label="Open navigation menu"
                  aria-expanded={drawerOpen}
                  aria-controls="app-sidebar"
                  onClick={() => setDrawerOpen(true)}
                >
                  <span className="hamburger-lines" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                <div>
                  <h2 id="page-title" className="page-title">{pageTitle}</h2>
                  <p id="page-subtitle" className="page-subtitle">{pageSubtitle}</p>
                </div>
              </div>

              <div className="topbar-actions">
                <button
                  id="btn-export-csv"
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportCsv}
                >
                  Export CSV
                </button>
                <button
                  id="btn-sync-stock"
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleSyncStock}
                >
                  Sync Alerts
                </button>
                <button
                  id="btn-quick-add"
                  type="button"
                  className="btn btn-primary"
                  onClick={handleOpenAddItem}
                >
                  + Add Item
                </button>
              </div>
            </header>

            {alertItems.length > 0 && (
              <div id="alert-banner" className="alert-banner" role="status">
                <span className="tabular-nums">
                  {`${alertItems.length} item(s) need attention: ${alertItems
                    .slice(0, 3)
                    .map((i) => i.name)
                    .join(', ')}`}
                </span>
                <button
                  id="btn-view-low"
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    setStatusFilter('low');
                    setCurrentView('inv');
                  }}
                >
                  Review low stock
                </button>
              </div>
            )}

            <main className="content">
              {currentView === 'dash' && (
                <DashboardView
                  items={dashItems}
                  insights={insights}
                  transactions={transactions}
                  loading={loadingDash}
                  onApplyThreshold={handleApplyThreshold}
                  onOpenAnalytics={() => setCurrentView('analytics')}
                  onVerifyChain={async () => {
                    setCurrentView('analytics');
                    await handleVerifyAuditChain();
                  }}
                />
              )}

              {currentView === 'inv' && (
                <InventoryView
                  items={items}
                  categories={categories}
                  loading={loadingInv}
                  search={search}
                  onSearchChange={setSearch}
                  categoryFilter={categoryFilter}
                  onCategoryFilterChange={setCategoryFilter}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  layout={layout}
                  onLayoutChange={setLayout}
                  isMobile={isMobile}
                  onQuickUpdate={handleQuickUpdate}
                  onSelectItem={handleSelectItem}
                  onOpenAddItem={handleOpenAddItem}
                />
              )}

              {currentView === 'detail' && (
                <ItemDetailView
                  item={detailItem}
                  user={user}
                  loading={loadingDetail}
                  theme={theme}
                  onBack={() => setCurrentView('inv')}
                  onQuickUpdate={handleQuickUpdate}
                  onEdit={handleEditItem}
                  onDelete={handleDeleteItem}
                  onApplyThreshold={handleApplyThreshold}
                  addToast={addToast}
                />
              )}

              {currentView === 'scan' && (
                <QrVerifyView onOpenItem={handleSelectItem} addToast={addToast} />
              )}

              {currentView === 'analytics' && (
                <AnalyticsView
                  insights={insights}
                  items={dashItems.length ? dashItems : items}
                  forecastItemId={forecastItemId}
                  forecastData={forecastData}
                  auditResult={auditResult}
                  auditLoading={auditLoading}
                  theme={theme}
                  onSelectForecastItem={(id) => {
                    forecastItemIdRef.current = id;
                    setForecastItemId(id);
                    loadForecastForItem(id);
                  }}
                  onVerifyAuditChain={handleVerifyAuditChain}
                  onApplyThreshold={handleApplyThreshold}
                  onInspectItem={handleSelectItem}
                />
              )}
            </main>
          </div>

          <ItemModal
            isOpen={itemModalOpen}
            editingItem={editingItem}
            categories={categories}
            onClose={() => {
              setItemModalOpen(false);
              setEditingItem(null);
            }}
            onSaved={handleItemSaved}
            onCategoryCreated={loadCategories}
            addToast={addToast}
          />

          <TeamModal
            isOpen={teamModalOpen}
            onClose={() => setTeamModalOpen(false)}
            addToast={addToast}
          />
        </div>
      )}
    </>
  );
}
