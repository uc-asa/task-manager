/** Decorative icons: always paired with text, so they are hidden from assistive technology. */
const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export const PlusIcon = () => (
  <svg {...base} className="icon">
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...base} className="icon">
    <rect x="3.5" y="4.5" width="13" height="12" rx="2.5" />
    <path d="M3.5 8.5h13M7 3v3M13 3v3" />
  </svg>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...base} className={`icon icon-chevron ${open ? 'is-open' : ''}`}>
    <path d="m5 8 5 5 5-5" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...base} className="icon search-icon">
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.5 13.5 3.5 3.5" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} className="icon">
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </svg>
);
