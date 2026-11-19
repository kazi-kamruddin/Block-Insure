import { useEffect, useState } from "react";

function ToastGlyph({ tone }) {
  if (tone === "error" || tone === "warning") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function ToastViewport() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (event) => {
      const toast = event.detail;
      setToasts((current) => [...current, toast].slice(-4));

      window.setTimeout(() => {
        setToasts((current) =>
          current.filter((item) => item.id !== toast.id)
        );
      }, toast.duration);
    };

    window.addEventListener("blockinsure:toast", handleToast);
    return () => window.removeEventListener("blockinsure:toast", handleToast);
  }, []);

  return (
    <div
      className="toast-viewport"
      role="region"
      aria-label="Transaction notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <article className={`app-toast toast-${toast.tone}`} key={toast.id}>
          <span className="toast-icon" aria-hidden="true">
            <ToastGlyph tone={toast.tone} />
          </span>
          <div>
            {toast.title ? <strong>{toast.title}</strong> : null}
            <p>{toast.message}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() =>
              setToasts((current) =>
                current.filter((item) => item.id !== toast.id)
              )
            }
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
}
