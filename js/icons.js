// Ikony interfejsu (SVG, dziedziczą kolor przez currentColor).
const svg = (d, { fill = true, size = 24 } = {}) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ${fill
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;

export const icons = {
  play: svg('<path d="M7.5 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L9.1 3.9c-.7-.4-1.6.1-1.6.9z"/>'),
  pause: svg('<rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>'),
  prev: svg('<rect x="4" y="5" width="2.4" height="14" rx="1"/><path d="M19.5 6.1v11.8c0 .8-.9 1.3-1.6.8L9.6 13c-.6-.4-.6-1.4 0-1.8l8.3-5.8c.7-.5 1.6 0 1.6.7z"/>'),
  next: svg('<rect x="17.6" y="5" width="2.4" height="14" rx="1"/><path d="M4.5 6.1v11.8c0 .8.9 1.3 1.6.8l8.3-5.7c.6-.4.6-1.4 0-1.8L6.1 5.4c-.7-.5-1.6 0-1.6.7z"/>'),
  back: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>', { fill: false }),
  forward: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>', { fill: false }),
  car: svg('<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M4 12h16v4.5H4z"/><circle cx="7.5" cy="14.3" r=".6"/><circle cx="16.5" cy="14.3" r=".6"/><path d="M6.5 16.5V19M17.5 16.5V19"/>', { fill: false }),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>', { fill: false }),
  download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>', { fill: false }),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', { fill: false }),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', { fill: false }),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { fill: false }),
  external: svg('<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>', { fill: false }),
  note: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>', { fill: false }),
};
