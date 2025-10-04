import React from 'react';

const paths = {
  home: (
    <>
      <path d="M3 11.5L12 3l9 8.5" />
      <path d="M5 10.5V21a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-10.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4z" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v8" />
      <path d="M12 6h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </>
  ),
  map: (
    <>
      <path d="M2 6.5l7-3 6 3 7-3v14l-7 3-6-3-7 3z" />
      <path d="M9 3.5v14" />
      <path d="M15 6.5v14" />
    </>
  ),
  bolt: (
    <>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M19.4 15a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.5-2.3.6a7.6 7.6 0 0 0-1.7-1l-.3-2.4H9.8l-.3 2.4a7.6 7.6 0 0 0-1.7 1L5.5 7.3l-2 3.5 2 1.2a7.8 7.8 0 0 0 .1 2L3.5 16l2 3.5 2.3-.6c.5.4 1.1.7 1.7 1l.3 2.4h4.3l.3-2.4c.6-.3 1.2-.6 1.7-1l2.3.6 2-3.5z" />
    </>
  ),
  menu: (
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 4h16v10h-4l-2 3h-4l-2-3H4z" />
      <path d="M12 2v8" />
      <path d="M9 7l3 3 3-3" />
    </>
  ),
  send: (
    <>
      <path d="M4 20h16v-10h-4l-2-3h-4l-2 3H4z" />
      <path d="M12 22v-8" />
      <path d="M15 17l-3-3-3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a18 18 0 0 1 0 18" />
      <path d="M12 3a18 18 0 0 0 0 18" />
    </>
  ),
  diamond: (
    <>
      <path d="M12 3l4 5-4 13-4-13 4-5z" />
      <path d="M8 8h8" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <rect x="3" y="3" width="13" height="13" rx="2" />
    </>
  ),
  bitcoin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 7h4a2.5 2.5 0 0 1 0 5h-4z" />
      <path d="M10 12h4a2.5 2.5 0 0 1 0 5h-4z" />
      <path d="M11 5v3" />
      <path d="M13 5v3" />
      <path d="M11 16v3" />
      <path d="M13 16v3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 21v-12" />
      <path d="M16 13l-4-4-4 4" />
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 1.85H8a2 2 0 0 1-2-1.85L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6l1-2h4l1 2" />
    </>
  ),
  'chevron-up': (
    <>
      <path d="M18 15l-6-6-6 6" />
    </>
  ),
  'chevron-down': (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
};

function Icon({ name, size = 20, className = '', title }) {
  const content = paths[name];
  if (!content) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : 'presentation'}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}

export default Icon;
