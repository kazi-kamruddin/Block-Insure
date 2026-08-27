export default function PaginationControls({ pagination, onPageChange }) {
  if (!pagination || pagination.totalPages <= 1) return null;

  return (
    <nav className="action-row" aria-label="Pagination">
      <button
        type="button"
        disabled={!pagination.hasPreviousPage}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {pagination.page} of {pagination.totalPages} ({pagination.total}{" "}
        total)
      </span>
      <button
        type="button"
        disabled={!pagination.hasNextPage}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
