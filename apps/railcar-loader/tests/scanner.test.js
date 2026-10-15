import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vinFromBarcode, smoothVertical, sharpenHorizontal, tileRects } from '../js/scanner.js';

const EQUINOX = '3GN7DNRP4TS134739';

test('vinFromBarcode accepts plain and "I"-prefixed Code 39 VINs', () => {
  assert.equal(vinFromBarcode(EQUINOX), EQUINOX);
  assert.equal(vinFromBarcode(`I${EQUINOX}`), EQUINOX);
});

test('vinFromBarcode finds a VIN inside longer barcode contents', () => {
  assert.equal(vinFromBarcode(`VIN:${EQUINOX};COLOR:BLUE`), EQUINOX);
});

test('vinFromBarcode rejects non-VIN barcodes', () => {
  assert.equal(vinFromBarcode('PART-12345'), null);
});

test('smoothVertical averages rows and keeps columns separate', () => {
  // 2 columns x 3 rows: left column noisy, right column constant.
  const lum = new Uint8ClampedArray([0, 200, 90, 200, 0, 200]);
  const out = smoothVertical(lum, 2, 3, 1);
  assert.deepEqual([...out], [45, 200, 30, 200, 45, 200]);
});

test('sharpenHorizontal increases contrast at a bar edge', () => {
  const row = new Uint8ClampedArray([200, 200, 150, 100, 50, 50]);
  const out = sharpenHorizontal(row, 6, 1, 1, 1.5);
  assert.ok(out[1] >= row[1]);
  assert.ok(out[4] <= row[4]);
  assert.ok(out[2] - out[3] >= row[2] - row[3]);
});

test('tileRects covers the image with overlapping tiles', () => {
  const tiles = tileRects(1000, 600, 1000, 100);
  assert.equal(tiles.length, 11);
  assert.deepEqual(tiles[0], { x: 0, y: 0, w: 1000, h: 100 });
  assert.deepEqual(tiles.at(-1), { x: 0, y: 500, w: 1000, h: 100 });
  const grid = tileRects(250, 250, 100, 100, 0.25);
  assert.deepEqual([...new Set(grid.map((t) => t.x))], [0, 25, 50, 75, 100, 125, 150]);
  assert.deepEqual(tileRects(50, 50, 100, 100), [{ x: 0, y: 0, w: 50, h: 50 }]);
});
