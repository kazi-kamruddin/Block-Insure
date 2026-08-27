import { useEffect, useState } from "react";

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
            {toast.tone === "error"
              ? "!"
              : toast.tone === "warning"
                ? "!"
                : "✓"}
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
            ×
          </button>
        </article>
      ))}
    </div>
  );
}
