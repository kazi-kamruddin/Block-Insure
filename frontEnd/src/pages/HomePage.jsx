import { Link } from "react-router-dom";
import { useWallet } from "../context/useWallet";
import "../styles/pages/HomePage.css";

export default function HomePage() {
  const { isConnected, walletAddress, role } = useWallet();

  return (
    <section className="page-container page-home">
      <h1>Block-Insure</h1>
      <p>Transparent insurance claim management prototype.</p>

      {isConnected ? (
        <div className="card">
          <p>Connected wallet: {walletAddress}</p>
          <p>Backend role: {role}</p>
        </div>
      ) : (
        <p>Connect wallet to begin.</p>
      )}

      <div className="card-row">
        <Link to="/user/dashboard">User Dashboard</Link>
        <Link to="/admin/dashboard">Admin Dashboard</Link>
        <Link to="/auditor/dashboard">Auditor Dashboard</Link>
      </div>
    </section>
  );
}
