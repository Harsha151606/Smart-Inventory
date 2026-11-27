import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  setUnauthorizedHandler,
  fetchVehicles,
  updateVehicle,
  deleteVehicle,
  fetchDeliveries,
  updateDeliveryStatus
} from './api.js';
import { buildInventoryCsv } from './utils/format.js';
import AuthView from './components/AuthView.jsx';
import Sidebar from './components/Sidebar.jsx';
import DashboardView from './components/DashboardView.jsx';
import InventoryView from './components/InventoryView.jsx';
import DeliveryView from './components/DeliveryView.jsx';
import VehiclesView from './components/VehiclesView.jsx';
import AnalyticsView from './components/AnalyticsView.jsx';
import QrVerifyView from './components/QrVerifyView.jsx';
import ItemModal from './components/ItemModal.jsx';
import VehicleModal from './components/VehicleModal.jsx';
import TeamModal from './components/TeamModal.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import ToastContainer from './components/ToastContainer.jsx';

const PAGE_TITLES = {
  dash: 'Dashboard',
  inv: 'Inventory',
  deliveries: 'Delivery Tracking',
  vehicles: 'Vehicles',
  analytics: 'Analytics',
  scan: 'QR Verify'
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

function getInitials(name) {
  const parts = String(name || 'U').trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
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

  // Inventory filters + Zone/Table layout
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [layout, setLayout] = useState('zones');

  // Persistent Right-Side Inspector state
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Analytics state
  const [forecastItemId, setForecastItemId] = useState(null);
  const forecastItemIdRef = useRef(null);
  const [forecastData, setForecastData] = useState([]);
  const [auditResult, setAuditResult] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // Vehicles & Delivery state
  const [vehiclesSummary, setVehiclesSummary] = useState({
    total: 0,
    available: 0,
    assigned: 0,
    service_needed: 0
  });
  const [vehicles, setVehicles] = useState([]);
  const [dispatchVehicles, setDispatchVehicles] = useState([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [debouncedVehicleSearch, setDebouncedVehicleSearch] = useState('');
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState('');
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  const [deliveries, setDeliveries] = useState([]);
  const [deliverySearch, setDeliverySearch] = useState('');
  const [debouncedDeliverySearch, setDebouncedDeliverySearch] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('');
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // Modals
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
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
    setVehicleModalOpen(false);
    setEditingVehicle(null);
    setTeamModalOpen(false);
    setSelectedItemId(null);
    setDetailItem(null);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedVehicleSearch(vehicleSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [vehicleSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedDeliverySearch(deliverySearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [deliverySearch]);

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
        // Not signed in
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

  const loadVehicles = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingVehicles(true);
      try {
        const data = await fetchVehicles({
          status: vehicleStatusFilter,
          search: debouncedVehicleSearch
        });
        if (data?.summary) setVehiclesSummary(data.summary);
        const rows = data?.vehicles || [];
        setVehicles(rows);
        if (!vehicleStatusFilter && !debouncedVehicleSearch) {
          setDispatchVehicles(rows);
        }
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load vehicles', 'error');
      } finally {
        if (!silent) setLoadingVehicles(false);
      }
    },
    [vehicleStatusFilter, debouncedVehicleSearch, addToast]
  );

  const loadDeliveries = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingDeliveries(true);
      try {
        const rows = await fetchDeliveries({
          status: deliveryStatusFilter,
          search: debouncedDeliverySearch
        });
        setDeliveries(rows || []);
      } catch (err) {
        if (!silent) addToast(err.message || 'Failed to load deliveries', 'error');
      } finally {
        if (!silent) setLoadingDeliveries(false);
      }
    },
    [deliveryStatusFilter, debouncedDeliverySearch, addToast]
  );

  const loadDispatchResources = useCallback(async () => {
    try {
      const [vehicleData, itemRows] = await Promise.all([
        fetchVehicles(),
        api('/api/items')
      ]);
      if (vehicleData?.summary) setVehiclesSummary(vehicleData.summary);
      setDispatchVehicles(vehicleData?.vehicles || []);
      setDashItems(itemRows || []);
    } catch {
      // Retain existing dropdown options on transient error
    }
  }, []);

  // Load categories once on sign-in
  useEffect(() => {
    if (!user) return;
    loadCategories();
  }, [user, loadCategories]);

  // Ensure dispatch dropdowns have fresh unfiltered vehicles and inventory when opening deliveries
  useEffect(() => {
    if (!user || currentView !== 'deliveries') return;
    loadDispatchResources();
  }, [user, currentView, loadDispatchResources]);

  // Fetch active view data when view or filters change
  useEffect(() => {
    if (!user) return;
    if (currentView === 'dash') {
      loadDashboard();
    } else if (currentView === 'inv') {
      loadItems();
    } else if (currentView === 'vehicles') {
      loadVehicles();
    } else if (currentView === 'deliveries') {
      loadDeliveries();
    } else if (currentView === 'analytics') {
      loadAnalytics();
    }
  }, [user, currentView, loadDashboard, loadItems, loadVehicles, loadDeliveries, loadAnalytics]);

  // Auto-sync active view every 20s when visible
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (currentView === 'dash') loadDashboard(true);
      if (currentView === 'inv') loadItems(true);
      if (currentView === 'vehicles') loadVehicles(true);
      if (currentView === 'deliveries') loadDeliveries(true);
    }, 20000);
    return () => clearInterval(timer);
  }, [user, currentView, loadDashboard, loadItems, loadVehicles, loadDeliveries]);

  // Refetch ONLY the active view data after mutations to avoid 429 bursts
  const refreshActiveView = useCallback(
    async (targetItemId = null, { includeCategories = false } = {}) => {
      if (includeCategories) {
        await loadCategories();
      }
      if (currentView === 'dash') {
        await loadDashboard(true);
      } else if (currentView === 'inv') {
        await loadItems(true);
        const inspectorId = targetItemId || selectedItemId;
        if (inspectorId && detailItem?.id === inspectorId) {
          await loadItemDetail(inspectorId, { silent: true });
        }
      } else if (currentView === 'vehicles') {
        await loadVehicles(true);
      } else if (currentView === 'deliveries') {
        await loadDeliveries(true);
      } else if (currentView === 'analytics') {
        await loadAnalytics(true);
      }
    },
    [
      currentView,
      selectedItemId,
      detailItem,
      loadCategories,
      loadDashboard,
      loadItems,
      loadItemDetail,
      loadVehicles,
      loadDeliveries,
      loadAnalytics
    ]
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
      setSelectedItemId(null);
      setDetailItem(null);
      addToast('Item deleted');
      await refreshActiveView(null, { includeCategories: true });
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

    await refreshActiveView(isEdit ? saved.id : null, { includeCategories: true });
  }

  async function handleSelectItem(id) {
    setCurrentView('inv');
    setSelectedItemId(id);
    await loadItemDetail(id);
  }

  function handleOpenAddItem() {
    setEditingItem(null);
    setItemModalOpen(true);
  }

  function handleOpenEditModal(item) {
    setEditingItem(item);
    setItemModalOpen(true);
  }

  function handleOpenAddVehicle() {
    setEditingVehicle(null);
    setVehicleModalOpen(true);
  }

  function handleOpenEditVehicle(vehicle) {
    setEditingVehicle(vehicle);
    setVehicleModalOpen(true);
  }

  async function handleQuickVehicleStatus(id, nextStatus) {
    try {
      const updated = await updateVehicle(id, { status: nextStatus });
      addToast(`Vehicle ${updated.plate_number} marked ${updated.status.replace('_', ' ')}`);
      await loadVehicles(true);
    } catch (err) {
      addToast(err.message || 'Failed to update vehicle status', 'error');
    }
  }

  async function handleDeleteVehicle(vehicle) {
    if (!window.confirm(`Remove vehicle "${vehicle.plate_number}" from fleet?`)) return;
    try {
      await deleteVehicle(vehicle.id);
      addToast(`Removed vehicle ${vehicle.plate_number}`);
      await loadVehicles(true);
    } catch (err) {
      addToast(err.message || 'Failed to remove vehicle', 'error');
    }
  }

  async function handleVehicleSaved() {
    setVehicleModalOpen(false);
    setEditingVehicle(null);
    await loadVehicles(true);
  }

  async function handleUpdateDeliveryStatus(id, nextStatus) {
    try {
      const updated = await updateDeliveryStatus(id, nextStatus);
      setDeliveries((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      addToast(`Delivery ${updated.tracking_code} marked ${updated.status.replace('_', ' ')}`);
      await loadDeliveries(true);
      if (updated.status === 'delivered') {
        await loadDispatchResources();
      }
    } catch (err) {
      addToast(err.message || 'Failed to update delivery status', 'error');
    }
  }

  async function handleDeliveryCreated() {
    await Promise.all([loadDeliveries(true), loadDispatchResources()]);
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

  function handleGlobalSearchKeyDown(e) {
    if (e.key === 'Enter') {
      setDebouncedSearch(search.trim());
      if (currentView !== 'inv') {
        setCurrentView('inv');
      }
    }
  }

  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const pageTitle = PAGE_TITLES[currentView] || 'Smart Inventory';

  return (
    <>
      <ToastContainer toasts={toasts} />

      {!bootstrapped ? (
        <div className="auth-screen">
          <div className="auth-card">
            <p className="muted-text">Initializing secure session…</p>
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
            onOpenTeam={() => setTeamModalOpen(true)}
            onLogout={handleLogout}
          />

          <div className="main-wrap">
            {/* Minimal Enterprise Top Header Bar */}
            <header className="topbar">
              <div className="topbar-left">
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

                <h1 id="page-title" className="page-title">{pageTitle}</h1>

                <div className="global-search-wrap">
                  <svg
                    className="global-search-icon"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    id="global-search"
                    type="search"
                    className="global-search-input"
                    placeholder="Search SKU, item, or zone…"
                    aria-label="Global inventory search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleGlobalSearchKeyDown}
                  />
                </div>
              </div>

              <div className="topbar-actions">
                <button
                  id="btn-export-csv"
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportCsv}
                >
                  Export CSV
                </button>

                <ThemeToggle
                  id="btn-theme-toggle"
                  theme={theme}
                  onToggle={handleToggleTheme}
                  className="btn theme-toggle-btn"
                />

                {isAdmin && (
                  <button
                    id="btn-manage-users"
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setTeamModalOpen(true)}
                  >
                    Manage Team
                  </button>
                )}

                <div className="user-chip" title={`${user.name} (${user.role})`}>
                  <div className="user-avatar" aria-hidden="true">
                    {getInitials(user.name)}
                  </div>
                  <div className="user-chip-meta">
                    <span className="user-chip-name">{user.name}</span>
                    <span className="user-chip-role">{user.role}</span>
                  </div>
                </div>
              </div>
            </header>

            <main className="content">
              {currentView === 'dash' && (
                <DashboardView
                  items={dashItems}
                  categories={categories}
                  insights={insights}
                  transactions={transactions}
                  loading={loadingDash}
                  theme={theme}
                  onAddStock={handleOpenEditModal}
                  onSelectItem={handleSelectItem}
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
                  selectedItemId={selectedItemId}
                  detailItem={detailItem}
                  loadingDetail={loadingDetail}
                  user={user}
                  theme={theme}
                  onSelectItem={handleSelectItem}
                  onCloseInspector={() => {
                    setSelectedItemId(null);
                    setDetailItem(null);
                  }}
                  onQuickUpdate={handleQuickUpdate}
                  onOpenAddItem={handleOpenAddItem}
                  onEditItem={handleOpenEditModal}
                  onDeleteItem={handleDeleteItem}
                  onApplyThreshold={handleApplyThreshold}
                  addToast={addToast}
                />
              )}

              {currentView === 'deliveries' && (
                <DeliveryView
                  deliveries={deliveries}
                  vehicles={dispatchVehicles.length ? dispatchVehicles : vehicles}
                  items={dashItems.length ? dashItems : items}
                  loading={loadingDeliveries}
                  search={deliverySearch}
                  onSearchChange={setDeliverySearch}
                  statusFilter={deliveryStatusFilter}
                  onStatusFilterChange={setDeliveryStatusFilter}
                  onUpdateStatus={handleUpdateDeliveryStatus}
                  onDeliveryCreated={handleDeliveryCreated}
                  addToast={addToast}
                />
              )}

              {currentView === 'vehicles' && (
                <VehiclesView
                  summary={vehiclesSummary}
                  vehicles={vehicles}
                  loading={loadingVehicles}
                  search={vehicleSearch}
                  onSearchChange={setVehicleSearch}
                  statusFilter={vehicleStatusFilter}
                  onStatusFilterChange={setVehicleStatusFilter}
                  onOpenAddVehicle={handleOpenAddVehicle}
                  onEditVehicle={handleOpenEditVehicle}
                  onQuickStatusChange={handleQuickVehicleStatus}
                  onDeleteVehicle={handleDeleteVehicle}
                />
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

              {currentView === 'scan' && (
                <QrVerifyView onOpenItem={handleSelectItem} addToast={addToast} />
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

          <VehicleModal
            isOpen={vehicleModalOpen}
            editingVehicle={editingVehicle}
            onClose={() => {
              setVehicleModalOpen(false);
              setEditingVehicle(null);
            }}
            onSaved={handleVehicleSaved}
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
