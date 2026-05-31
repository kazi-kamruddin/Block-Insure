import { useWallet } from "../context/useWallet";

export default function UserDashboardPage() {
  const { walletAddress, role } = useWallet();

  return (
    <section className="page-container">
      <h2>User Dashboard</h2>
      <p>Wallet: {walletAddress}</p>
      <p>Role: {role}</p>
      <p>Next: policy list, policy purchase, claim submission, and claim tracking.</p>
    </section>
  );
}