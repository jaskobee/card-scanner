// Draws trading cards that are not in any card database: sports, wrestling, film.
// Runs in the browser, for the accuracy tools.
//
// Each layout puts the name somewhere different and surrounds it with the kind of
// text real cards carry: a brand logo, a team, a position, a stats line, legal print
// and serial numbers. The name is deliberately not always the biggest text, and it
// is not always dark on light, because that is what makes finding it hard.
//
// The people are invented. What is drawn is recorded in `truth`, so a reading can be
// checked against it without a person labelling anything.

const W = 750, H = 1050;

export const LAYOUTS = ['nameplate-bottom', 'banner-top', 'centre-large', 'stacked-left', 'stripe-mid'];

export const PEOPLE = [
  'Jordan Ellis', 'Marcus Vega', 'Sofia Marino', "De'Andre Kestrel", 'Lena Okafor',
  'Tobias Brandt-Klein', 'Priya Nandakumar', 'Caleb Whitlock', 'Yuki Tanaka-Reyes',
  'Owen McAllister', 'Zara Hollis', 'Rafael Duarte',
];

export const BRANDS = [
  { logo: 'TOPPS CHROME', manufacturer: 'Topps', product: 'Chrome', legal: '© 2022 THE TOPPS COMPANY, INC.', year: 2022 },
  { logo: 'PANINI PRIZM', manufacturer: 'Panini', product: 'Prizm', legal: '© 2021 PANINI AMERICA, INC.', year: 2021 },
  { logo: 'UPPER DECK', manufacturer: 'Upper Deck', product: null, legal: '© 2023 THE UPPER DECK COMPANY', year: 2023 },
  { logo: 'DONRUSS OPTIC', manufacturer: 'Donruss', product: 'Optic', legal: null, year: null },
  { logo: 'BOWMAN CHROME', manufacturer: 'Bowman', product: 'Chrome', legal: '© 2020 THE TOPPS COMPANY, INC.', year: 2020 },
];

const TEAMS = ['METRO STARS', 'RIVER CITY', 'NORTH COAST', 'IRON HAWKS', 'SUNSET KINGS'];
const FONT = '"Adwaita Sans", "Liberation Sans", sans-serif';

const rng = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

/**
 * @param {{layout: string, name: string, brand: object, seed: number}} spec
 * @returns {{canvas: OffscreenCanvas, truth: object}}
 */
export function drawCard({ layout, name, brand, seed }) {
  const R = rng(seed);
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d');
  const team = TEAMS[seed % TEAMS.length];
  const truth = { name, layout, manufacturer: brand.manufacturer, product: brand.product, year: brand.legal ? brand.year : null };

  artwork(x, R);

  const say = (text, px, py, { size = 30, weight = 900, style = 'italic', fill = '#fff', align = 'left', stroke = null, alpha = 1 } = {}) => {
    x.save();
    x.globalAlpha = alpha;
    x.font = `${style} ${weight} ${size}px ${FONT}`;
    x.textAlign = align; x.textBaseline = 'alphabetic';
    if (stroke) { x.lineWidth = 6; x.strokeStyle = stroke; x.lineJoin = 'round'; x.strokeText(text, px, py); }
    x.fillStyle = fill; x.fillText(text, px, py);
    x.restore();
  };
  const fit = (text, maxWidth, size, weight = 900) => {
    x.font = `italic ${weight} ${size}px ${FONT}`;
    const w = x.measureText(text).width;
    return w > maxWidth ? Math.floor(size * maxWidth / w) : size;
  };
  const UP = name.toUpperCase();

  if (layout === 'nameplate-bottom') {
    say(brand.logo, 700, 80, { size: 30, fill: silver(x), align: 'right' });
    x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.arc(100, 100, 42, 0, 7); x.fill();
    say('WWE', 100, 108, { size: 22, weight: 800, style: 'normal', fill: '#111', align: 'center' });
    plate(x);
    say(UP, 105, 962, { size: fit(UP, 540, 46), fill: '#17171b' });
    say('LEGENDS', 120, 1006, { size: 16, weight: 700, style: 'normal' });
    truth.league = 'WWE';
  } else if (layout === 'banner-top') {
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(46, 52, 560, 82);
    say(name, 70, 106, { size: fit(name, 520, 46), weight: 800 });
    say(team, 60, 965, { size: 42 });
    say('GUARD', 62, 1002, { size: 22, weight: 700, style: 'normal' });
    say(brand.logo, 705, 1005, { size: 26, align: 'right', fill: silver(x) });
    say('37/99', 705, 72, { size: 22, weight: 700, style: 'normal', fill: '#f2c94c', align: 'right' });
    say('#12', 705, 104, { size: 20, weight: 700, style: 'normal', align: 'right' });
    truth.serial = '37/99'; truth.number = '12';
  } else if (layout === 'centre-large') {
    x.fillStyle = '#f2c94c'; x.beginPath(); x.roundRect(60, 110, 130, 42, 8); x.fill();
    say('ROOKIE', 125, 140, { size: 20, style: 'normal', fill: '#111', align: 'center' });
    say(UP, 375, 905, { size: fit(UP, 640, 64), align: 'center', stroke: 'rgba(0,0,0,.85)' });
    say('PTS 24.1   REB 6.3   AST 7.2', 375, 958, { size: 20, weight: 700, style: 'normal', align: 'center' });
    say(brand.logo, 375, 998, { size: 22, align: 'center', fill: silver(x) });
    truth.rookie = true;
  } else if (layout === 'stacked-left') {
    const [first, ...rest] = UP.split(' ');
    const last = rest.join(' ');
    say(brand.logo, 62, 92, { size: 26, fill: silver(x) });
    say(first, 60, 800, { size: 54 });
    say(last, 60, 884, { size: fit(last, 620, 78), fill: '#f2c94c' });
    say(team, 690, 1000, { size: 26, align: 'right' });
    truth.name = name;
  } else if (layout === 'stripe-mid') {
    say(team, 375, 720, { size: 92, align: 'center', alpha: 0.22 });
    x.fillStyle = '#f4c20d'; x.fillRect(0, 790, W, 84);
    say(UP, 60, 850, { size: fit(UP, 640, 52), fill: '#101010' });
    say(brand.logo, 375, 84, { size: 34, align: 'center', fill: silver(x) });
    say('SR', 690, 1000, { size: 30, align: 'right' });
  }

  // Small print sits on the picture, above the frame. (It once sat on the frame, white on
  // silver, and no reader could find it: that was the drawing's fault, not the reader's.)
  if (brand.legal && layout !== 'stacked-left') say(brand.legal, 375, 1018, { size: 12, weight: 700, style: 'normal', align: 'center', alpha: 0.9 });
  truth.legal = Boolean(brand.legal) && layout !== 'stacked-left';
  if (!truth.legal) truth.year = null;

  sheen(x, R);
  border(x);
  return { canvas: c, truth };
}

