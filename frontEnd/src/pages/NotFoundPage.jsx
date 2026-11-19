import { Link } from "react-router-dom";
import "../styles/pages/NotFoundPage.css";

export default function NotFoundPage() {
  return (
    <section className="page-container page-not-found">
      <div className="card not-found-card">
        <h1>Page not found</h1>
        <p>
          The requested workspace or document link does not match an available route.
        </p>
        <div className="action-row justify-center">
          <Link to="/">Go home</Link>
          <Link className="button-secondary" to="/policies">
            Browse policies
          </Link>
        </div>
      </div>
    </section>
  );
}
