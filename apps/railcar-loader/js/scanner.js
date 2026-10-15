// Camera VIN scanner, plus the barcode and text readers it shares with photo upload.
// - Reads VIN barcodes (Code 39, Code 128, Data Matrix, QR) automatically.
// - Reads printed VIN text (windshield plate, door sticker) automatically when
//   it is clear, and on demand with the Capture button.

import { cleanVin, validateVin, extractVins, findVinInText } from './vin.js?v=20261015T1458';
import { loadScript } from './export.js?v=20261015T1458';

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const NATIVE_FORMATS = ['code_39', 'code_128', 'data_matrix', 'qr_code'];

const FRAME_INTERVAL_MS = 120;
const TEXT_INTERVAL_MS = 1500;
const MAX_CROP_WIDTH = 1600;

// Turns barcode contents into a VIN, or null.
export function vinFromBarcode(text) {
  const direct = cleanVin(text);
  if (validateVin(direct).valid) return direct;
  const found = extractVins(text)[0];
  return found && validateVin(found).valid ? found : null;
}

// Averages each pixel with the rows above and below it. Barcode bars are
// vertical, so this removes camera noise without blurring the bars.
export function smoothVertical(lum, width, height, radius = 6) {
  const out = new Uint8ClampedArray(lum.length);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y++) {
      sum += lum[y * width + x];
      count++;
    }
    for (let y = 0; y < height; y++) {
      const add = y + radius;
      const drop = y - radius - 1;
      if (add < height) { sum += lum[add * width + x]; count++; }
      if (drop >= 0) { sum -= lum[drop * width + x]; count--; }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

// Sharpens left-to-right edges so slightly blurry bars separate cleanly.
export function sharpenHorizontal(lum, width, height, radius = 2, amount = 1.5) {
  const out = new Uint8ClampedArray(lum.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) {
      sum += lum[row + x];
      count++;
    }
    for (let x = 0; x < width; x++) {
      const add = x + radius;
      const drop = x - radius - 1;
      if (add < width) { sum += lum[row + add]; count++; }
      if (drop >= 0) { sum -= lum[row + drop]; count--; }
      const v = lum[row + x];
      out[row + x] = v + amount * (v - sum / count);
    }
  }
  return out;
}

// Noise reduction plus sharpening for hard-to-read barcodes.
export function enhanceForBarcode(lum, width, height) {
  return sharpenHorizontal(smoothVertical(lum, width, height), width, height);
}

function toLuminance(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
    lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return lum;
}

