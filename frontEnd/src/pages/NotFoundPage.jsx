import { Link } from "react-router-dom";
import "../styles/pages/NotFoundPage.css";

export default function NotFoundPage() {
  return (
    <section className="page-container page-not-found">
      <h1>Page not found</h1>
      <Link to="/">Go home</Link>
    </section>
  );
}
