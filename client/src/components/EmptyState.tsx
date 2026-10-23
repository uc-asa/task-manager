interface EmptyStateProps {
  /** True when the list is empty because of the filters, not because there are no tasks. */
  filtered: boolean;
  onClearFilters: () => void;
}

export function EmptyState({ filtered, onClearFilters }: EmptyStateProps) {
  return (
    <div className="empty">
      <svg className="empty-icon" viewBox="0 0 48 48" aria-hidden="true">
        <rect
          x="9"
          y="6"
          width="30"
          height="36"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="m16 20 4 4 8-9M16 33h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p role="status">
        {filtered ? 'No tasks match your filters.' : 'No tasks yet. Add your first one above.'}
      </p>
      {filtered && (
        <button type="button" className="btn" onClick={onClearFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}
