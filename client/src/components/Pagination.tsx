import type { PageMeta } from '../types';

interface PaginationProps {
  meta: PageMeta;
  onPageChange: (page: number) => void;
}

export function Pagination({ meta, onPageChange }: PaginationProps) {
  if (meta.totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn"
        disabled={meta.page <= 1}
        onClick={() => {
          onPageChange(meta.page - 1);
        }}
      >
        Previous
      </button>
      <span>
        Page {meta.page} of {meta.totalPages}
      </span>
      <button
        type="button"
        className="btn"
        disabled={meta.page >= meta.totalPages}
        onClick={() => {
          onPageChange(meta.page + 1);
        }}
      >
        Next
      </button>
    </nav>
  );
}
