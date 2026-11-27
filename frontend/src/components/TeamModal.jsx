import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function TeamModal({ isOpen, onClose, addToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/auth/users');
      setUsers(Array.isArray(data) ? data : data?.users || []);
    } catch (err) {
      addToast(err.message || 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!isOpen) return;
    fetchUsers();
  }, [isOpen, fetchUsers]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await api('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role
        })
      });
      addToast(`Created ${created.role} account for ${created.name}`);
      setName('');
      setEmail('');
      setPassword('');
      setRole('staff');
      await fetchUsers();
    } catch (err) {
      addToast(err.message || 'Failed to create user', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      id="team-modal-overlay"
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="modal-box">
        <div className="modal-header">
          <h3 id="team-modal-title" className="modal-title">Team Access Management</h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close team management modal"
            disabled={submitting}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="list-stack mb-16 team-users-list">
          {loading && !users.length ? (
            <p className="muted-text">Loading team members…</p>
          ) : (
            users.map((u) => (
              <div key={u.id} className="compact-row">
                <div>
                  <div className="compact-row-title">{u.name}</div>
                  <div className="compact-row-sub">{u.email}</div>
                </div>
                <span className="role-pill">{u.role}</span>
              </div>
            ))
          )}
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="team-new-name">New Member Name</label>
              <input
                id="team-new-name"
                type="text"
                required
                placeholder="Staff full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="team-new-email">Email</label>
              <input
                id="team-new-email"
                type="email"
                required
                placeholder="staff@inventory.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="team-new-pass">Temporary Strong Password</label>
              <input
                id="team-new-pass"
                type="password"
                required
                placeholder="12+ chars (upper/lower/num/symbol)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="team-new-role">Role</label>
              <select
                id="team-new-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="staff">Staff (Read/Write Stock)</option>
                <option value="admin">Admin (Full Control)</option>
              </select>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create User'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