export function rotate90(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.height;
  out.height = canvas.width;
  const ctx = out.getContext('2d');
  ctx.translate(out.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

// Grayscale, contrast stretch, and upscale small text for better recognition.
export function prepareForText(canvas, invert = false) {
  const scale = canvas.height < 160 ? 2 : 1;
  const out = document.createElement('canvas');
  out.width = canvas.width * scale;
  out.height = canvas.height * scale;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const d = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - min) / range) * 255;
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

// Overlapping tiles of size tileW x tileH covering the whole image. Each tile
// starts `step` (a fraction of the tile size, 0.5 = 50% overlap) after the last.
export function tileRects(width, height, tileW, tileH, step = 0.5) {
  const w = Math.min(width, Math.round(tileW));
  const h = Math.min(height, Math.round(tileH));
  const starts = (size, tile) => {
    const out = [];
    const stride = Math.max(1, Math.round(tile * step));
    for (let p = 0; p + tile < size; p += stride) out.push(p);
    out.push(size - tile);
    return out;
  };
  return starts(height, h).flatMap((y) => starts(width, w).map((x) => ({ x, y, w, h })));
}

function cropLuminance(lum, width, { x, y, w, h }) {
  const out = new Uint8ClampedArray(w * h);
  for (let row = 0; row < h; row++) out.set(lum.subarray((y + row) * width + x, (y + row) * width + x + w), row * w);
  return out;
}

// Paints a found code white so the next decode of the same tile finds another one.
function maskResult(lum, w, h, points, is1d) {
  const xs = points.map((p) => p.getX());
  const ys = points.map((p) => p.getY());
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  // A barcode result is a line across the bars: mask a band around it.
  const padX = is1d ? 4 : (x1 - x0) * 0.3 + 4;
  const padY = is1d ? (x1 - x0) * 0.25 : (y1 - y0) * 0.3 + 4;
  x0 = Math.max(0, Math.floor(x0 - padX));
  x1 = Math.min(w, Math.ceil(x1 + padX));
  y0 = Math.max(0, Math.floor(y0 - padY));
  y1 = Math.min(h, Math.ceil(y1 + padY));
  for (let y = y0; y < y1; y++) lum.fill(255, y * w + x0, y * w + x1);
}

// Reads barcodes from any canvas: the browser's BarcodeDetector when it
// supports Code 39, otherwise ZXing.
export class BarcodeReader {
  constructor() {
    this.detector = null;
    this.reader = null;
    this.reader1d = null;
    this.reader2d = null;
    this.setup = null;
  }

  init() {
    if (!this.setup) {
      this.setup = (async () => {
        if ('BarcodeDetector' in window) {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
            if (formats.includes('code_39')) {
              this.detector = new window.BarcodeDetector({ formats });
              return;
            }
          } catch {
            // Fall back to ZXing.
          }
        }
        await this.loadZxing();
      })();
      this.setup.catch(() => { this.setup = null; });
    }
    return this.setup;
  }

  // ZXing works in every browser, and is also used for noise-reduced reads.
  // reader1d / reader2d only look for straight barcodes or 2D codes, which is
  // quicker when scanning many tiles of a photo.
  async loadZxing() {
    if (this.reader) return;
    await loadScript(ZXING_URL);
    const { BarcodeFormat, DecodeHintType, MultiFormatReader } = window.ZXing;
    const make = (formats) => {
      const reader = new MultiFormatReader();
      reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, formats], [DecodeHintType.TRY_HARDER, true]]));
      return reader;
    };
    const oneD = [BarcodeFormat.CODE_39, BarcodeFormat.CODE_128];
    const twoD = [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE];
    this.reader1d = make(oneD);
    this.reader2d = make(twoD);
    this.reader = make([...oneD, ...twoD]);
  }

  // ZXing decode of a luminance image. Returns the ZXing result or null.
  decodeLuminance(lum, width, height, reader = this.reader) {
    const ZXing = window.ZXing;
    try {
      const source = new ZXing.RGBLuminanceSource(lum, width, height);
      return reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source)));
    } catch {
      return null;
    }
  }

  // Returns the text of the barcodes found (usually one), or null.
  async read(canvas, { enhance = false } = {}) {
    if (this.detector) {
      try {
        const codes = await this.detector.detect(canvas);
        if (codes.length) return codes.map((c) => c.rawValue);
      } catch {
        // Treat as no barcode.
      }
      if (!enhance) return null;
    }
    try {
      await this.loadZxing();
    } catch {
      return null;
    }
    let lum = toLuminance(canvas);
    if (enhance) lum = enhanceForBarcode(lum, canvas.width, canvas.height);
    const result = this.decodeLuminance(lum, canvas.width, canvas.height);
    return result ? [result.getText()] : null;
  }

  // Finds every barcode in a still image (a photo or screenshot may hold many).
  // Returns the barcode texts. onProgress(fraction) reports progress.
  async readAll(canvas, { onProgress } = {}) {
    await this.init();
    const found = new Set();
    if (this.detector) {
      for (const target of [canvas, rotate90(canvas)]) {
        try {
          (await this.detector.detect(target)).forEach((c) => found.add(c.rawValue));
        } catch {
          // Treat as no barcode.
        }
      }
      if (found.size) return [...found];
    }
    await this.loadZxing();

    const scanTiles = (lum, width, height, tiles, reader, is1d) => {
      for (const rect of tiles) {
        const tile = cropLuminance(lum, width, rect);
        for (let i = 0; i < 12; i++) {
          const result = this.decodeLuminance(tile, rect.w, rect.h, reader);
          if (!result) break;
          found.add(result.getText());
          const points = result.getResultPoints() || [];
          if (!points.length) break;
          maskResult(tile, rect.w, rect.h, points, is1d);
        }
      }
    };
    // Horizontal strips for barcodes (1D), square grids of a few sizes for QR / Data Matrix.
    const strips = (w, h) => tileRects(w, h, w, h / 6);
    const grid = (w, h) => [4, 5].flatMap((n) => tileRects(w, h, Math.min(w, h) / n, Math.min(w, h) / n, 0.25));
    const passes = [
      (c, lum) => scanTiles(lum, c.width, c.height, strips(c.width, c.height), this.reader1d, true),
      (c, lum) => scanTiles(lum, c.width, c.height, grid(c.width, c.height), this.reader2d, false),
      (c, lum) => scanTiles(enhanceForBarcode(lum, c.width, c.height), c.width, c.height, strips(c.width, c.height), this.reader1d, true),
    ];
    const run = async (c) => {
      const lum = toLuminance(c);
      for (let i = 0; i < passes.length; i++) {
        passes[i](c, lum);
        onProgress?.((i + 1) / passes.length);
        await new Promise((r) => setTimeout(r)); // Let the progress message paint.
      }
    };
    await run(canvas);
    // Nothing found: the photo may be sideways.
    if (!found.size) await run(rotate90(canvas));
    return [...found];
  }
}

let textWorker = null;

// One Tesseract worker for the camera and photo upload, set up for VIN characters.
export function loadTextWorker() {
  if (!textWorker) {
    textWorker = (async () => {
      await loadScript(TESSERACT_URL);
      const worker = await window.Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: `${VIN_CHARS} :`, tessedit_pageseg_mode: '6' });
      return worker;
    })();
    textWorker.catch(() => { textWorker = null; });
  }
  return textWorker;
}

async function openCamera() {
  const base = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...base, advanced: [{ focusMode: 'continuous' }] }, audio: false });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  }
}

