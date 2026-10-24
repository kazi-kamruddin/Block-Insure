import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, saveProfile, requestEmailVerification, confirmEmailVerification } from "../services/api";
import { useWallet } from "../context/useWallet";

function ProfileForm({ user }) {
  const client = useQueryClient();
  const [fields, setFields] = useState({ name: user.name || "", email: user.email || "", phone: user.phone || "" });
  const mutation = useMutation({ mutationFn: saveProfile, onSuccess: () => client.invalidateQueries({ queryKey: ["profile"] }) });
  return <form className="card form-grid max-w-xl" onSubmit={(event) => { event.preventDefault(); mutation.mutate(fields); }}>
    <p className="break-all">Wallet: {user.walletAddress}</p>
    <p>These contact details are self-reported. Saving a profile does not verify your identity or change your permissions. Do not enter national identity documents.</p>
    {[ ["name", "Display name", "text", 100], ["email", "Email", "email", 254], ["phone", "Phone", "tel", 30] ].map(([key, label, type, maxLength]) => <label key={key}>{label}<input type={type} autoComplete={key === "phone" ? "tel" : key} maxLength={maxLength} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></label>)}
    {mutation.error && <p role="alert">{mutation.error.response?.data?.message || "Profile could not be saved."}</p>}
    {mutation.isSuccess && <p role="status">Profile saved.</p>}
    <button disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save profile"}</button>
  </form>;
}

function EmailVerification({ user }) {
  const client = useQueryClient();
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState("");
  const request = useMutation({ mutationFn: requestEmailVerification, onSuccess: (data) => { setChallenge(data); setOtp(data.demoOtp || ""); } });
  const confirm = useMutation({ mutationFn: () => confirmEmailVerification({ challengeId: challenge.challengeId, otp }), onSuccess: () => { setChallenge(null); setOtp(""); client.invalidateQueries({ queryKey: ["profile"] }); } });
  const error = request.error || confirm.error;
  return <section className="card form-grid max-w-xl" aria-labelledby="email-verification-title">
    <h3 id="email-verification-title">Email delivery</h3>
    <p className="[overflow-wrap:anywhere]">Saved recipient: {user.email || "No email saved"}. Unsaved form edits do not change the recipient.</p>
    <p>{user.emailVerified ? "Email verified for payment codes." : "Save your email above, then verify it to receive real payment codes. Simulation never verifies a mailbox."}</p>
    <button type="button" disabled={!user.email || request.isPending} onClick={() => { confirm.reset(); request.mutate(); }}>{request.isPending ? "Requesting…" : "Request email verification code"}</button>
    {challenge && <><p role="status">{challenge.deliveryMessage}</p>{challenge.demoOtp && <p>Simulated code: <strong>{challenge.demoOtp}</strong>. No email was sent.</p>}
      <label>Email verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} /></label>
      <button type="button" disabled={otp.length !== 6 || confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "Verifying…" : "Confirm email code"}</button></>}
    {error && <p role="alert">{error.response?.data?.message || "Email verification unavailable. Check your profile and retry."}</p>}
    {confirm.data && <p role="status">{confirm.data.message}</p>}
  </section>;
}

function EvidenceRecovery({ walletAddress }) {
  const [status, setStatus] = useState(null);
  const mutation = useMutation({ mutationFn: async (restore) => {
    const service = await import("../services/evidenceEncryption");
    if (restore) await service.restoreEvidenceAccess(walletAddress);
    return service.getEvidenceRecoveryStatus(walletAddress);
  }, onSuccess: setStatus });
  return <section className="card form-grid max-w-xl" aria-labelledby="evidence-recovery-title">
    <h3 id="evidence-recovery-title">Evidence access recovery</h3>
    <p>Evidence keys are protected in this browser. On another browser, use the original wallet to decrypt your existing encrypted backup. This does not rotate keys or grant new access.</p>
    <p>Recovery requires the same wallet to reproduce its recovery signature and the saved backup to remain available. Reject unexpected signing prompts. Never share that signature or export private keys.</p>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(false)}>Check evidence recovery</button>
      <button type="button" disabled={mutation.isPending || !status?.recoverable} onClick={() => mutation.mutate(true)}>Restore evidence access</button></div>
    {mutation.isPending && <p role="status">Checking or restoring access…</p>}
    {status && <p role="status">{status.local ? "Browser identity present." : "No identity in this browser."} {status.recoverable ? "Encrypted backup available." : "No recoverable registered backup."}</p>}
    {mutation.error && <p role="alert">{mutation.error.message || "Recovery failed. Reconnect the original wallet and retry."}</p>}
  </section>;
}

export default function ProfilePage() {
  const { walletAddress } = useWallet();
  const query = useQuery({ queryKey: ["profile", walletAddress], queryFn: getCurrentUser });
  return <section className="page-container"><h2>My profile</h2>{query.isPending ? <p role="status">Loading profile…</p> : query.isError ? <p role="alert">Profile unavailable. <button onClick={() => query.refetch()}>Retry</button></p> : <><ProfileForm key={`profile:${walletAddress}`} user={query.data.user} /><EmailVerification key={`email:${walletAddress}:${query.data.user.email}`} user={query.data.user} /><EvidenceRecovery key={`recovery:${walletAddress}`} walletAddress={walletAddress} /></>}</section>;
}
