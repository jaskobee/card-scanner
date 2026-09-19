// Pixel operations on plain typed arrays, so they run — and are unit tested —
// without a canvas. Everything here takes and returns single-channel greyscale
// (Float32Array, 0..255) unless it says otherwise.

/** Luminance of an RGBA buffer. */
export function luma(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/**
 * Box blur through an integral image, so cost does not grow with the radius.
 * Edges are clamped, which keeps borders from darkening.
 */
export function boxBlur(src, width, height, radius) {
  const w1 = width + 1;
  const integral = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += src[y * width + x];
      integral[(y + 1) * w1 + (x + 1)] = integral[y * w1 + (x + 1)] + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
      const sum = integral[y1 * w1 + x1] - integral[y0 * w1 + x1] - integral[y1 * w1 + x0] + integral[y0 * w1 + x0];
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Flatten uneven lighting by dividing each pixel by its local surroundings.
 * Glare gradients, shadows and vignetting stop competing with the ink: a dark
 * glyph is dark relative to its own neighbourhood wherever on the card it sits.
 * The background comes out near white.
 */
export function flattenIllumination(gray, width, height, radius) {
  const background = boxBlur(gray, width, height, radius);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.min(255, (255 * gray[i]) / Math.max(background[i], 1));
  }
  return out;
}

/**
 * Stretch contrast between two percentiles rather than the absolute extremes,
 * so one blown-out pixel cannot flatten the whole image.
 */
export function stretchContrast(gray, lowPct = 0.02, highPct = 0.98) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const at = (fraction) => {
    const target = fraction * gray.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = at(lowPct), hi = Math.max(lo + 1, at(highPct));
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, ((gray[i] - lo) / (hi - lo)) * 255));
  }
  return out;
}

/** Otsu's method: the threshold that best separates a bimodal histogram. */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  const total = gray.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];

  let sumBg = 0, weightBg = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg, meanFg = (sumAll - sumBg) / weightFg;
    const between = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

/** Threshold to pure black and white. Ink (below the threshold) becomes 0. */
export function binarize(gray, threshold) {
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] > threshold ? 255 : 0;
  return out;
}

/** Greyscale back to an RGBA buffer, for handing to a canvas. */
export function toRgba(gray) {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    out[i] = out[i + 1] = out[i + 2] = gray[p];
    out[i + 3] = 255;
  }
  return out;
}
