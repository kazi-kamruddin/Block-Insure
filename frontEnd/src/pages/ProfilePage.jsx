import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, saveProfile } from "../services/api";
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

export default function ProfilePage() {
  const { walletAddress } = useWallet();
  const query = useQuery({ queryKey: ["profile", walletAddress], queryFn: getCurrentUser });
  return <section className="page-container"><h2>My profile</h2>{query.isPending ? <p role="status">Loading profile…</p> : query.isError ? <p role="alert">Profile unavailable. <button onClick={() => query.refetch()}>Retry</button></p> : <ProfileForm key={walletAddress} user={query.data.user} />}</section>;
}
