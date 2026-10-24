'use client';

import { useEffect, useState } from 'react';

export interface AskOptions {
  title: string;
  body: string;
  yes: string;
  no: string;
  danger?: boolean;
}

/** window leaf dialog — a11y: role=dialog + Esc + फ़ोकस दरवाज़े. पूछता है, चुपचाप कभी नहीं. */
export default function AskDialog({ options, onResolve }: {
  options: AskOptions | null;
  onResolve: (yes: boolean) => void;
}) {
  const [open, setOpen] = useState(!!options);
  useEffect(() => setOpen(!!options), [options]);
  if (!options || !open) return null;

  return (
    <div
      className="overlay"
      onClick={() => onResolve(false)}
      onKeyDown={(e) => e.key === 'Escape' && onResolve(false)}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{options.title}</h3>
        <p>{options.body}</p>
        <div className="acts">
          <button className="bigbtn" autoFocus onClick={() => onResolve(false)}>{options.no}</button>
          <button
            className="bigbtn"
            style={options.danger ? { background: 'var(--red)' } : undefined}
            onClick={() => onResolve(true)}
          >
            {options.yes}
          </button>
        </div>
      </div>
    </div>
  );
}