// --- the picture ---------------------------------------------------------------

function artwork(x, R) {
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${215 + R() * 30} 45% 14%)`); bg.addColorStop(1, `hsl(${255 + R() * 30} 50% 5%)`);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) {                       // stage lights
    const cx = R() * W, cy = R() * H * 0.7, r = 160 + R() * 220;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsla(${R() * 360} 80% 60% / .34)`); g.addColorStop(1, 'transparent');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 150; i++) {                     // crowd bokeh
    x.fillStyle = `hsla(${R() * 360} 70% 70% / ${0.05 + R() * 0.16})`;
    x.beginPath(); x.arc(R() * W, 200 + R() * 500, 4 + R() * 14, 0, 7); x.fill();
  }
  x.fillStyle = '#c9a48a';                              // a figure: head, arms, torso
  x.beginPath(); x.ellipse(W * 0.42, H * 0.29, 92, 118, 0, 0, 7); x.fill();
  x.fillStyle = '#231a16'; x.beginPath(); x.ellipse(W * 0.42, H * 0.25, 108, 96, 0, Math.PI, 7); x.fill();
  x.fillStyle = '#1c1c25'; x.beginPath(); x.moveTo(190, 470); x.lineTo(560, 470); x.lineTo(610, 800); x.lineTo(150, 800); x.fill();
  x.fillStyle = '#c9a48a';
  x.beginPath(); x.ellipse(170, 620, 46, 150, 0.12, 0, 7); x.fill();
  x.beginPath(); x.ellipse(590, 620, 46, 150, -0.12, 0, 7); x.fill();
}

function sheen(x, R) {                                 // reflections off a chrome surface
  for (let i = 0; i < 3; i++) {
    const g = x.createLinearGradient(0, 0, W, H * 0.6);
    const at = 0.15 + R() * 0.6;
    g.addColorStop(Math.max(0, at - 0.06), 'rgba(255,255,255,0)');
    g.addColorStop(at, 'rgba(255,255,255,.13)');
    g.addColorStop(Math.min(1, at + 0.06), 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
}

function border(x) {
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#e9edf2'); g.addColorStop(0.5, '#8d96a3'); g.addColorStop(1, '#dfe4ea');
  x.strokeStyle = g; x.lineWidth = 26;
  x.beginPath(); x.roundRect(13, 13, W - 26, H - 26, 22); x.stroke();
}

function plate(x) {
  const g = x.createLinearGradient(0, 905, 0, 985);
  g.addColorStop(0, '#f4f5f7'); g.addColorStop(1, '#b7bcc4');
  x.fillStyle = g;
  x.beginPath(); x.moveTo(70, 905); x.lineTo(700, 905); x.lineTo(672, 985); x.lineTo(44, 985); x.closePath(); x.fill();
  x.fillStyle = '#e0a800'; x.beginPath(); x.moveTo(640, 905); x.lineTo(700, 905); x.lineTo(672, 985); x.lineTo(612, 985); x.fill();
}

function silver(x) {
  const g = x.createLinearGradient(0, 0, 0, 90);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#a6afbc');
  return g;
}
