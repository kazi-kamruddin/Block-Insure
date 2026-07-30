export function showToast(message, options = {}) {
  if (!message) return;

  window.dispatchEvent(
    new CustomEvent("blockinsure:toast", {
      detail: {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        message: String(message),
        tone: options.tone || "success",
        title: options.title || "",
        duration:
          options.duration ?? (options.tone === "error" ? 8000 : 3500),
      },
    })
  );
}
