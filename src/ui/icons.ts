const PATHS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  start: '<path d="M6 5v14"/><path d="M18 6.5v11a.8.8 0 0 1-1.25.66L9 12.66a.8.8 0 0 1 0-1.32l7.75-5.5A.8.8 0 0 1 18 6.5z"/>',
  end: '<path d="M18 5v14"/><path d="M6 6.5v11a.8.8 0 0 0 1.25.66l7.75-5.5a.8.8 0 0 0 0-1.32L7.25 5.84A.8.8 0 0 0 6 6.5z"/>',
  back: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  forward: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  fit: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  audio: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  layers: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="9" r="5.5"/><circle cx="12" cy="15" r="5.5"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/>',
  cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  nodes: '<rect x="2.5" y="4" width="7" height="6" rx="2"/><rect x="14.5" y="14" width="7" height="6" rx="2"/><path d="M9.5 7h3a2 2 0 0 1 2 2v5"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="7.8" cy="11" r="1.2" fill="currentColor"/><circle cx="16.2" cy="11" r="1.2" fill="currentColor"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
  marker: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  markIn: '<path d="M9 4H6v16h3"/><path d="M13 12h6M16 9l3 3-3 3"/>',
  markOut: '<path d="M15 4h3v16h-3"/><path d="M5 12h6M8 9l3 3-3 3"/>',
  insert: '<rect x="3" y="8" width="5" height="8" rx="1.5"/><rect x="16" y="8" width="5" height="8" rx="1.5"/><path d="M12 5v14M10 7l2-2 2 2"/>',
  overwrite: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M12 3v10M9.5 10.5 12 13l2.5-2.5"/>',
  append: '<rect x="3" y="8" width="11" height="8" rx="2"/><path d="M17 12h4M19 10v4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  log: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  folderMinus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9.5 13.5h5"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bookmarkPlus: '<path d="M6 3h12v18l-6-4-6 4z"/><path d="M12 7v6M9 10h6"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  pipette: '<path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3-3 3 3-3 3M12 9l3 3"/>',
  multicam: '<rect x="2" y="3" width="9" height="7" rx="2"/><rect x="13" y="3" width="9" height="7" rx="2"/><rect x="2" y="14" width="9" height="7" rx="2"/><rect x="13" y="14" width="9" height="7" rx="2"/>',
  videoPlus: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5M9 9.5v5M6.5 12h5"/>',
  audioPlus: '<path d="M10 5 5.5 9H3v6h2.5l4.5 4z"/><path d="M18 8v8M14 12h8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

export function iconPath(name: IconName): string {
  return PATHS[name];
}

export function iconButton(name: IconName, label: string, props: Record<string, unknown> = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn icon ${(props.class as string | undefined) ?? ''}`.trim();
  button.title = label;
  button.setAttribute('aria-label', label);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class' || value === undefined || value === null || value === false) continue;
    if (key === 'dataset') Object.assign(button.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') button.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else button.setAttribute(key, value === true ? '' : String(value));
  }
  button.append(icon(name, 17));
  return button;
}
