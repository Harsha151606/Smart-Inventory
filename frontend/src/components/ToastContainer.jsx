export default function ToastContainer({ toasts }) {
  return (
    <div id="toast-region" className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => {
        const cls =
          t.type === 'error' ? 'toast-error' : t.type === 'warn' ? 'toast-warn' : 'toast-success';
        return (
          <div key={t.id} className={`toast ${cls}`}>
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
