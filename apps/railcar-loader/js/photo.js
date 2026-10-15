// Reads VINs from an uploaded photo or screenshot: every barcode / 2D code,
// then the printed text.

import { findAllVinsInText, validateVin } from './vin.js?v=20261015T1458';
import { BarcodeReader, loadTextWorker, prepareForText, tileRects, vinFromBarcode } from './scanner.js?v=20261015T1458';

const MAX_SIDE = 2400;
const TEXT_STRIP_MIN_HEIGHT = 1200;

let barcodes = null;

export const isImageFile = (file) => file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(file.name);

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Try an <img> below.
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draws the image on a canvas, scaled so the long side is at most MAX_SIDE.
export async function loadImageCanvas(file) {
  let image;
  try {
    image = await decodeImage(file);
  } catch {
    throw new Error(`${file.name} could not be opened as an image. Try a JPEG or PNG (or a screenshot of it).`);
  }
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  if (!width || !height) throw new Error(`${file.name} could not be opened as an image.`);
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // Transparent screenshots read as white, not black.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  return canvas;
}

function cropCanvas(canvas, { x, y, w, h }) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

// Edit distance (insert, delete, replace) between two short strings.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// A vehicle from the same batch differs only in the serial number and check
// digit, and has a valid check digit. Anything else this close is a misread.
function looksLikeMisread(read, sure) {
  if (editDistance(read, sure) > 3) return false;
  const neighbour = [...read].every((c, i) => c === sure[i] || i === 8 || i >= 11);
  return !neighbour || Boolean(validateVin(read).warning);
}

// Returns [{ vin, confidence: 'high' | 'low', source: 'barcode' | 'text', similarTo? }].
// onProgress(message) reports what it is doing.
export async function readPhotoVins(file, { onProgress } = {}) {
  onProgress?.('Opening photo…');
  const canvas = await loadImageCanvas(file);
  const found = new Map();
  const add = (vin, confidence, source) => {
    const prev = found.get(vin);
    if (!prev || (prev.confidence === 'low' && confidence === 'high')) found.set(vin, { vin, confidence, source });
  };

  onProgress?.('Reading photo… finding barcodes');
  try {
    barcodes ||= new BarcodeReader();
    const texts = await barcodes.readAll(canvas, {
      onProgress: (f) => onProgress?.(`Reading photo… finding barcodes (${Math.round(f * 100)}%)`),
    });
    texts.map(vinFromBarcode).filter(Boolean).forEach((vin) => add(vin, 'high', 'barcode'));
  } catch {
    // Barcode reader unavailable (offline); still try text.
  }

  onProgress?.('Reading photo… reading text');
  let textError = null;
  try {
    const worker = await loadTextWorker();
    const targets = [canvas];
    if (canvas.height >= TEXT_STRIP_MIN_HEIGHT) {
      targets.push(...tileRects(canvas.width, canvas.height, canvas.width, canvas.height / 3).map((r) => cropCanvas(canvas, r)));
    }
    let read = 0;
    for (const target of targets) {
      const { data } = await worker.recognize(prepareForText(target));
      findAllVinsInText(data.text).forEach((r) => add(r.vin, r.confidence, 'text'));
      read++;
      onProgress?.(`Reading photo… reading text (${read} of ${targets.length})`);
    }
    // Light text on a dark background (dark-mode screenshots).
    if (!found.size) {
      const { data } = await worker.recognize(prepareForText(canvas, true));
      findAllVinsInText(data.text).forEach((r) => add(r.vin, r.confidence, 'text'));
    }
  } catch (err) {
    textError = err;
  }
  if (!found.size && textError) throw new Error(`Could not read text in ${file.name}: ${textError.message || textError}`);

  // Flag unsure reads that are probably a misread of a sure VIN. They are kept
  // (unticked) because they could still be real.
  const sure = [...found.values()].filter((r) => r.confidence === 'high').map((r) => r.vin);
  return [...found.values()].map((r) => {
    const similarTo = r.confidence === 'low' && sure.find((vin) => looksLikeMisread(r.vin, vin));
    return similarTo ? { ...r, similarTo } : r;
  });
}
