// Card Scanner — application shell.
// Zero build step: this is an ES module the browser runs directly.

import { h, mount, clear, icon, toast, copyText, valueCell, editable, confidenceBadge, formatDuration } from './dom.js';
import * as store from '../storage.js';
import { JobQueue, JOB } from '../queue.js';
import { OcrPool } from '../ocr.js';
import { PokemonTcgdexProvider } from '../providers/pokemon-tcgdex.js';
import { processImage } from '../pipeline.js';
import { newCard, band, correct, valueOf, isAutoAcceptable, STATE, IDENTIFICATION_FIELDS, cryptoId } from '../model.js';
import { findDuplicates, mergeToQuantity } from '../dupes.js';
import { renderTitle, DEFAULT_TEMPLATE, EBAY_TITLE_LIMIT } from '../title.js';
import {
  toCsv, parseTemplate, suggestMapping, buildTemplateRows, validateRows,
  TEXT_SAFE_FIELDS, MISSING,
} from '../csv.js';
import { ADVICE } from '../imagequality.js';
import {
  CARD_TYPES, UNGRADED_CONDITIONS, GRADERS, GRADES, ACTIONS, FORMATS, DURATIONS,
  cardTypeOf, isGraded, ebayCardValues, graderId, gradeId, ungradedConditionId,
  starterTemplate, formatPrice,
} from '../ebay.js';
import { rangeIds, pruneSelection, selectionState } from '../selection.js';

// --- application state ----------------------------------------------------

const app = {
  view: 'upload',
  project: null,
  projects: [],
  cards: [],
  filter: 'all',
  search: '',
  sort: { key: 'createdAt', dir: 'asc' },
  reviewIndex: 0,
  textsOpen: false,      // the "everything we read" list on the review screen
  queue: null,
  ocr: new OcrPool(),
  provider: new PokemonTcgdexProvider({ language: 'en' }),
  fastScan: true,
  titleTemplate: DEFAULT_TEMPLATE,
  template: null,      // parsed eBay template
  mapping: {},
  urls: new store.UrlCache(),
  progress: null,
  // What the user chose for the eBay file. Persisted, so it survives a reload.
  ebay: {
    action: 'VerifyAdd', format: 'FixedPrice', duration: 'GTC', mark: '.', bom: true,
    cardType: '', condition: '', price: '',   // filled in only for cards that have none
  },
  selected: new Set(),   // card ids ticked in the cards table
  anchorId: null,        // last ticked row: where a shift-click range starts
  confirmDelete: false,  // the bulk bar is asking "are you sure?"
};

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const picker = document.getElementById('filepicker');

// The top bar is sticky and wraps on narrow screens, so publish its real height
// for anything that has to sit just beneath it.
const topbar = document.querySelector('.topbar');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}).observe(topbar);

// --- boot -----------------------------------------------------------------

init().catch((err) => {
  mount(view, h('div', { class: 'panel notice err' },
    h('h3', {}, 'Card Scanner could not start'),
    h('p', {}, err.message),
    h('p', { class: 'tiny muted' }, 'Your browser may be blocking local storage. Private windows sometimes do.'),
  ));
});

async function init() {
  app.projects = await store.all('projects');
  if (app.projects.length === 0) {
    app.project = await createProject('My first batch');
  } else {
    const lastId = await store.setting('lastProject');
    app.project = app.projects.find((p) => p.id === lastId) ?? app.projects[0];
  }
  app.titleTemplate = (await store.setting('titleTemplate')) ?? DEFAULT_TEMPLATE;
  app.provider.language = (await store.setting('language')) ?? 'en';
  app.ebay = { ...app.ebay, ...((await store.setting('ebay')) ?? {}) };
  await store.sweepOrphanBlobs().catch(() => {}); // housekeeping must never stop the app starting
  await loadCards();
  render();
  wireGlobalKeys();
}

async function loadCards() {
  app.cards = await store.all('cards', 'projectId', app.project.id);
  app.cards.sort((a, b) => a.createdAt - b.createdAt);
  app.selected = pruneSelection(app.selected, app.cards.map((c) => c.id));
}

/** Remove cards and their photos, and release the object URLs that pointed at them. */
async function deleteCards(ids) {
  const { removed, blobIds } = await store.removeCards(ids);
  for (const id of blobIds) app.urls.release(id);
  await loadCards();
  return removed;
}

async function createProject(name) {
  const p = { id: cryptoId(), name, createdAt: Date.now() };
  await store.put('projects', p);
  app.projects.push(p);
  await store.setting('lastProject', p.id);
  return p;
}

// --- derived --------------------------------------------------------------

const counts = () => {
  const c = { all: app.cards.length, review: 0, ready: 0, failed: 0 };
  for (const card of app.cards) {
    if (card.state === STATE.NEEDS_REVIEW) c.review++;
    else if (card.state === STATE.FAILED) c.failed++;
    else c.ready++;
  }
  c.duplicates = findDuplicates(app.cards, valueOf).reduce((n, g) => n + g.count, 0);
  return c;
};

function visibleCards() {
  let list = [...app.cards];
  if (app.filter === 'review') list = list.filter((c) => c.state === STATE.NEEDS_REVIEW);
  else if (app.filter === 'ready') list = list.filter((c) => c.state !== STATE.NEEDS_REVIEW && c.state !== STATE.FAILED);
  else if (app.filter === 'failed') list = list.filter((c) => c.state === STATE.FAILED);
  else if (app.filter === 'duplicates') {
    const ids = new Set(findDuplicates(app.cards, valueOf).flatMap((g) => g.cards.map((c) => c.id)));
    list = list.filter((c) => ids.has(c.id));
  }

  const q = app.search.trim().toLowerCase();
  if (q) {
    list = list.filter((c) =>
      IDENTIFICATION_FIELDS.some((f) => String(valueOf(c, f) ?? '').toLowerCase().includes(q)),
    );
  }

  const { key, dir } = app.sort;
  const sign = dir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    const va = key === 'confidence' ? a.confidence : key === 'createdAt' ? a.createdAt : String(valueOf(a, key) ?? '');
    const vb = key === 'confidence' ? b.confidence : key === 'createdAt' ? b.createdAt : String(valueOf(b, key) ?? '');
    if (va < vb) return -1 * sign;
    if (va > vb) return 1 * sign;
    return 0;
  });
  return list;
}

// --- render ---------------------------------------------------------------

function render() {
  renderTabs();
  const views = { upload: viewUpload, scan: viewScan, cards: viewCards, review: viewReview, export: viewExport };
  mount(view, (views[app.view] ?? viewUpload)());
}

function renderTabs() {
  const c = counts();
  const defs = [
    ['upload', 'Upload', null],
    ['cards', 'Cards', c.all],
    ['review', 'Review', c.review],
    ['export', 'Export', null],
  ];
  mount(tabs, defs.map(([key, label, count]) =>
    h('button', {
      class: 'tab', role: 'tab', 'aria-selected': String(app.view === key),
      onClick: () => go(key),
    }, label, count ? h('span', { class: 'count' }, String(count)) : null),
  ));
}

function go(v) {
  app.view = v;
  app.singleCardId = null; // a card opened on its own is left behind with the screen
  if (v === 'review') app.reviewIndex = 0;
  render();
}

// --- upload view ----------------------------------------------------------

