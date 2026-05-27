import { Link, Outlet } from "react-router-dom";
import WalletConnectButton from "../components/WalletConnectButton";

export default function PublicLayout() {
  return (
    <div>
      <nav className="navbar">
        <Link className="brand" to="/">
          Block-Insure
        </Link>

        <div className="nav-links">
          <Link to="/user/dashboard">User</Link>
          <Link to="/admin/dashboard">Admin</Link>
          <Link to="/auditor/dashboard">Auditor</Link>
        </div>

        <WalletConnectButton />
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}