// Tiny DOM helpers. No framework, no build step, no npm install.
// Text always goes in as text — never innerHTML with user or provider data (§8).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only ever for literal icon markup
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(el, ...children) { clear(el); append(el, children); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);

/** Inline SVG icons, 16px, currentColor. */
export function icon(name, size = 15) {
  const paths = {
    copy: '<rect x="6" y="6" width="12" height="13" rx="2"/><path d="M4 14V5a2 2 0 0 1 2-2h8"/>',
    edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  };
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size); el.setAttribute('height', size);
  el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = paths[name] ?? '';
  return el;
}

let toastTimer;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(label);
  } catch {
    // Clipboard access is denied in some contexts; fall back rather than fail.
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, String(text));
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label); } catch { toast('Could not copy'); }
    ta.remove();
  }
}

/** A value with a copy button. Missing values say so rather than showing blank. */
export function valueCell(value, { missingLabel = 'Needs review' } = {}) {
  if (value === null || value === undefined || value === '') {
    return h('span', { class: 'cellval' }, h('span', { class: 'missing' }, missingLabel));
  }
  return h('span', { class: 'cellval' },
    h('span', {}, String(value)),
    h('button', {
      class: 'copy', type: 'button', title: `Copy ${value}`,
      'aria-label': `Copy ${value}`,
      onClick: (e) => { e.stopPropagation(); copyText(value); },
    }, icon('copy', 13)),
  );
}

/** Click-to-edit text. Enter saves, Escape cancels — no dialog (§7). */
export function editable(value, onSave, { placeholder = 'Add', label = 'value' } = {}) {
  const span = h('button', {
    class: 'editable', type: 'button',
    'aria-label': `Edit ${label}`,
    onClick: () => startEdit(),
  }, value === null || value === undefined || value === '' ? h('span', { class: 'missing' }, placeholder) : String(value));

  function startEdit() {
    const input = h('input', {
      class: 'field', value: value ?? '', 'aria-label': `Edit ${label}`,
      style: { maxWidth: '26ch' },
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(span); }
        e.stopPropagation(); // never let a shortcut fire while typing
      },
      onBlur: () => commit(input.value),
    });
    span.replaceWith(input);
    input.focus();
    input.select();
  }

  let committed = false;
  function commit(v) {
    if (committed) return;
    committed = true;
    onSave(v.trim());
  }

  return span;
}

export function confidenceBadge(band, confidence) {
  return h('span', { class: `badge ${band.key}`, title: `${Math.round(confidence * 100)}% confidence` },
    h('span', { class: 'g', 'aria-hidden': 'true' }, band.icon),
    h('span', {}, band.label),
  );
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
