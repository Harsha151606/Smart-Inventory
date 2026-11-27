import { useEffect } from 'react';
import ThemeToggle from './ThemeToggle.jsx';

const NAV_ITEMS = [
  { id: 'dash', label: 'Dashboard' },
  { id: 'inv', label: 'Inventory' },
  { id: 'add', label: 'Add Item' },
  { id: 'scan', label: 'QR Verify' },
  { id: 'analytics', label: 'AI & Audit' }
];

export default function Sidebar({
  user,
  currentView,
  isOpen,
  onClose,
  onNavigate,
  onOpenAddItem,
  onOpenTeam,
  onLogout,
  theme,
  onToggleTheme
}) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  function handleNavClick(id) {
    onClose();
    if (id === 'add') {
      onOpenAddItem();
    } else {
      onNavigate(id);
    }
  }

  return (
    <>
      {isOpen && (
        <div
          className="drawer-backdrop"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside
        id="app-sidebar"
        className={`sidebar ${isOpen ? 'drawer-open' : ''}`}
        aria-label="Primary Navigation"
      >
        <div className="sidebar-top">
          <div className="sidebar-header-row">
            <div className="brand-row">
              <div className="brand-mark" aria-hidden="true">SI</div>
              <div>
                <div className="brand-title-sm">Smart Inventory</div>
                <div className="brand-sub-sm">Hardened v2.0</div>
              </div>
            </div>

            <button
              type="button"
              className="drawer-close-btn"
              aria-label="Close navigation menu"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <nav className="side-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-link ${currentView === item.id ? 'active' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-name">{user?.name || 'User'}</div>
            <div>
              <span className="role-pill">{user?.role || 'staff'}</span>
            </div>
          </div>

          <ThemeToggle
            id="btn-theme-toggle"
            theme={theme}
            onToggle={onToggleTheme}
            className="btn btn-secondary btn-full theme-toggle-btn"
          />

          {isAdmin && (
            <button
              id="btn-manage-users"
              type="button"
              className="btn btn-secondary btn-full"
              onClick={() => {
                onClose();
                onOpenTeam();
              }}
            >
              Manage Team
            </button>
          )}

          <button
            id="btn-logout"
            type="button"
            className="btn btn-ghost btn-full"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
