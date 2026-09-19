// CSV / template export. See CLAUDE.md §6.
// Two rules govern this file: never invent a value, never silently alter one.

import { descriptorField } from './ebay.js';

// Spreadsheet apps execute a cell that begins with any of these.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// Values a spreadsheet would helpfully "fix" into a date or a number, thereby
// destroying them: 4/102, 004/120, 01-02, 1/1, 0057.
const COERCIBLE = /^(\d+\s*\/\s*\d+|\d+-\d+|0\d+|\d{12,})$/;

export const MISSING = 'Needs review';

/**
 * Escape one field for CSV output.
 * @param {*} value
 * @param {string} delimiter
 * @param {{forceText?: boolean}} [opts]
 */
export function escapeField(value, delimiter = ',', opts = {}) {
  if (value === null || value === undefined) return '';
  let s = String(value);

  // Formula injection: neutralise by prefixing an apostrophe, which spreadsheet
  // apps strip on display but never execute.
  if (FORMULA_PREFIX.test(s)) s = "'" + s;

  // Leading zeroes and fraction-shaped strings survive only as quoted text.
  const mustQuote =
    opts.forceText === true ||
    COERCIBLE.test(s) ||
    s.includes(delimiter) ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r') ||
    s !== s.trim();

  if (s.includes('"')) s = s.replace(/"/g, '""');
  return mustQuote ? `"${s}"` : s;
}

/**
 * Build a CSV document.
 * @param {string[]} headers
 * @param {Array<Record<string,*>>} rows
 * @param {{delimiter?: string, bom?: boolean, eol?: string, textColumns?: string[], preamble?: string[][]}} [opts]
 *   `preamble` is rows written above the header exactly as a template had them
 *   (eBay's `#INFO` line names the template type and is required).
 */
export function toCsv(headers, rows, opts = {}) {
  const delimiter = opts.delimiter ?? ',';
  const eol = opts.eol ?? '\r\n'; // RFC 4180; Excel on every platform accepts it
  const textColumns = new Set(opts.textColumns ?? []);

  const lines = (opts.preamble ?? []).map((cells) => cells.map((c) => escapeField(c, delimiter)).join(delimiter));
  lines.push(headers.map((h) => escapeField(h, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => escapeField(row[h], delimiter, { forceText: textColumns.has(h) }))
        .join(delimiter),
    );
  }
  // The BOM is what makes Excel read UTF-8 rather than the system codepage.
  // Without it "Pokémon" and "Glückspilz" arrive mangled on a German Windows.
  return (opts.bom === false ? '' : '﻿') + lines.join(eol) + eol;
}

/**
 * Parse a CSV/TSV document. Handles quoted fields, embedded delimiters,
 * embedded newlines, doubled quotes and a leading BOM.
 */
export function parseCsv(text, opts = {}) {
  let src = text.replace(/^﻿/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { rows, delimiter };
}

/**
 * Detect the delimiter from the header line. German Excel exports use ';'
 * because the comma is the decimal separator there.
 */
export function detectDelimiter(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const counts = [
    [';', countOutsideQuotes(firstLine, ';')],
    [',', countOutsideQuotes(firstLine, ',')],
    ['\t', countOutsideQuotes(firstLine, '\t')],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function countOutsideQuotes(line, ch) {
  let n = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === ch) n++;
  }
  return n;
}

// --- Template handling (CLAUDE.md §6) ------------------------------------

/**
 * Read a marketplace template. Marketplaces put info and instruction rows above
 * the real header, so find the header rather than assuming row 0.
 * Unknown columns are preserved verbatim, in position — we never drop or
 * rename a column we do not understand.
 */
export function parseTemplate(text) {
  const { rows, delimiter } = parseCsv(text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) {
    throw new Error('No header row found in this template.');
  }
  const headers = rows[headerIndex].map((h) => h.trim()).filter((h) => h !== '');
  const preamble = rows.slice(0, headerIndex);
  const sampleRows = rows.slice(headerIndex + 1).filter((r) => r.some((c) => c.trim() !== ''));

  return {
    delimiter,
    headers,
    preamble,
    sampleRows,
    required: headers.filter(isRequiredHeader),
    columnCount: headers.length,
  };
}

// The header row is the first row with the most non-empty distinct cells.
function findHeaderRow(rows) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const distinct = new Set(cells).size;
    const score = distinct + (cells.length === distinct ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// Marketplaces mark required columns with a '*' or a localised word.
export function isRequiredHeader(h) {
  const s = h.trim().toLowerCase();
  return h.includes('*') || s.startsWith('required') || s.startsWith('pflicht');
}

/** Strip the marketplace's decoration to get a comparable key. */
export function normalizeHeader(h) {
  return h
    .replace(/\*/g, '')
    .replace(/^(C|L):/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    // Marketplaces mix "Custom Label" and "CustomLabel" across templates.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

// Internal field -> the header names marketplaces commonly use for it.
// Matching is by normalized header, both English and German.
export const SUGGESTED_MAPPING = {
  title: ['title', 'titel', 'item title', 'artikelbezeichnung', 'listing title'],
  description: ['description', 'beschreibung', 'item description'],
  price: ['price', 'preis', 'startpreis', 'start price', 'buy it now price', 'sofort kaufen preis'],
  quantity: ['quantity', 'menge', 'anzahl'],
  sku: ['custom label', 'custom label sku', 'sku', 'artikelnummer'],
  // eBay's numeric Condition ID (2750 graded, 4000 ungraded) is not the same
  // thing as a card's written condition, so they are separate fields.
  conditionId: ['condition id', 'conditionid', 'zustand id'],
  condition: ['condition', 'zustand'],
  category: ['category', 'kategorie', 'category id', 'primary category'],
  action: ['action', 'aktion'],
  format: ['format', 'listing format', 'angebotsformat'],
  duration: ['duration', 'listing duration', 'angebotsdauer', 'laufzeit'],
  name: ['character', 'player', 'spieler', 'card name', 'kartenname'],
  number: ['card number', 'kartennummer', 'number'],
  set: ['set', 'serie', 'card set', 'kartenserie'],
  year: ['year', 'jahr', 'year manufactured'],
  manufacturer: ['manufacturer', 'hersteller', 'brand', 'marke'],
  game: ['game', 'spiel', 'tcg'],
  language: ['language', 'sprache'],
  variant: ['parallel variety', 'variant', 'variante', 'features', 'finish'],
  grade: ['grade', 'bewertung'],
  gradingCompany: ['professional grader', 'grader', 'grading company'],
};

/**
 * Propose a mapping from internal fields to template headers.
 * Returns { mapping, unmapped, unknownColumns } — nothing is guessed silently;
 * every header the app cannot place is reported as unknown so the UI can show it.
 */
export function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();

  // Card-condition and grading columns name their eBay descriptor ID in the
  // header, which is the same in every language, so those are read first.
  for (const h of headers) {
    const field = descriptorField(h);
    if (field && !(field in mapping)) { mapping[field] = h; taken.add(h); }
  }

  for (const [field, aliases] of Object.entries(SUGGESTED_MAPPING)) {
    const hit = headers.find(
      (h) => !taken.has(h) && aliases.includes(normalizeHeader(h)),
    );
    if (hit) { mapping[field] = hit; taken.add(hit); }
  }
  return {
    mapping,
    unmapped: Object.keys(SUGGESTED_MAPPING).filter((f) => !(f in mapping)),
    unknownColumns: headers.filter((h) => !taken.has(h)),
  };
}

/**
 * Build template rows. Unknown columns are emitted empty rather than invented;
 * required columns with no evidence are marked, never filled with a guess.
 */
export function buildTemplateRows(cards, template, mapping, getValue) {
  const inverse = new Map(Object.entries(mapping).map(([field, header]) => [header, field]));
  // The template says which columns are required. For one parsed from a file that
  // is the asterisk convention; a built-in template lists them outright.
  const required = new Set(template.required ?? template.headers.filter(isRequiredHeader));
  return cards.map((card) => {
    const row = {};
    for (const header of template.headers) {
      const field = inverse.get(header);
      if (!field) { row[header] = ''; continue; } // preserved, never invented
      const v = getValue(card, field);
      row[header] = v === null || v === undefined || v === ''
        ? (required.has(header) ? MISSING : '')
        : v;
    }
    return row;
  });
}

/**
 * Pre-export validation. Blocks on required fields with no value (§6).
 * Columns a template lists as `recommended` do not block: they are reported as
 * warnings, because a draft can be created without them but not published.
 */
export function validateRows(rows, template) {
  const blank = (v) => v === '' || v === null || v === undefined || v === MISSING;
  const collect = (headers) => {
    const found = new Map(); // header -> row indexes
    rows.forEach((row, i) => {
      for (const header of headers) {
        if (blank(row[header])) {
          if (!found.has(header)) found.set(header, []);
          found.get(header).push(i);
        }
      }
    });
    return found;
  };
  const issues = collect(template.required);
  const warnings = collect(template.recommended ?? []);
  const affected = new Set([...issues.values()].flat());
  const list = (m) => [...m.entries()].map(([header, indexes]) => ({ header, indexes }));
  return {
    ok: issues.size === 0,
    total: rows.length,
    complete: rows.length - affected.size,
    issues: list(issues),
    warnings: list(warnings),
  };
}

/** Columns whose values must never be coerced by a spreadsheet app. */
export const TEXT_SAFE_FIELDS = ['number', 'serial', 'sku', 'certNumber', 'year'];