export class VinScanner {
  constructor({ video, guide, onDetect, onTextReady }) {
    this.video = video;
    this.guide = guide;
    this.onDetect = onDetect;
    this.onTextReady = onTextReady;
    this.running = false;
    this.paused = false;
    this.stream = null;
    this.track = null;
    this.barcodes = new BarcodeReader();
    this.textReady = null;
    this.textBusy = false;
    this.lastTextAt = 0;
    this.frame = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not allow camera access.');
    this.stream = await openCamera();
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    await this.setUpBarcodeReader();
    this.running = true;
    this.paused = false;
    this.loop();
    this.loadTextReader().then(() => this.onTextReady?.(true), () => this.onTextReady?.(false));
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  pause() {
    this.paused = true;
    this.video.pause();
  }

  resume() {
    this.paused = false;
    this.video.play().catch(() => {});
  }

  capabilities() {
    const caps = this.track?.getCapabilities?.() || {};
    return {
      torch: Boolean(caps.torch),
      zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null,
    };
  }

  async setTorch(on) {
    await this.track?.applyConstraints({ advanced: [{ torch: on }] });
  }

  async setZoom(zoom) {
    await this.track?.applyConstraints({ advanced: [{ zoom }] });
  }

  setUpBarcodeReader() {
    return this.barcodes.init();
  }

  async loadTextReader() {
    this.textReady = await loadTextWorker();
    return this.textReady;
  }

  // Copies the part of the video inside the guide box (plus a margin) to a canvas.
  grabGuide(margin = 0.15) {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const gr = this.guide.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    let sx = (gr.left - vr.left - offX) / scale;
    let sy = (gr.top - vr.top - offY) / scale;
    let sw = gr.width / scale;
    let sh = gr.height / scale;
    sx -= sw * margin / 2;
    sw *= 1 + margin;
    sy -= sh * margin;
    sh *= 1 + margin * 2;
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sw = Math.min(vw - sx, sw);
    sh = Math.min(vh - sy, sh);
    return this.drawRegion(sx, sy, sw, sh);
  }

  // The part of the video currently visible on screen (object-fit: cover).
  grabVisible() {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const sw = Math.min(vw, vr.width / scale);
    const sh = Math.min(vh, vr.height / scale);
    return this.drawRegion((vw - sw) / 2, (vh - sh) / 2, sw, sh);
  }

  grabFull() {
    const v = this.video;
    return v.videoWidth ? this.drawRegion(0, 0, v.videoWidth, v.videoHeight) : null;
  }

  drawRegion(sx, sy, sw, sh) {
    const shrink = Math.min(1, MAX_CROP_WIDTH / sw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * shrink);
    canvas.height = Math.round(sh * shrink);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(this.video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  readBarcode(canvas, options) {
    return this.barcodes.read(canvas, options);
  }

  async readText(canvas) {
    const worker = await this.loadTextReader();
    for (const invert of [false, true]) {
      const { data } = await worker.recognize(prepareForText(canvas, invert));
      const found = findVinInText(data.text);
      if (found) return found;
    }
    return null;
  }

  async loop() {
    if (!this.running) return;
    if (!this.paused) {
      const canvas = this.grabGuide();
      if (canvas) {
        this.frame++;
        // Rotate through: guide box, guide box enhanced, whole view (catches
        // square QR and Data Matrix codes that do not fit the box).
        const step = this.frame % 3;
        const target = step === 2 ? this.grabVisible() : canvas;
        const texts = await this.readBarcode(target, { enhance: step === 1 });
        const vin = texts?.map(vinFromBarcode).find(Boolean);
        if (vin && this.running && !this.paused) this.onDetect(vin, 'barcode', 'high');
        this.maybeReadText(canvas);
      }
    }
    if (this.running) this.timer = setTimeout(() => this.loop(), FRAME_INTERVAL_MS);
  }

  // Background text reading. Reports how sure it is so the app can ask to confirm.
  async maybeReadText(canvas) {
    const worker = this.textReady;
    if (!worker || this.textBusy || Date.now() - this.lastTextAt < TEXT_INTERVAL_MS) return;
    this.textBusy = true;
    try {
      const { data } = await worker.recognize(prepareForText(canvas));
      if (this.paused) return;
      const found = findVinInText(data.text);
      if (found && this.running && !this.paused) this.onDetect(found.vin, 'text', found.confidence);
    } catch {
      // Ignore a failed background read.
    } finally {
      this.lastTextAt = Date.now();
      this.textBusy = false;
    }
  }

  // Manual capture: tries every method on the current frame.
  // Returns { vin, source, confidence } or null.
  async capture() {
    const guide = this.grabGuide(0.3);
    const full = this.grabFull();
    if (!guide || !full) return null;
    this.pause();

    const visible = this.grabVisible();
    const barcodeTargets = [guide, visible, full, rotate90(guide), rotate90(full)];
    for (const canvas of barcodeTargets) {
      for (const enhance of [false, true]) {
        const vin = (await this.readBarcode(canvas, { enhance }))?.map(vinFromBarcode).find(Boolean);
        if (vin) return { vin, source: 'barcode', confidence: 'high' };
      }
    }

    try {
      const found = (await this.readText(guide)) || (await this.readText(rotate90(guide)));
      if (found) return { ...found, source: 'text' };
    } catch {
      // Text reader unavailable; fall through.
    }
    return null;
  }
}
