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
          <div className="brand-row brand-row-compact">
            <div className="brand-mark" aria-hidden="true">SI</div>
            <div>
              <h1 className="brand-title">Smart Inventory</h1>
              <p className="brand-sub">Zero-Trust Inventory &amp; AI Forecasting</p>
            </div>
          </div>
          <ThemeToggle
            id="btn-theme-toggle"
            theme={theme}
            onToggle={onToggleTheme}
            className="btn btn-ghost theme-toggle-btn theme-toggle-compact"
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
                placeholder="Katta Sai Sri Harsha"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
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
              <li className={pwRules.len ? 'pass' : ''}>At least 12 characters</li>
              <li className={pwRules.upper ? 'pass' : ''}>One uppercase letter</li>
              <li className={pwRules.lower ? 'pass' : ''}>One lowercase letter</li>
              <li className={pwRules.num ? 'pass' : ''}>One number</li>
              <li className={pwRules.sym ? 'pass' : ''}>One special character</li>
            </ul>
          )}

          {error && (
            <p id="auth-error" className="form-error" role="alert">
              {error}
            </p>
          )}

          <button id="auth-submit" type="submit" className="btn btn-primary btn-full" disabled={submitting}>
            {submitting ? 'Please wait...' : isReg ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footnote">
          Protected with Argon2id + HMAC-SHA256 pepper, HttpOnly strict cookies, CSRF double-submit tokens, and SHA-256 hash-chained audit logs.
        </p>
      </div>
    </section>
  );
}
