export default function ThemeToggle({
  theme,
  onToggle,
  id = 'btn-theme-toggle',
  className = 'btn btn-ghost theme-toggle-btn'
}) {
  const isDark = theme === 'dark';
  const label = isDark ? 'Light Mode' : 'Dark Mode';
  const ariaLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      id={id}
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-pressed={isDark}
      onClick={onToggle}
    >
      {isDark ? (
        <svg
          className="theme-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        <svg
          className="theme-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
