import { useEffect } from 'react';

function NavIcon({ name }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 17,
    height: 17,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (name === 'dash') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === 'inv') {
    return (
      <svg {...common}>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    );
  }
  if (name === 'deliveries') {
    return (
      <svg {...common}>
        <path d="M12 2v20" />
        <path d="M5 12h14" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  if (name === 'vehicles') {
    return (
      <svg {...common}>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </svg>
    );
  }
  if (name === 'analytics') {
    return (
      <svg {...common}>
        <path d="M3 3v18h18" />
        <path d="M7 16v-4" />
        <path d="M12 16V8" />
        <path d="M17 16v-6" />
      </svg>
    );
  }
  if (name === 'scan') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="15" width="6" height="6" rx="1" />
        <path d="M15 15h6v6h-6z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export default function Sidebar({
  user,
  currentView,
  isOpen,
  onClose,
  onNavigate,
  onOpenTeam,
  onLogout
}) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  const navItems = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'inv', label: 'Inventory' },
    { id: 'deliveries', label: 'Delivery' },
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'scan', label: 'QR Verify' },
    ...(isAdmin ? [{ id: 'team', label: 'Team' }] : [])
  ];

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
    if (id === 'team') {
      onOpenTeam();
    } else {
      onNavigate(id);
    }
  }

  return (
    <>
      {isOpen && <div className="drawer-backdrop" aria-hidden="true" onClick={onClose} />}

      <aside
        id="app-sidebar"
        className={`sidebar ${isOpen ? 'drawer-open' : ''}`}
        aria-label="Primary Navigation"
      >
        <div>
          <div className="sidebar-header-row">
            <div className="brand-row">
              <div className="brand-mark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
              </div>
              <div>
                <div className="brand-title-sm">Smart Inventory</div>
                <div className="brand-sub-sm">Warehouse Ops</div>
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
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-link ${currentView === item.id ? 'active' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                <NavIcon name={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
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
