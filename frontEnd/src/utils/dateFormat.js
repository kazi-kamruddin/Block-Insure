function toDate(value) {
  if (!value) return null;
  if (typeof value === "object") {
    if (value.iso) return new Date(value.iso);
    if (value.unix) return new Date(Number(value.unix) * 1000);
  }
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
  }
  return new Date(value);
}

function format(value, options) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDateOnly(value) {
  return format(value, { dateStyle: "medium" });
}

export function formatDateTime(value) {
  return format(value, { dateStyle: "medium", timeStyle: "short" });
}

export function toIsoDateTime(value) {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}