function viewUpload() {
  const zone = h('div', {
    class: 'dropzone',
    onDragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    onDragleave: () => zone.classList.remove('over'),
    onDrop: (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (files.length) startBatch(files);
      else toast('Those files are not images');
    },
  },
    h('h2', {}, 'Drop your card photos here'),
    h('p', { class: 'muted' }, 'One card per photo. Front only is enough.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
      h('button', { class: 'btn primary', onClick: () => picker.click() }, icon('upload'), 'Choose images'),
    ),
    h('p', { class: 'tiny muted', style: { marginTop: '14px' } }, 'JPG · PNG · WEBP · HEIC'),
    h('div', { class: 'steps' },
      h('span', {}, 'Upload'), h('span', {}, 'Scan'), h('span', {}, 'Review'), h('span', {}, 'Export'),
    ),
  );

  picker.onchange = () => {
    const files = [...picker.files];
    picker.value = '';
    if (files.length) startBatch(files);
  };

  return h('div', { class: 'narrow' },
    zone,
    h('div', { class: 'panel', style: { marginTop: '18px' } },
      h('div', { class: 'row' },
        h('div', {},
          h('h3', {}, app.project.name),
          h('p', { class: 'tiny muted', style: { margin: 0 } },
            `${app.cards.length} cards · ${counts().review} need review`),
        ),
        h('div', { class: 'spacer' }),
        h('select', {
          class: 'field', style: { width: 'auto' },
          'aria-label': 'Current batch',
          onChange: async (e) => {
            if (e.target.value === '__new') {
              const name = prompt('Name this batch');
              if (!name) { render(); return; }
              app.project = await createProject(name);
            } else {
              app.project = app.projects.find((p) => p.id === e.target.value);
              await store.setting('lastProject', app.project.id);
            }
            await loadCards();
            render();
          },
        },
          ...app.projects.map((p) => h('option', { value: p.id, selected: p.id === app.project.id }, p.name)),
          h('option', { value: '__new' }, '+ New batch'),
        ),
      ),
    ),

    h('div', { class: 'panel' },
      h('h3', {}, 'Scanning options'),
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('label', { class: 'row', style: { gap: '8px' } },
          h('input', {
            type: 'checkbox', checked: app.fastScan,
            onChange: (e) => { app.fastScan = e.target.checked; },
          }),
          h('span', {}, 'Fast Scan — accept confident matches automatically'),
        ),
      ),
      h('div', { class: 'row' },
        h('label', { class: 'lbl', for: 'lang' }, 'Card language'),
        h('select', {
          id: 'lang', class: 'field', style: { width: 'auto' },
          onChange: async (e) => {
            app.provider = new PokemonTcgdexProvider({ language: e.target.value });
            await store.setting('language', e.target.value);
          },
        },
          ...[['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['ja', '日本語']]
            .map(([v, l]) => h('option', { value: v, selected: app.provider.language === v }, l)),
        ),
      ),
      h('p', { class: 'tiny muted', style: { marginTop: '12px', marginBottom: 0 } },
        'Pokémon cards are supported today, using the open TCGdex database.'),
    ),

    h('div', { class: 'panel notice' },
      h('strong', {}, 'Your photos stay on this device. '),
      'Text recognition runs in your browser. Only the words read from a card — a name and a number — are sent to the card database to look it up. Your images are never uploaded.',
    ),
  );
}

// --- batch processing -----------------------------------------------------

async function startBatch(files) {
  app.view = 'scan';
  app.progress = { total: files.length, startedAt: Date.now(), ocrReady: false };
  render();

  await app.ocr.init();
  app.progress.ocrReady = true;

  app.queue = new JobQueue({
    concurrency: 3,
    maxAttempts: 3,
    worker: async (job) => {
      const card = await processImage({
        file: job.payload.file,
        projectId: app.project.id,
        provider: app.provider,
        ocr: app.ocr,
      });
      if (app.fastScan && isAutoAcceptable(card)) card.state = STATE.VERIFIED;
      await store.put('cards', card);
      app.cards.push(card);
      return card.id;
    },
  });

  app.queue.addEventListener('progress', () => { if (app.view === 'scan') render(); renderTabs(); });
  app.queue.addEventListener('breaker', () => { if (app.view === 'scan') render(); });
  app.queue.addEventListener('idle', async () => {
    if (app.view === 'scan') { app.view = 'cards'; await loadCards(); render(); }
  });

  files.forEach((file, i) => app.queue.add(`${Date.now()}-${i}`, { file }));
  app.queue.run();
}

function viewScan() {
  const q = app.queue;
  const s = q ? q.stats : { total: app.progress?.total ?? 0, done: 0, succeeded: 0, failed: 0, progress: 0, etaMs: 0 };
  const scanned = app.cards.filter((c) => c.state !== STATE.FAILED);
  const high = scanned.filter((c) => band(c.confidence, c.margin).key === 'HIGH').length;
  const needsReview = scanned.filter((c) => c.state === STATE.NEEDS_REVIEW).length;

  return h('div', { class: 'narrow' },
    h('div', { class: 'panel' },
      h('h2', {}, app.progress?.ocrReady ? 'Scanning your cards' : 'Getting the text recogniser ready'),
      h('p', { class: 'muted' }, app.progress?.ocrReady
        ? `${s.done} of ${s.total} processed`
        : 'This happens once and is then cached by your browser.'),
      h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(s.progress * 100)}%` } })),

      h('div', { class: 'statrow' },
        h('div', { class: 'stat high' }, h('b', {}, String(high)), h('span', {}, 'Identified')),
        h('div', { class: 'stat medium' }, h('b', {}, String(needsReview)), h('span', {}, 'Need review')),
        h('div', { class: 'stat low' }, h('b', {}, String(s.failed)), h('span', {}, 'Failed')),
        h('div', { class: 'stat' }, h('b', {}, formatDuration(s.etaMs)), h('span', {}, 'Remaining')),
      ),

      q?.breakerOpen
        ? h('div', { class: 'notice err', style: { marginBottom: '12px' } },
            h('strong', {}, 'We stopped scanning. '),
            'The card database is not responding, so the rest of the batch would fail too. Your finished cards are safe.',
            h('div', { class: 'row', style: { marginTop: '10px' } },
              h('button', { class: 'btn small', onClick: () => { q.resume(); render(); } }, 'Try again'),
            ))
        : null,

      h('div', { class: 'row' },
        q && !q.paused
          ? h('button', { class: 'btn', onClick: () => { q.pause(); render(); } }, 'Pause')
          : h('button', { class: 'btn', onClick: () => { q?.resume(); render(); } }, 'Resume'),
        h('button', { class: 'btn', onClick: () => { q?.cancel(); go('cards'); } }, 'Stop'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onClick: () => go('cards') }, 'View results so far'),
      ),
    ),
    h('p', { class: 'tiny muted', style: { textAlign: 'center' } },
      'You can leave this page open in the background. Progress is saved as it goes.'),
  );
}

// --- cards table ----------------------------------------------------------

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'set', label: 'Set' },
  { key: 'number', label: 'Number' },
  { key: 'variant', label: 'Variant' },
  { key: 'year', label: 'Year' },
];

const PAGE = 100;

function viewCards() {
  const c = counts();
  const list = visibleCards();
  app.selected = pruneSelection(app.selected, list.map((x) => x.id));

  const filters = [
    ['all', 'All', c.all],
    ['review', 'Needs review', c.review],
    ['ready', 'Ready', c.ready],
    ['duplicates', 'Duplicates', c.duplicates],
    ['failed', 'Failed', c.failed],
  ];

  return h('div', {},
    h('div', { class: 'row', style: { marginBottom: '14px' } },
      h('h2', {}, app.project.name),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: () => go('upload') }, icon('upload'), 'Add more'),
      c.review ? h('button', { class: 'btn primary', onClick: () => go('review') }, `Review ${c.review}`) : null,
    ),

    h('div', { class: 'row', style: { marginBottom: '12px' } },
      ...filters.map(([key, label, n]) =>
        h('button', {
          class: `btn small ${app.filter === key ? 'primary' : 'ghost'}`,
          onClick: () => { app.filter = key; render(); },
        }, label, n ? ` (${n})` : ''),
      ),
      h('div', { class: 'spacer' }),
      h('input', {
        class: 'field', type: 'search', placeholder: 'Search cards…',
        'aria-label': 'Search cards', value: app.search,
        style: { width: '200px' },
        onInput: (e) => { app.search = e.target.value; renderTable(); },
      }),
    ),

    app.filter === 'duplicates' ? duplicatePanel() : null,

    list.length === 0
      ? h('div', { class: 'empty' },
          h('h3', {}, app.cards.length ? 'Nothing matches that filter' : 'No cards yet'),
          h('p', {}, app.cards.length ? 'Try a different filter or search.' : 'Upload some card photos to get started.'),
        )
      : h('div', { id: 'tablehost' }, cardTable(list)),
  );
}

function renderTable() {
  const host = document.getElementById('tablehost');
  if (!host) return;
  const list = visibleCards();
  app.selected = pruneSelection(app.selected, list.map((x) => x.id));
  mount(host, cardTable(list));
}

// --- selection ------------------------------------------------------------

function pick(e, id, shownIds) {
  const op = e.target.checked ? 'add' : 'delete';
  const ids = e.shiftKey && app.anchorId ? rangeIds(shownIds, app.anchorId, id) : [id];
  for (const x of ids) app.selected[op](x);
  app.anchorId = id;
  app.confirmDelete = false;
  syncSelectionUi();
}

function clearSelection() {
  app.selected.clear();
  app.anchorId = null;
  app.confirmDelete = false;
  syncSelectionUi();
  document.getElementById('selectall')?.focus();
}

/** Copy the selected cards as tab-separated rows, in the order shown on screen. */
function copySelected() {
  const rows = visibleCards().filter((c) => app.selected.has(c.id));
  copyText(
    rows.map((c) => COLUMNS.map((col) => valueOf(c, col.key) ?? '').join('\t')).join('\n'),
    `Copied ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`,
  );
}

async function deleteSelected() {
  const ids = [...app.selected];
  app.confirmDelete = false;
  try {
    const removed = await deleteCards(ids);
    app.selected.clear();
    app.anchorId = null;
    render();
    toast(`Deleted ${removed} ${removed === 1 ? 'card' : 'cards'}`);
  } catch {
    syncSelectionUi();
    toast('Something went wrong deleting those cards. Please try again.');
  }
}

/**
 * Update ticks, row highlights and the action bar in place. Re-rendering the
 * table would drop keyboard focus from the checkbox the user just pressed.
 */
function syncSelectionUi() {
  const host = document.getElementById('selbar-host');
  if (!host) return;
  const rows = [...document.querySelectorAll('#tablehost tbody tr[data-id]')];
  for (const tr of rows) {
    const on = app.selected.has(tr.dataset.id);
    tr.classList.toggle('selected', on);
    tr.querySelector('.selbox').checked = on;
  }
  const all = document.getElementById('selectall');
  if (all) {
    const s = selectionState(app.selected, rows.map((tr) => tr.dataset.id));
    all.checked = s.all;
    all.indeterminate = s.some;
  }
  mount(host, selectionBar(visibleCards()));
}

function selectionBar(list) {
  const n = app.selected.size;
  if (!n) return null;

  if (app.confirmDelete) {
    return h('div', { class: 'selbar danger', role: 'group', 'aria-label': 'Confirm delete' },
      h('span', {}, `Delete ${n} ${n === 1 ? 'card and its photo' : 'cards and their photos'}? This cannot be undone.`),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small danger', id: 'confirm-delete', onClick: deleteSelected }, icon('trash', 13), `Delete ${n}`),
      h('button', {
        class: 'btn small',
        onClick: () => { app.confirmDelete = false; syncSelectionUi(); document.getElementById('bulk-delete')?.focus(); },
      }, 'Cancel'),
    );
  }

  // The header ticks only the rows on screen. When every one of those is ticked
  // and more cards match, offer the rest — the user always sees the count first.
  const shownIds = list.slice(0, PAGE).map((c) => c.id);
  const offerAll = list.length > PAGE && n < list.length && selectionState(app.selected, shownIds).all;

  return h('div', { class: 'selbar', role: 'group', 'aria-label': 'Selected cards' },
    h('strong', {}, `${n} selected`),
    offerAll
      ? h('button', {
          class: 'btn small ghost',
          onClick: () => {
            for (const c of list) app.selected.add(c.id);
            syncSelectionUi();
            document.getElementById('bulk-delete')?.focus();
          },
        }, `Select all ${list.length}`)
      : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn small', onClick: copySelected }, icon('copy', 13), 'Copy'),
    h('button', {
      class: 'btn small danger', id: 'bulk-delete',
      onClick: () => { app.confirmDelete = true; syncSelectionUi(); document.getElementById('confirm-delete')?.focus(); },
    }, icon('trash', 13), 'Delete'),
    h('button', { class: 'btn small ghost', onClick: clearSelection }, 'Clear'),
  );
}

function cardTable(list) {
  // Render a window of rows. A DOM node per card at 1,000 cards is its own
  // outage (§4), so long lists page rather than rendering whole.
  const shown = list.slice(0, PAGE);
  const shownIds = shown.map((c) => c.id);

  const selectAll = h('input', {
    type: 'checkbox', class: 'selbox', id: 'selectall',
    'aria-label': 'Select all shown cards',
    onChange: (e) => {
      const op = e.target.checked ? 'add' : 'delete';
      for (const id of shownIds) app.selected[op](id);
      app.anchorId = null;
      app.confirmDelete = false;
      syncSelectionUi();
    },
  });
  const state = selectionState(app.selected, shownIds);
  selectAll.checked = state.all;
  selectAll.indeterminate = state.some;

  const head = h('tr', {},
    h('th', { scope: 'col', class: 'selcol' }, selectAll),
    h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Image')),
    ...COLUMNS.map((col) => h('th', { scope: 'col' },
      h('button', {
        onClick: () => {
          app.sort = { key: col.key, dir: app.sort.key === col.key && app.sort.dir === 'asc' ? 'desc' : 'asc' };
          renderTable();
        },
        'aria-label': `Sort by ${col.label}`,
      }, col.label, app.sort.key === col.key ? (app.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''),
    )),
    h('th', { scope: 'col' },
      h('button', {
        onClick: () => {
          app.sort = { key: 'confidence', dir: app.sort.key === 'confidence' && app.sort.dir === 'asc' ? 'desc' : 'asc' };
          renderTable();
        },
      }, 'Status', app.sort.key === 'confidence' ? (app.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''),
    ),
    h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')),
  );

  const body = shown.map((card, i) => {
    const b = band(card.confidence, card.margin);
    const img = h('img', { class: 'thumb', alt: '', loading: 'lazy' });
    app.urls.urlFor(card.images.thumb).then((u) => { if (u) img.src = u; });

    // The row number keeps the name unique for screen readers when several
    // cards are unidentified.
    const name = valueOf(card, 'name');
    const box = h('input', {
      type: 'checkbox', class: 'selbox',
      'aria-label': `Select card ${i + 1}${name ? `: ${name}` : ''}`,
      onClick: (e) => pick(e, card.id, shownIds),
    });
    const picked = app.selected.has(card.id);
    box.checked = picked;

    return h('tr', {
      class: [card.flags.length ? 'flagged' : '', picked ? 'selected' : ''].filter(Boolean).join(' '),
      dataset: { id: card.id },
    },
      h('td', { class: 'selcol' }, box),
      h('td', {}, img),
      ...COLUMNS.map((col) => h('td', {},
        editable(valueOf(card, col.key), async (v) => {
          const updated = correct(card, col.key, v);
          Object.assign(card, updated);
          await store.put('cards', card);
          renderTable(); renderTabs();
        }, { label: col.label, placeholder: card.flags.includes(col.key) ? 'Needs review' : 'Add' }),
        valueOf(card, col.key)
          ? h('button', {
              class: 'copy', type: 'button', 'aria-label': `Copy ${col.label}`,
              onClick: (e) => { e.stopPropagation(); copyText(valueOf(card, col.key)); },
            }, icon('copy', 13))
          : null,
      )),
      h('td', {}, confidenceBadge(b, card.confidence)),
      h('td', {},
        h('button', {
          class: 'btn small ghost', onClick: () => { openReviewFor(card.id); },
          'aria-label': 'Open this card',
        }, icon('edit', 13)),
      ),
    );
  });

  return h('div', {},
    h('div', { id: 'selbar-host', 'aria-live': 'polite' }, selectionBar(list)),
    h('div', { class: 'tablewrap' },
      h('table', {},
        h('caption', { class: 'sr-only' }, `${list.length} cards`),
        h('thead', {}, head),
        h('tbody', {}, body),
      ),
    ),
    list.length > PAGE
      ? h('p', { class: 'tiny muted', style: { marginTop: '10px' } },
          `Showing the first ${PAGE} of ${list.length}. Use search or a filter to narrow it down.`)
      : null,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', {
        class: 'btn small', onClick: () => copyText(list.map((c) =>
          COLUMNS.map((col) => valueOf(c, col.key) ?? '').join('\t')).join('\n'), `Copied ${list.length} rows`),
      }, icon('copy', 13), 'Copy these as rows'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small primary', onClick: () => go('export') }, icon('download', 13), 'Export'),
    ),
  );
}

function duplicatePanel() {
  const groups = findDuplicates(app.cards, valueOf);
  if (!groups.length) return null;
  return h('div', { class: 'panel', style: { marginBottom: '14px' } },
    h('h3', {}, `${groups.length} possible duplicate${groups.length === 1 ? '' : 's'}`),
    h('p', { class: 'tiny muted' }, 'Nothing is deleted automatically. Choose what happens to each group.'),
    ...groups.slice(0, 20).map((g) => h('div', { class: 'row', style: { padding: '7px 0', borderTop: '1px solid var(--border)' } },
      h('span', {}, `${valueOf(g.cards[0], 'name') ?? 'Unidentified'} · ${valueOf(g.cards[0], 'number') ?? '—'}`),
      h('span', { class: 'tiny muted' }, `scanned ${g.count} times`),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'btn small',
        onClick: async () => {
          const { keep, remove } = mergeToQuantity(g.cards);
          await store.put('cards', keep);
          await deleteCards(remove);
          render();
          toast(`Merged into one listing, quantity ${keep.user.quantity}`);
        },
      }, `Keep 1 × ${g.count}`),
      h('button', { class: 'btn small ghost', onClick: () => { app.search = valueOf(g.cards[0], 'name') ?? ''; app.filter = 'all'; render(); } }, 'Show'),
    )),
  );
}

// --- review ---------------------------------------------------------------

function reviewList() {
  return app.cards.filter((c) => c.state === STATE.NEEDS_REVIEW || c.flags.length);
}

function openReviewFor(id) {
  const list = reviewList();
  const i = list.findIndex((c) => c.id === id);
  app.reviewIndex = i >= 0 ? i : 0;
  app.singleCardId = i < 0 ? id : null;
  app.view = 'review';
  render();
}

function viewReview() {
  // A card opened on its own stays on screen while it is edited. Every edit
  // re-renders, and forgetting the card here dropped the user onto whatever was
  // next in the review queue, or "nothing needs your attention".
  let list = app.singleCardId ? app.cards.filter((c) => c.id === app.singleCardId) : [];
  if (!list.length) { app.singleCardId = null; list = reviewList(); } // gone, e.g. deleted

  if (!list.length) {
    return h('div', { class: 'empty' },
      h('h3', {}, 'Nothing needs your attention'),
      h('p', {}, 'Every card in this batch is identified and verified.'),
      h('button', { class: 'btn primary', onClick: () => go('export') }, 'Go to export'),
    );
  }

  const idx = Math.min(app.reviewIndex, list.length - 1);
  const card = list[idx];
  const b = band(card.confidence, card.margin);

  const front = h('img', { class: 'big', alt: 'The card you uploaded' });
  app.urls.urlFor(card.images.front).then((u) => { if (u) front.src = u; });

  const ref = card.reference?.image
    ? h('figure', { style: { margin: 0 } },
        h('img', { class: 'big', src: card.reference.image, alt: 'The card we matched it to', loading: 'lazy' }),
        h('figcaption', {}, 'Our match'))
    : null;

  return h('div', {},
    h('div', { class: 'row', style: { marginBottom: '14px' } },
      h('h2', {}, `Review ${idx + 1} of ${list.length}`),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onClick: () => go('cards') }, 'Back to all cards'),
    ),

    h('div', { class: 'review' },
      h('div', {},
        ref
          ? h('div', { class: 'refpair' },
              h('figure', { style: { margin: 0 } }, front, h('figcaption', {}, 'Your photo')),
              ref)
          : front,

        card.errors.length
          ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
              ...card.errors.map((e) => {
                const advice = ADVICE[e];
                return advice
                  ? h('div', {}, h('strong', {}, advice.title),
                      h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } },
                        ...advice.hints.map((x) => h('li', { class: 'tiny' }, x))))
                  : h('div', {}, String(e));
              }))
          : null,
      ),

      h('div', {},
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          confidenceBadge(b, card.confidence),
          h('span', { class: 'tiny muted' },
            readFromText(card)
              ? 'Read from the card, not matched to a database'
              : `${Math.round(card.confidence * 100)}% · margin ${Math.round(card.margin * 100)}%`),
        ),

        h('div', { class: 'fieldlist' },
          ...[...COLUMNS, { key: 'manufacturer', label: 'Maker' }, { key: 'language', label: 'Language' },
            // What a card that is not in a database can carry, shown only when it was found.
            { key: 'serial', label: 'Print run' }, { key: 'league', label: 'League' }, { key: 'sport', label: 'Sport' }]
            .filter((col) => !['serial', 'league', 'sport'].includes(col.key) || valueOf(card, col.key))
            .map((col) => fieldRow(card, col)),
        ),

        readFromText(card)
          ? h('div', { class: 'notice', style: { marginTop: '12px' } },
              h('strong', {}, 'No database covers this kind of card. '),
              'So nothing vouches for these values: they are what we could read off the card. Check each one against the photo, and pick from the lines below if we chose the wrong one.')
          : null,
        otherNames(card),
        textsFound(card),

        h('h3', { style: { marginTop: '18px' } }, 'For eBay'),
        h('p', { class: 'tiny muted', style: { marginTop: 0 } },
          'You decide these. We never work out a card’s condition from its photo.'),
        h('div', { class: 'fieldlist' }, ...ebayRows(card)),

        card.candidates.length > 1
          ? h('div', {},
              h('h3', { style: { marginTop: '18px' } }, 'Other possible matches'),
              h('div', { class: 'alts' },
                ...card.candidates.slice(0, 4).map((c) => h('button', {
                  class: 'alt',
                  onClick: () => applyCandidate(card, c),
                },
                  c.record.image ? h('img', { src: c.record.image, alt: '', loading: 'lazy' }) : h('span', {}, ''),
                  h('span', {},
                    h('div', {}, `${c.record.name ?? '—'} · ${c.record.number ?? '—'}`),
                    h('div', { class: 'tiny muted' }, `${c.record.set ?? '—'}${c.record.year ? ` · ${c.record.year}` : ''}`),
                  ),
                  h('span', { class: 'mono tiny' }, `${Math.round(c.confidence * 100)}%`),
                ))))
          : null,

        h('div', { class: 'row', style: { marginTop: '18px' } },
          h('button', { class: 'btn primary', onClick: () => acceptCard(card, list) }, icon('check'), 'Accept'),
          h('button', { class: 'btn', onClick: () => step(list, 1) }, 'Skip'),
          h('button', {
            class: 'btn danger', onClick: async () => {
              await deleteCards([card.id]);
              render(); toast('Card removed');
            },
          }, icon('trash', 14), 'Delete'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn ghost small', onClick: () => step(list, -1) }, '← Previous'),
          h('button', { class: 'btn ghost small', onClick: () => step(list, 1) }, 'Next →'),
        ),

        h('p', { class: 'tiny muted', style: { marginTop: '12px' } },
          h('kbd', {}, 'Enter'), ' accept · ', h('kbd', {}, 'S'), ' skip · ',
          h('kbd', {}, 'D'), ' delete · ', h('kbd', {}, 'N'), '/', h('kbd', {}, 'P'), ' next, previous'),
      ),
    ),
  );
}

function fieldRow(card, col) {
  const f = card.fields[col.key];
  const flagged = card.flags.includes(col.key);
  return h('div', { class: `fieldrow ${flagged ? 'flag' : ''}` },
    h('span', { class: 'k' }, col.label),
    h('span', { class: 'v' },
      editable(valueOf(card, col.key), async (v) => {
        Object.assign(card, correct(card, col.key, v));
        await store.put('cards', card);
        render(); renderTabs();
      }, { label: col.label, placeholder: flagged ? 'Needs review' : 'Add' }),
    ),
    h('span', { class: 'row', style: { gap: '6px' } },
      f?.value ? h('span', { class: 'src', title: f.evidence ? `Read as: ${f.evidence}` : '' }, f.source) : null,
      valueOf(card, col.key)
        ? h('button', {
            class: 'copy', style: { opacity: 1 }, 'aria-label': `Copy ${col.label}`,
            onClick: () => copyText(valueOf(card, col.key)),
          }, icon('copy', 13))
        : null,
    ),
  );
}

// --- a card read from its text ----------------------------------------------------

const readFromText = (card) => card.meta?.read === 'text';

/** Other lines that could have been the name, one click to choose. */
function otherNames(card) {
  const current = valueOf(card, 'name');
  const others = (card.meta?.names ?? []).filter((n) => n && n !== current);
  if (!others.length) return null;
  return h('div', { class: 'row', style: { marginTop: '10px' } },
    h('span', { class: 'tiny muted' }, 'Other names we saw:'),
    ...others.map((n) => h('button', { class: 'btn small', onClick: () => setUser(card, 'name', n) }, n)),
  );
}

const ASSIGN = [
  ['name', 'Name'], ['set', 'Set'], ['number', 'Number'], ['year', 'Year'], ['manufacturer', 'Maker'],
  ['variant', 'Variant'], ['league', 'League'], ['team', 'Team'],
];

/**
 * Every line of text found on the card, biggest first, each with a way to say what
 * it is. The reader picks the likeliest name and the obvious brand words, but a
 * team logo or a slogan can be as big as a name, so the choice is always the user's.
 */
function textsFound(card) {
  const texts = card.meta?.texts ?? [];
  if (!texts.length) return null;
  return h('details', {
    style: { marginTop: '12px' }, open: app.textsOpen,
    onToggle: (e) => { app.textsOpen = e.target.open; },
  },
    h('summary', { class: 'tiny', style: { cursor: 'pointer' } }, `Everything we read on this card (${texts.length})`),
    h('p', { class: 'tiny muted', style: { margin: '8px 0' } }, 'Biggest lettering first. Say what a line is and it goes into that field.'),
    h('div', { class: 'fieldlist' },
      ...texts.map((t) => h('div', { class: 'textrow' },
        h('span', { class: 't' }, t.text),
        h('span', { class: 'tiny muted', title: 'How sure the reading was' }, `${Math.round(t.confidence * 100)}%`),
        h('select', {
          class: 'field', style: { width: 'auto' }, 'aria-label': `What is “${t.text}”?`,
          onChange: (e) => { if (e.target.value) setUser(card, e.target.value, t.text); },
        }, h('option', { value: '' }, 'Use as…'), ...ASSIGN.map(([k, label]) => h('option', { value: k }, label))),
      ))),
  );
}

// --- eBay details on one card -----------------------------------------------
// Every value here is the user's choice. eBay knows a single card as graded or
// ungraded, and each kind is described differently, so the rows shown depend on
// which it is. Cards saved with a condition eBay does not offer for cards (an
// earlier version offered "Good" and "Played") keep it visible, marked, rather
// than losing it or quietly turning it into something else.

async function setUser(card, field, value) {
  Object.assign(card, correct(card, field, value));
  await store.put('cards', card);
  render(); renderTabs();
}

function pickRow(label, options, current, onPick, note = 'you') {
  return h('div', { class: 'fieldrow' },
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' },
      h('select', { class: 'field', 'aria-label': label, onChange: (e) => onPick(e.target.value) },
        ...options.map(([value, text]) => h('option', { value, selected: value === current }, text))),
    ),
    h('span', { class: 'src' }, note),
  );
}

function textRow(label, value, onSave, { placeholder = 'Add', note = 'you' } = {}) {
  return h('div', { class: 'fieldrow' },
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' }, editable(value, onSave, { label, placeholder })),
    h('span', { class: 'src' }, note),
  );
}

/** A stored value that no longer matches any option is shown, marked, instead of vanishing. */
function withStored(options, stored, resolved) {
  const s = String(stored ?? '').trim();
  return s !== '' && resolved == null ? [...options, [s, `${s} (not an eBay option)`]] : options;
}

function ebayRows(card) {
  const raw = (f) => valueOf(card, f);
  const type = cardTypeOf(raw);
  const graded = isGraded(raw);
  const said = String(raw('graded') ?? '');

  const rows = [
    pickRow('Card type', [
      ['', type && type.from !== 'you' ? `${CARD_TYPES[type.type].label} (from the card)` : 'Choose…'],
      ...Object.entries(CARD_TYPES).map(([k, t]) => [k, `${t.label} — ${t.hint}`]),
    ], type?.from === 'you' ? type.type : '', (v) => setUser(card, 'cardType', v)),

    pickRow('Graded', [
      ['', graded === null ? 'Choose…' : `${graded ? 'Yes' : 'No'} (from the details below)`],
      ['No', 'No'], ['Yes', 'Yes'],
    ], /^(yes|no)$/i.test(said) ? said : '', (v) => setUser(card, 'graded', v)),
  ];

  if (graded === true) {
    const graderNow = GRADERS.find((g) => g.id === graderId(raw('gradingCompany')))?.name ?? '';
    const gradeNow = GRADES.find((g) => g.id === gradeId(raw('grade')))?.label ?? '';
    rows.push(
      pickRow('Grader', withStored(
        [['', 'Choose…'], ...GRADERS.map((g) => [g.name, g.short ? `${g.short} — ${g.name}` : g.name])],
        raw('gradingCompany'), graderNow || null,
      ), graderNow || String(raw('gradingCompany') ?? ''), (v) => setUser(card, 'gradingCompany', v)),
      pickRow('Grade', withStored(
        [['', 'Choose…'], ...GRADES.map((g) => [g.label, g.label])],
        raw('grade'), gradeNow || null,
      ), gradeNow || String(raw('grade') ?? ''), (v) => setUser(card, 'grade', v)),
      textRow('Certificate no.', raw('certNumber'), (v) => setUser(card, 'certNumber', v), { placeholder: 'Optional' }),
    );
  } else {
    const nowId = ungradedConditionId(raw('condition'));
    const nowLabel = UNGRADED_CONDITIONS.find((c) => c.id === nowId)?.en ?? '';
    rows.push(pickRow('Condition', withStored(
      [['', 'Choose…'], ...UNGRADED_CONDITIONS.map((c) => [c.en, `${c.en} (${c.de})`])],
      raw('condition'), nowLabel || null,
    ), nowLabel || String(raw('condition') ?? ''), (v) => setUser(card, 'condition', v)));
  }

  const price = raw('price');
  const badPrice = price != null && price !== '' && formatPrice(price) === null;
  rows.push(
    textRow('Price (EUR)', price, (v) => setUser(card, 'price', v),
      { placeholder: 'Needs a price', note: badPrice ? 'not a plain amount' : 'you' }),
    textRow('Quantity', raw('quantity'), (v) => setUser(card, 'quantity', /^\d+$/.test(v) ? Number(v) : v), { placeholder: '1' }),
  );
  return rows;
}

async function applyCandidate(card, c) {
  const r = c.record;
  for (const [field, value] of Object.entries({
    name: r.name, number: r.number, set: r.set, series: r.series,
    year: r.year, manufacturer: r.manufacturer, game: r.game, language: r.language,
  })) {
    if (value != null) Object.assign(card, correct(card, field, value));
  }
  card.confidence = c.confidence;
  card.reference = { image: r.image ?? null, id: r.id, availableVariants: r.availableVariants ?? [] };
  card.flags = card.flags.filter((f) => f === 'variant');
  await store.put('cards', card);
  render();
  toast('Match updated');
}

async function acceptCard(card, list) {
  card.state = STATE.VERIFIED;
  card.flags = [];
  card.updatedAt = Date.now();
  await store.put('cards', card);
  const remaining = list.filter((c) => c.id !== card.id);
  if (!remaining.length) { await loadCards(); go('cards'); toast('All reviewed'); return; }
  app.reviewIndex = Math.min(app.reviewIndex, remaining.length - 1);
  render(); renderTabs();
}

function step(list, delta) {
  app.reviewIndex = (app.reviewIndex + delta + list.length) % list.length;
  render();
}

function wireGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      || (el.tagName === 'INPUT' && el.type !== 'checkbox'));

    // Esc backs out of a delete prompt first, then clears the selection.
    if (app.view === 'cards' && e.key === 'Escape' && !typing && (app.selected.size || app.confirmDelete)) {
      e.preventDefault();
      if (app.confirmDelete) {
        app.confirmDelete = false;
        syncSelectionUi();
        document.getElementById('bulk-delete')?.focus();
      } else {
        clearSelection();
      }
      return;
    }

    if (app.view !== 'review' || typing || el?.tagName === 'INPUT') return;

    const list = reviewList();
    if (!list.length) return;
    const card = list[Math.min(app.reviewIndex, list.length - 1)];

    if (e.key === 'Enter') { e.preventDefault(); acceptCard(card, list); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); step(list, 1); }
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); step(list, 1); }
    else if (e.key.toLowerCase() === 'p') { e.preventDefault(); step(list, -1); }
    else if (e.key.toLowerCase() === 'd') {
      e.preventDefault();
      deleteCards([card.id]).then(() => { render(); toast('Card removed'); });
    }
  });
}

// --- export ---------------------------------------------------------------

/**
 * What a card says, with the batch defaults the user chose filled in only where
 * the card has nothing of its own. A value set on a card always wins, and a
 * default condition is never applied to a card that is graded.
 */
function ebayGetter(card) {
  const raw = (f) => valueOf(card, f);
  const graded = isGraded(raw);
  const d = app.ebay;
  return (f) => {
    const v = raw(f);
    if (v != null && v !== '') return v;
    if (f === 'cardType') return d.cardType || null;
    if (f === 'condition' && graded !== true) return d.condition || null;
    if (f === 'price') return d.price || null;
    return null;
  };
}

/** What still stops a card being described to eBay correctly, in the user's words. */
function cardProblems(card) {
  const get = ebayGetter(card);
  const { problems } = ebayCardValues(get);
  const price = get('price');
  if (price != null && price !== '' && formatPrice(price) === null) problems.push('price (not a plain amount)');
  return problems;
}

// Friendly names for the fields a template column can be filled from.
const FIELD_LABELS = {
  title: 'Title', description: 'Description', price: 'Price', quantity: 'Quantity', sku: 'SKU',
  category: 'Category', conditionId: 'Condition ID', condition: 'Condition (written)',
  cardConditionId: 'Card condition', graderId: 'Grader', gradeId: 'Grade', certificationNumber: 'Certificate number',
  action: 'Action', format: 'Format', duration: 'Duration',
  sport: 'Sport', league: 'League', team: 'Team', serial: 'Print run',
  name: 'Card name', number: 'Card number', set: 'Set', year: 'Year', manufacturer: 'Manufacturer',
  game: 'Game', language: 'Language', variant: 'Variant', grade: 'Grade (written)', gradingCompany: 'Grader (written)',
};

function cardValue(card, field) {
  if (field === 'title') {
    return renderTitle(app.titleTemplate, Object.fromEntries(
      [...IDENTIFICATION_FIELDS, 'variant', 'condition', 'grade'].map((f) => [f, valueOf(card, f)]),
    )).title;
  }
  const get = ebayGetter(card);
  const ebay = () => ebayCardValues(get);
  switch (field) {
    case 'category': return ebay().categoryId;
    case 'conditionId': return ebay().conditionId;
    case 'cardConditionId': return ebay().cardCondition;
    case 'graderId': return ebay().grader;
    case 'gradeId': return ebay().grade;
    case 'certificationNumber': return ebay().certNumber;
    case 'action': return app.ebay.action;
    case 'format': return app.ebay.format;
    case 'duration': return app.ebay.duration;
    case 'price': return formatPrice(get('price'), app.ebay.mark);
    case 'quantity': return get('quantity') ?? 1;
    default: return valueOf(card, field);
  }
}

async function saveEbay(patch) {
  app.ebay = { ...app.ebay, ...patch };
  await store.setting('ebay', app.ebay);
  render();
}

function viewExport() {
  const preview = renderTitle(app.titleTemplate, {
    year: 1999, manufacturer: 'Pokemon', set: 'Base Set', name: 'Charizard', number: '4/102', variant: 'Holo',
  });

  return h('div', { class: 'narrow' },
    h('h2', { style: { marginBottom: '14px' } }, 'Export'),

    h('div', { class: 'panel' },
      h('h3', {}, 'Listing title'),
      h('input', {
        class: 'field', value: app.titleTemplate, 'aria-label': 'Title template',
        onInput: async (e) => {
          app.titleTemplate = e.target.value;
          await store.setting('titleTemplate', app.titleTemplate);
          render();
        },
      }),
      h('p', { class: 'tiny muted', style: { marginTop: '8px' } },
        'Available: ', h('span', { class: 'mono' }, '{year} {manufacturer} {set} {name} {number} {variant} {language} {condition} {grade}')),
      h('div', { class: 'notice', style: { marginTop: '10px' } },
        h('div', { class: 'mono tiny' }, preview.title),
        h('div', { class: 'tiny muted', style: { marginTop: '4px' } },
          `${preview.length} of ${EBAY_TITLE_LIMIT} characters${preview.truncated ? ' — this template overflows and will be trimmed' : ''}`),
      ),
    ),

    ebayPanel(),

    h('div', { class: 'panel' },
      h('h3', {}, 'Download'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onClick: () => exportGeneric() }, icon('download', 14), 'Generic CSV'),
        h('button', { class: 'btn', onClick: () => exportJson() }, icon('download', 14), 'JSON'),
        app.template
          ? h('button', { class: 'btn primary', onClick: () => exportTemplate() }, icon('download', 14), 'eBay CSV')
          : null,
        app.template && cardTypeCount() > 1
          ? h('button', { class: 'btn', onClick: () => exportTemplate({ split: true }) }, icon('download', 14), 'eBay CSV, one file per card type')
          : null,
      ),
      app.template
        ? h('label', { class: 'row', style: { gap: '8px', marginTop: '12px' } },
            h('input', {
              type: 'checkbox', checked: app.ebay.bom,
              onChange: (e) => saveEbay({ bom: e.target.checked }),
            }),
            h('span', { class: 'tiny' }, 'Mark the file as UTF-8 (needed so German characters survive in Excel). Turn this off if eBay rejects the first line.'))
        : null,
      h('p', { class: 'tiny muted', style: { marginTop: '10px', marginBottom: 0 } },
        'Files are UTF-8. Card numbers such as 004/120 are quoted as text so they are not turned into dates.'),
    ),
  );
}

/** How many kinds of card the batch holds, so a one-file-per-kind export can be offered. */
function cardTypeCount() {
  return new Set(app.cards.map((c) => ebayCardValues(ebayGetter(c)).categoryId ?? 'none')).size;
}

function ebayPanel() {
  const t = app.template;
  return h('div', { class: 'panel' },
    h('h3', {}, 'eBay file'),
    h('p', { class: 'tiny muted' },
      'eBay only accepts files laid out exactly like its own template, and it changes them. The most reliable result comes from your own template: we fill it in and leave every column we do not know exactly as it was.'),

    h('details', { style: { marginBottom: '12px' } },
      h('summary', { class: 'tiny', style: { cursor: 'pointer' } }, 'How to get your template from eBay'),
      h('ol', { class: 'tiny', style: { margin: '8px 0 0', paddingLeft: '18px' } },
        h('li', {}, 'In Seller Hub (Verkäufer-Cockpit Pro) open Reports → Uploads (Berichte → Hochladen), then Get template (Vorlage abrufen).'),
        h('li', {}, 'Choose the template for new listings, or for drafts if you will add the photos on eBay afterwards. The file cannot carry photos, only web addresses.'),
        h('li', {}, 'Pick the categories you list in. For single cards: Sammelkartenspiele › CCG Einzelkarten, Sport Trading Cards › Trading Card Einzelkarten, Non-Sport Trading Cards › Trading Card Einzelkarten.'),
        h('li', {}, 'Download it as .csv rather than Excel, then upload it here.'),
      ),
    ),

    h('div', { class: 'row' },
      h('button', { class: `btn ${t && !t.starter ? '' : 'primary'}`, onClick: () => pickTemplate() }, icon('upload', 14), 'Upload eBay template'),
      h('button', { class: 'btn', onClick: () => useStarter() }, 'Use a starter instead'),
      t?.starter
        ? h('button', { class: 'btn ghost', onClick: () => downloadStarter() }, icon('download', 14), 'Download the blank starter')
        : null,
      t ? h('span', { class: 'tiny muted' }, `${t.starter ? 'Starter' : 'Your template'}: ${t.columnCount} columns`) : null,
    ),

    t?.starter
      ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
          h('strong', {}, 'This starter is not from eBay. '),
          'It uses only column names that eBay’s own help pages give, for draft listings, and leaves out the item specifics because their German names could not be confirmed. eBay may still reject it. Try one card first with “Check only”, and if it fails, upload your own template instead.')
      : null,

    t ? listingDetails() : null,
    t ? templateSummary() : null,
  );
}

function listingDetails() {
  const d = app.ebay;
  const pick = (label, key, options) => h('div', {},
    h('label', { class: 'lbl' }, label),
    h('select', {
      class: 'field', 'aria-label': label,
      onChange: (e) => saveEbay({ [key]: e.target.value }),
    }, ...options.map(([v, text]) => h('option', { value: v, selected: v === d[key] }, text))));

  return h('div', { style: { marginTop: '18px' } },
    h('h3', {}, 'Listing details'),
    h('p', { class: 'tiny muted', style: { marginTop: 0 } },
      'Used only for cards that have nothing of their own. Whatever you set on a card always wins, and a default condition is never applied to a graded card.'),
    h('div', { class: 'formgrid' },
      pick('Card type', 'cardType', [['', 'None, I will choose per card'], ...Object.entries(CARD_TYPES).map(([k, t]) => [k, t.label])]),
      pick('Condition (ungraded cards)', 'condition', [['', 'None, I will choose per card'], ...UNGRADED_CONDITIONS.map((c) => [c.en, `${c.en} (${c.de})`])]),
      h('div', {},
        h('label', { class: 'lbl', for: 'default-price' }, 'Price (EUR)'),
        h('input', {
          id: 'default-price', class: 'field', value: d.price, placeholder: 'For cards without a price',
          onChange: (e) => saveEbay({ price: e.target.value.trim() }),
        })),
      pick('What eBay should do with the file', 'action', ACTIONS.map((a) => [a.value, a.label])),
      pick('Format', 'format', FORMATS.map((f) => [f.value, f.label])),
      pick('Duration', 'duration', DURATIONS.map((x) => [x.value, x.label])),
      pick('Decimal mark in prices', 'mark', [['.', '12.50'], [',', '12,50']]),
    ),
    d.format === 'Auction' && d.duration === 'GTC'
      ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
          'An auction has to run for a number of days. “Until cancelled” only works for fixed-price listings.')
      : null,
  );
}

function templateSummary() {
  const { mapping, unknownColumns } = suggestMapping(app.template.headers);
  app.mapping = { ...mapping, ...app.mapping };

  const rows = buildTemplateRows(app.cards, app.template, app.mapping, cardValue);
  const v = validateRows(rows, app.template);

  return h('div', { style: { marginTop: '14px' } },
    h('div', { class: 'statrow' },
      h('div', { class: 'stat' }, h('b', {}, String(app.template.columnCount)), h('span', {}, 'Columns')),
      h('div', { class: 'stat high' }, h('b', {}, String(Object.keys(app.mapping).length)), h('span', {}, 'Filled by us')),
      h('div', { class: 'stat medium' }, h('b', {}, String(unknownColumns.length)), h('span', {}, 'Left for you')),
    ),

    h('h3', { style: { marginTop: '14px' } }, 'Field mapping'),
    ...Object.entries(app.mapping).map(([field, header]) =>
      h('div', { class: 'maprow' },
        h('span', {}, FIELD_LABELS[field] ?? field),
        h('span', { class: 'arrow' }, '→'),
        h('select', {
          class: 'field', 'aria-label': `Map ${field} to a column`,
          onChange: (e) => {
            if (e.target.value) app.mapping[field] = e.target.value;
            else delete app.mapping[field];
            render();
          },
        },
          h('option', { value: '' }, '— not exported —'),
          ...app.template.headers.map((x) => h('option', { value: x, selected: x === header }, x)),
        ),
      )),

    unknownColumns.length
      ? h('div', { class: 'notice', style: { marginTop: '12px' } },
          h('strong', {}, 'We left these columns exactly as they came. '),
          h('span', { class: 'tiny' }, unknownColumns.slice(0, 12).join(' · ')),
          unknownColumns.length > 12 ? h('span', { class: 'tiny' }, ` and ${unknownColumns.length - 12} more`) : null)
      : null,

    v.ok
      ? h('div', { class: 'notice', style: { marginTop: '12px' } },
          `All ${v.total} listings have everything eBay requires.`)
      : h('div', { class: 'notice warn', style: { marginTop: '12px' } },
          h('strong', {}, `${v.complete} of ${v.total} listings are complete.`),
          h('div', { style: { marginTop: '8px' } },
            ...v.issues.map((i) => h('div', { class: 'issue' },
              h('b', {}, String(i.indexes.length)),
              h('span', {}, `need ${i.header.replace(/\*/g, '')}`),
            ))),
          h('p', { class: 'tiny', style: { marginTop: '8px', marginBottom: 0 } },
            'We mark these rather than guess them. Fill them in on the card, or export anyway and finish in eBay.')),

    v.warnings?.length
      ? h('div', { class: 'notice', style: { marginTop: '12px' } },
          h('strong', {}, 'Not needed for a draft, but needed before it can be published: '),
          h('span', { class: 'tiny' }, v.warnings.map((w) => `${w.header.replace(/\*/g, '')} (${w.indexes.length})`).join(' · ')))
      : null,

    stillToDecide(),
  );
}

/** Cards that eBay cannot be told about correctly yet, grouped by what is missing. */
function stillToDecide() {
  const counts = new Map();
  for (const c of app.cards) for (const p of cardProblems(c)) counts.set(p, (counts.get(p) ?? 0) + 1);
  if (!counts.size) return null;
  return h('div', { class: 'notice warn', style: { marginTop: '12px' } },
    h('strong', {}, 'Still to decide on some cards: '),
    h('span', { class: 'tiny' }, [...counts].map(([p, n]) => `${p} (${n})`).join(' · ')),
    h('p', { class: 'tiny', style: { margin: '6px 0 0' } },
      'Open a card and choose these under “For eBay”, or set a default above. Nothing is filled in for you: a wrong condition or category misdescribes the card to a buyer.'));
}

async function pickTemplate() {
  const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt', style: { display: 'none' } });
  document.body.appendChild(input);
  input.onchange = async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      toast('That is an Excel file. In Seller Hub, download the template as .csv instead.');
      return;
    }
    try {
      const text = await file.text();
      app.template = parseTemplate(text);
      app.mapping = suggestMapping(app.template.headers).mapping;
      render();
      toast(`${app.template.columnCount} columns detected`);
    } catch (err) {
      toast(err.message);
    }
  };
  input.click();
}

function download(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportGeneric() {
  const fields = [...IDENTIFICATION_FIELDS, 'variant', 'condition', 'quantity', 'sku', 'price'];
  const headers = ['title', ...fields, 'confidence', 'status'];
  const rows = app.cards.map((c) => {
    const row = { title: cardValue(c, 'title'), confidence: c.confidence, status: c.state };
    for (const f of fields) row[f] = valueOf(c, f) ?? '';
    return row;
  });
  download(`${slug(app.project.name)}-cards.csv`, toCsv(headers, rows, { textColumns: TEXT_SAFE_FIELDS }));
  toast(`Exported ${rows.length} cards`);
}

function exportJson() {
  download(`${slug(app.project.name)}-cards.json`, JSON.stringify(app.cards, null, 2), 'application/json');
  toast('Exported JSON');
}

function useStarter() {
  app.template = starterTemplate();
  app.mapping = suggestMapping(app.template.headers).mapping;
  render();
  toast('Starter loaded. It is not an eBay file, so try one card first.');
}

function downloadStarter() {
  const t = starterTemplate();
  download('ebay-starter-template.csv', toCsv(t.headers, [], { preamble: t.preamble, bom: app.ebay.bom }));
}

/** Write one eBay file for these cards, keeping the template's own info lines above the header. */
function writeEbayFile(cards, filename) {
  const rows = buildTemplateRows(cards, app.template, app.mapping, cardValue);
  const csv = toCsv(app.template.headers, rows, {
    delimiter: app.template.delimiter,
    preamble: app.template.preamble,
    bom: app.ebay.bom,
    textColumns: app.template.headers.filter((hh) => /number|sku|label|serial|cert/i.test(hh)),
  });
  download(filename, csv);
  return rows;
}

function exportTemplate({ split = false } = {}) {
  const all = buildTemplateRows(app.cards, app.template, app.mapping, cardValue);
  const v = validateRows(all, app.template);
  if (!v.ok && !confirm(`${v.total - v.complete} listings are missing a required field and will say "${MISSING}". Export anyway?`)) return;

  if (!split) {
    writeEbayFile(app.cards, `${slug(app.project.name)}-ebay.csv`);
    toast(`Exported ${app.cards.length} listings`);
    return;
  }

  // One file per kind of card, in case eBay refuses a file that mixes categories.
  const groups = new Map();
  for (const c of app.cards) {
    const id = ebayCardValues(ebayGetter(c)).categoryId;
    const key = Object.entries(CARD_TYPES).find(([, t]) => t.id === id)?.[0] ?? 'no-card-type';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  [...groups].forEach(([key, cards], i) => {
    setTimeout(() => writeEbayFile(cards, `${slug(app.project.name)}-ebay-${key}.csv`), i * 400);
  });
  toast(`Exported ${groups.size} files`);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'batch';
}
