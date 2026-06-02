import { useState } from "react";

export default function CopyableText({ value, label = "Copy", short = false }) {
  const [copied, setCopied] = useState(false);

  if (value === undefined || value === null || value === "") {
    return <span>-</span>;
  }

  const text = String(value);
  const displayText =
    short && text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  }

  return (
    <span className="copyable-text">
      <code>{displayText}</code>{" "}
      <button type="button" className="small-button" onClick={handleCopy}>
        {copied ? "Copied" : label}
      </button>
    </span>
  );
}