import { useEffect, useState } from 'react';
import { api } from '../api.js';
import ThemeToggle from './ThemeToggle.jsx';

export default function AuthView({ authStatus, onAuthSuccess, addToast, theme, onToggleTheme }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authStatus?.needsBootstrap) {
      setMode('register');
    }
  }, [authStatus]);

  const isReg = mode === 'register';
  const registrationOpen = authStatus ? Boolean(authStatus.registrationOpen) : true;

  const pwRules = {
    len: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    num: /[0-9]/.test(password),
    sym: /[^A-Za-z0-9]/.test(password)
  };

  function switchMode(nextMode) {
    setMode(nextMode);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const payload = { email: email.trim(), password };
    if (isReg) {
      payload.name = name.trim();
    }

    const endpoint = isReg ? '/api/auth/register' : '/api/auth/login';
    try {
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      onAuthSuccess(data.user);
      addToast(`Welcome, ${data.user.name}`);
    } catch (err) {
      const msg = err.message || 'Authentication failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="auth-screen" className="auth-screen">
      <div className="auth-card">
        <div className="auth-header-row">
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
              <h1 className="brand-title">Smart Inventory</h1>
              <p className="brand-sub">Enterprise Warehouse Operations</p>
            </div>
          </div>

          <ThemeToggle
            id="btn-theme-toggle"
            theme={theme}
            onToggle={onToggleTheme}
            className="btn theme-toggle-btn"
          />
        </div>

        <div className="tab-switch" role="tablist">
          <button
            id="tab-login"
            type="button"
            role="tab"
            aria-selected={!isReg}
            className={`tab-btn ${!isReg ? 'active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Sign In
          </button>
          {registrationOpen && (
            <button
              id="tab-register"
              type="button"
              role="tab"
              aria-selected={isReg}
              className={`tab-btn ${isReg ? 'active' : ''}`}
              onClick={() => switchMode('register')}
            >
              Create Account
            </button>
          )}
        </div>

        <form id="auth-form" className="form-stack" onSubmit={handleSubmit} noValidate>
          {isReg && (
            <div className="field">
              <label htmlFor="auth-name">Full Name</label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                placeholder="Warehouse Operator"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Work Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              placeholder="admin@inventory.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isReg ? 'new-password' : 'current-password'}
              required
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isReg && (
            <ul className="pw-checklist" aria-label="Password requirements">
              <li className={pwRules.len ? 'pass' : ''}>12+ characters</li>
              <li className={pwRules.upper ? 'pass' : ''}>Uppercase letter</li>
              <li className={pwRules.lower ? 'pass' : ''}>Lowercase letter</li>
              <li className={pwRules.num ? 'pass' : ''}>Number</li>
              <li className={pwRules.sym ? 'pass' : ''}>Special symbol</li>
            </ul>
          )}

          {error && (
            <p id="auth-error" className="form-error" role="alert">
              {error}
            </p>
          )}

          <button id="auth-submit" type="submit" className="btn btn-primary btn-full" disabled={submitting}>
            {submitting ? 'Signing in…' : isReg ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footnote">
          Argon2id authentication · CSRF protected · Immutable SHA-256 ledger
        </p>
      </div>
    </section>
  );
}
