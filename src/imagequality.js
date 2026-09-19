// Image quality gate. See CLAUDE.md §7 — problems are named in the user's
// words, with a concrete fix, before any processing budget is spent.

export const ISSUE = {
  BLURRY: 'blurry',
  DARK: 'dark',
  GLARE: 'glare',
  SMALL: 'small',
  NO_CARD: 'no_card',
};

export const ADVICE = {
  [ISSUE.BLURRY]: {
    title: 'This photo looks blurry',
    hints: ['Hold the camera steady or rest it on something', 'Move slightly further away and let it focus'],
  },
  [ISSUE.DARK]: {
    title: 'This photo is quite dark',
    hints: ['Move somewhere brighter', 'Avoid casting your own shadow over the card'],
  },
  [ISSUE.GLARE]: {
    title: 'There is strong glare on this card',
    hints: ['Move out from under a direct overhead light', 'Tilt the card slightly', 'Sleeved cards reflect more — try removing the sleeve'],
  },
  [ISSUE.SMALL]: {
    title: 'This image is quite small',
    hints: ['Fill more of the frame with the card', 'Use your camera’s main lens rather than a zoom'],
  },
  [ISSUE.NO_CARD]: {
    title: 'We could not find a card in this photo',
    hints: ['Place the card on a plain background', 'Make sure all four corners are visible'],
  },
};

const MIN_EDGE = 400;

/**
 * Cheap quality heuristics over downscaled pixel data. Deliberately permissive:
 * this warns and advises, it does not block. The user may always process anyway.
 * @param {ImageData} imageData
 */
export function assessQuality(imageData) {
  const { data, width, height } = imageData;
  const issues = [];

  let sum = 0;
  let blown = 0;
  const lum = new Float32Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[p] = l;
    sum += l;
    if (l > 250) blown++;
  }

  const mean = sum / lum.length;
  const blownRatio = blown / lum.length;
  const sharpness = varianceOfLaplacian(lum, width, height);

  if (Math.min(width, height) < MIN_EDGE) issues.push(ISSUE.SMALL);
  if (mean < 60) issues.push(ISSUE.DARK);
  // Blown-out pixels clustered anywhere on a card read as glare; a wholly
  // white background is normal, so require the bright area to be substantial
  // but not dominant.
  if (blownRatio > 0.04 && blownRatio < 0.5) issues.push(ISSUE.GLARE);
  if (sharpness < 60) issues.push(ISSUE.BLURRY);

  return {
    issues,
    ok: issues.length === 0,
    metrics: { mean: round(mean), blownRatio: round(blownRatio), sharpness: round(sharpness) },
  };
}

/** Variance of the Laplacian — the standard cheap focus measure. */
export function varianceOfLaplacian(lum, width, height) {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = -4 * lum[i] + lum[i - 1] + lum[i + 1] + lum[i - width] + lum[i + width];
      sum += v; sumSq += v * v; n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function round(n) { return Math.round(n * 1000) / 1000; }

/**
 * Find the card's bounding box against a plainer background by looking for
 * the largest strongly-contrasting region. Returns null when nothing card-like
 * stands out — we then process the whole frame rather than cropping blindly.
 */
export function detectCardBounds(imageData, threshold = 28) {
  const { data, width, height } = imageData;
  const edgeSample = sampleBorderLuminance(data, width, height);
  let minX = width, minY = height, maxX = 0, maxY = 0, hits = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (Math.abs(l - edgeSample) > threshold) {
        hits++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  const area = (maxX - minX) * (maxY - minY);
  const frame = width * height;
  if (hits < 500 || area < frame * 0.08 || area > frame * 0.995) return null;

  const pad = Math.round(Math.min(width, height) * 0.01);
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(width, maxX - minX + pad * 2),
    height: Math.min(height, maxY - minY + pad * 2),
  };
}

function sampleBorderLuminance(data, width, height) {
  let sum = 0, n = 0;
  const step = Math.max(1, Math.floor(width / 64));
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
  }
  return n ? sum / n : 128;
}
