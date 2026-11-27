export default function ToastContainer({ toasts }) {
  return (
    <div id="toast-region" className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => {
        const dotCls =
          t.type === 'error'
            ? 'toast-dot-error'
            : t.type === 'warn'
            ? 'toast-dot-warn'
            : 'toast-dot-success';
        return (
          <div key={t.id} className="toast">
            <span className={`toast-dot ${dotCls}`} aria-hidden="true" />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
