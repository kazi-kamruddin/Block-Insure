import "../styles/pages/PlaceholderPage.css";

export default function PlaceholderPage({ title }) {
  return (
    <section className="page-container page-placeholder">
      <h2>{title}</h2>
      <p>This page shell is ready. We will wire functionality next.</p>
    </section>
  );
}
