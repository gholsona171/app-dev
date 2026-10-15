import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanVin, computeCheckDigit, validateVin, possibleModelYears, extractVins, mapNhtsaResult, decodeVins, findVinInText,
} from '../js/vin.js';

const EQUINOX = '3GN7DNRP4TS134739';

test('cleanVin uppercases, strips separators, and removes barcode "I" prefix', () => {
  assert.equal(cleanVin(' 3gn7-dnrp4 ts134739 '), EQUINOX);
  assert.equal(cleanVin(`I${EQUINOX}`), EQUINOX);
});

test('computeCheckDigit matches a known VIN', () => {
  assert.equal(computeCheckDigit(EQUINOX), '4');
  assert.equal(computeCheckDigit('11111111111111111'), '1');
});

test('validateVin', () => {
  assert.deepEqual(validateVin(EQUINOX), { vin: EQUINOX, valid: true });
  assert.equal(validateVin('3GN7DNRP4TS13473').valid, false);
  assert.match(validateVin('3GN7DNRP4TS13473O').error, /invalid characters/);
  const bad = validateVin('3GN7DNRP5TS134739');
  assert.equal(bad.valid, true);
  assert.match(bad.warning, /expected 4/);
});

test('possibleModelYears reads position 10', () => {
  assert.deepEqual(possibleModelYears(EQUINOX), [1996, 2026]);
});

test('extractVins finds unique VINs in mixed text', () => {
  const text = `VIN,Note\n${EQUINOX},blue\n1FTFW1E50NFA00000,red\n${EQUINOX.toLowerCase()},dup`;
  assert.deepEqual(extractVins(text), [EQUINOX, '1FTFW1E50NFA00000']);
});

test('mapNhtsaResult maps fields and marks EVs as Electric', () => {
  const r = mapNhtsaResult({
    VIN: EQUINOX, Make: 'CHEVROLET', Model: 'Equinox', ModelYear: '2026', Trim: 'LT 2 PDE',
    BodyClass: 'Sport Utility Vehicle (SUV)', BodyCabType: '', FuelTypePrimary: 'Electric',
    ElectrificationLevel: 'BEV (Battery Electric Vehicle)', DriveType: 'FWD/Front-Wheel Drive', ErrorCode: '0',
  });
  assert.equal(r.decoded, true);
  assert.equal(r.make, 'CHEVROLET');
  assert.equal(r.fuel, 'Electric');
  assert.equal(r.body, 'Sport Utility Vehicle (SUV)');
  assert.equal(r.decodeNote, '');
});

test('decodeVins batches requests of 50', async () => {
  const vins = Array.from({ length: 120 }, (_, i) => `1FTFW1E50NFA${String(i).padStart(5, '0')}`);
  const calls = [];
  const fetchImpl = async (url, { body }) => {
    const batch = body.get('data').split(';');
    calls.push(batch.length);
    return { ok: true, json: async () => ({ Results: batch.map((v) => ({ VIN: v, Make: 'FORD', Model: 'F-150', ErrorCode: '0' })) }) };
  };
  const results = await decodeVins(vins, { fetchImpl });
  assert.deepEqual(calls, [50, 50, 20]);
  assert.equal(results.size, 120);
  assert.equal(results.get(vins[0]).model, 'F-150');
});

test('findVinInText reads a clean VIN with high confidence', () => {
  assert.deepEqual(findVinInText(`GENERAL MOTORS\nVIN ${EQUINOX}\nMADE IN MEXICO`), { vin: EQUINOX, confidence: 'high' });
});

test('findVinInText maps O, Q, and I misreads', () => {
  assert.deepEqual(findVinInText('3GN7DNRP4TS1347391'.slice(0, 17).replace('1', 'I')), { vin: EQUINOX, confidence: 'high' });
  assert.equal(findVinInText('3GN7DNRP4TS134739'.replace('3', '3')).vin, EQUINOX);
});

test('findVinInText repairs one look-alike character with low confidence', () => {
  // S misread as 5
  assert.deepEqual(findVinInText('3GN7DNRP4T5134739'), { vin: EQUINOX, confidence: 'low' });
});

test('findVinInText finds a VIN glued to a label or split by a space', () => {
  assert.deepEqual(findVinInText(`VIN:${EQUINOX}`), { vin: EQUINOX, confidence: 'high' });
  assert.deepEqual(findVinInText(`VIN${EQUINOX}`), { vin: EQUINOX, confidence: 'low' });
  assert.deepEqual(findVinInText('3GN7DNRP4 TS134739'), { vin: EQUINOX, confidence: 'low' });
});

test('findVinInText returns null when nothing VIN-like is present', () => {
  assert.equal(findVinInText('NO VEHICLE HERE 12345'), null);
});
