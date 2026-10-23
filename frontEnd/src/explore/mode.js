export const EXPLORE_ENABLED = import.meta.env.VITE_ENABLE_EXPLORE === "true";
export const DEMO_REFERENCE_DATE = "2026-10-20T12:00:00Z";
export const DEMO_VERSION = "block-insure-explore-v1";
export const demoWallet = (index) => `0x${Number(index).toString(16).padStart(40, "0")}`;
export const DEMO_AUDITORS = [11, 12, 13, 14].map(demoWallet);

export function resolveMode(pathname = window.location.pathname) {
  return EXPLORE_ENABLED && /^\/explore(?:\/|$)/.test(pathname) ? "explore" : "live";
}

export function demoActor(pathname = window.location.pathname, search = window.location.search) {
  const workspace = pathname.replace(/^\/explore\/?/, "").split("/")[0];
  const role = { user: "USER", admin: "ADMIN", hospital: "HOSPITAL", bank: "BANK", auditor: "AUDITOR" }[workspace] || "USER";
  const requested = Number(new URLSearchParams(search).get("auditor"));
  const auditor = [1, 2, 3, 4].includes(requested) ? requested : 1;
  const walletAddress = role === "AUDITOR" ? DEMO_AUDITORS[auditor - 1] : demoWallet({ USER: 1, ADMIN: 2, HOSPITAL: 3, BANK: 4 }[role]);
  return { role, auditor, walletAddress, label: role === "AUDITOR" ? `Demo Auditor ${auditor}` : `Demo ${role === "USER" ? "Policyholder" : role.charAt(0) + role.slice(1).toLowerCase()}` };
}

export function modePath(to, mode = resolveMode(), search = window.location.search) {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//") || mode !== "explore" || /^\/explore(?:\/|$)/.test(to)) return to;
  const url = new URL(`/explore${to === "/" ? "" : to}`, window.location.origin);
  if (url.pathname.startsWith("/explore/auditor")) url.searchParams.set("auditor", String(demoActor(window.location.pathname, search).auditor));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function assertLiveService() {
  if (resolveMode() === "explore") throw new Error("Explore Demo: live wallet, RPC, encryption and upload services are disabled.");
}

export function referenceNow() {
  return resolveMode() === "explore" ? new Date(DEMO_REFERENCE_DATE) : new Date();
}
