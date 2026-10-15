// VIN validation and decoding (NHTSA vPIC).

const TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

const NHTSA_BATCH_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/';
const BATCH_SIZE = 50;

// Uppercases, strips spaces/dashes, and removes the "I" prefix some
// Code 39 barcode labels add in front of the VIN.
export function cleanVin(raw) {
  let vin = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (vin.length === 18 && vin.startsWith('I')) vin = vin.slice(1);
  return vin;
}

export function computeCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const value = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

// Returns { vin, valid, error, warning }.
// valid=false means the VIN cannot be used at all. A check digit mismatch is
// only a warning, because non-North-American VINs are not required to use it.
export function validateVin(raw) {
  const vin = cleanVin(raw);
  if (vin.length !== 17) {
    return { vin, valid: false, error: `Must be 17 characters (has ${vin.length})` };
  }
  if (!VIN_PATTERN.test(vin)) {
    return { vin, valid: false, error: 'Contains invalid characters (I, O, Q, or symbols)' };
  }
  const expected = computeCheckDigit(vin);
  if (vin[8] !== expected) {
    return { vin, valid: true, warning: `Check digit is ${vin[8]}, expected ${expected}` };
  }
  return { vin, valid: true };
}

// Possible model years for the 10th character (it repeats every 30 years).
export function possibleModelYears(vin) {
  const index = YEAR_CODES.indexOf(vin[9]);
  if (index === -1) return [];
  return [1980 + index, 2010 + index];
}

// Pulls every VIN-shaped string out of free text (pasted lists, CSV cells).
export function extractVins(text) {
  const found = String(text ?? '').toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [];
  return [...new Set(found)];
}

// Characters text recognition commonly confuses, used to repair one bad character.
const LOOKALIKES = {
  0: 'D', D: '0', 5: 'S', S: '5', 8: 'B', B: '8', 2: 'Z', Z: '2', 6: 'G', G: '6',
  1: 'L', L: '1', U: 'V', V: 'U', 4: 'A', A: '4', 7: 'T', T: '7', M: 'N', N: 'M',
};

const isCheckValid = (vin) => VIN_PATTERN.test(vin) && YEAR_CODES.includes(vin[9]) && computeCheckDigit(vin) === vin[8];

// Finds a VIN in text read from a photo (VIN plate, door sticker, paperwork).
// Returns { vin, confidence: 'high' | 'low' } or null.
//   high: a whole 17-character word with a correct check digit
//   low:  repaired, cut from a longer string, or failing the check digit
export function findVinInText(text) {
  // O, Q, and I never appear in VINs, so they are misreads of 0 and 1.
  const lines = String(text ?? '').toUpperCase().replace(/[OQ]/g, '0').replace(/I/g, '1').split(/\n/);
  const words = lines.flatMap((line) => line.split(/[^A-Z0-9]+/)).filter(Boolean);
  const exact = words.filter((w) => w.length === 17);

  const valid = exact.find(isCheckValid);
  if (valid) return { vin: valid, confidence: 'high' };

  for (const word of exact) {
    const repairs = [];
    for (let i = 0; i < 17; i++) {
      const alt = LOOKALIKES[word[i]];
      if (!alt) continue;
      const candidate = word.slice(0, i) + alt + word.slice(i + 1);
      if (isCheckValid(candidate)) repairs.push(candidate);
    }
    if (repairs.length === 1) return { vin: repairs[0], confidence: 'low' };
  }

  // Text glued to the VIN ("VIN:3GN...") or a VIN split by stray spaces.
  const joined = [...words.filter((w) => w.length > 17 && w.length <= 22), ...lines.map((l) => l.replace(/[^A-Z0-9]/g, ''))];
  for (const s of joined) {
    for (let i = 0; i + 17 <= s.length; i++) {
      const candidate = s.slice(i, i + 17);
      if (isCheckValid(candidate)) return { vin: candidate, confidence: 'low' };
    }
  }

  const wellFormed = exact.find((w) => VIN_PATTERN.test(w));
  return wellFormed ? { vin: wellFormed, confidence: 'low' } : null;
}

// Wider look-alike set for reading whole photos, where fonts vary more.
const PHOTO_LOOKALIKES = { ...LOOKALIKES, S: '58', G: '609', B: '8E', E: 'B' };

// Every one-character repair of a 17-character word that passes the check digit.
// A letter in the check digit position (9th) can only be a misread, so that
// position is recomputed instead.
function repairWord(word) {
  if (!/[0-9X]/.test(word[8])) {
    const candidate = word.slice(0, 8) + (VIN_PATTERN.test(word) ? computeCheckDigit(word) : '?') + word.slice(9);
    return isCheckValid(candidate) ? [candidate] : [];
  }
  const repairs = [];
  for (let i = 0; i < 17; i++) {
    for (const alt of PHOTO_LOOKALIKES[word[i]] || '') {
      if (i >= 11 && !/\d/.test(alt)) continue; // The serial number end is digits.
      const candidate = word.slice(0, i) + alt + word.slice(i + 1);
      if (isCheckValid(candidate)) repairs.push(candidate);
    }
  }
  return [...new Set(repairs)];
}

// VINs end in at least four digits (serial number), which rules out most
// stray words when the check digit cannot vouch for a read.
const plausible = (vin) => /\d{4}$/.test(vin) && YEAR_CODES.includes(vin[9]);

// Finds every VIN in text read from a photo or screenshot (lists, sheets).
// Returns [{ vin, confidence }] with the same confidence rules as findVinInText:
// high = a whole 17-character word with a correct check digit; low = repaired,
// glued to other text, split by a space, or failing the check digit.
export function findAllVinsInText(text) {
  const lines = String(text ?? '').toUpperCase().replace(/[OQ]/g, '0').replace(/I/g, '1').split(/\n/);
  const found = new Map();
  const add = (vin, confidence) => {
    if (confidence === 'low' && !plausible(vin)) return false;
    if (found.get(vin) !== 'high') found.set(vin, confidence);
    return true;
  };

  for (const line of lines) {
    const words = line.split(/[^A-Z0-9]+/).filter(Boolean);
    let lineHasVin = false;
    for (const word of words) {
      if (word.length === 17) {
        if (isCheckValid(word)) {
          add(word, 'high');
          lineHasVin = true;
          continue;
        }
        const repairs = repairWord(word);
        if (repairs.length === 1) lineHasVin = add(repairs[0], 'low') || lineHasVin;
        else if (VIN_PATTERN.test(word)) lineHasVin = add(word, 'low') || lineHasVin;
      } else if (word.length > 17 && word.length <= 22) {
        // Text glued to the front or back of a VIN ("VIN3GN...", "#11FT...").
        const candidate = [word.slice(-17), word.slice(0, 17)].find(isCheckValid);
        if (candidate) lineHasVin = add(candidate, 'low') || lineHasVin;
      }
    }
    if (lineHasVin) continue;
    // A VIN split by stray spaces: two or three neighbouring words that make 17 characters.
    for (let i = 0; i < words.length; i++) {
      for (let n = 2; n <= 3 && i + n <= words.length; n++) {
        const candidate = words.slice(i, i + n).join('');
        if (candidate.length === 17 && isCheckValid(candidate)) add(candidate, 'low');
      }
    }
  }
  return [...found].map(([vin, confidence]) => ({ vin, confidence }));
}

function clean(value) {
  const v = String(value ?? '').trim();
  return v === '' || v === 'Not Applicable' ? '' : v;
}

// Maps an NHTSA result row to the fields the app uses.
export function mapNhtsaResult(row) {
  const errorCodes = clean(row.ErrorCode).split(',').map((c) => c.trim());
  const decoded = Boolean(clean(row.Make) && clean(row.Model));
  return {
    vin: clean(row.VIN).toUpperCase(),
    decoded,
    make: clean(row.Make).toUpperCase(),
    model: clean(row.Model),
    year: clean(row.ModelYear),
    trim: clean(row.Trim),
    body: clean(row.BodyCabType) || clean(row.BodyClass),
    fuel: clean(row.ElectrificationLevel).startsWith('BEV') ? 'Electric' : clean(row.FuelTypePrimary),
    drive: clean(row.DriveType),
    plant: [clean(row.PlantCity), clean(row.PlantCountry)].filter(Boolean).join(', '),
    decodeNote: errorCodes.includes('0') ? '' : clean(row.ErrorText),
  };
}

// Decodes VINs in batches of 50. Returns a Map of vin -> decoded fields.
export async function decodeVins(vins, { fetchImpl = fetch, onProgress } = {}) {
  const results = new Map();
  for (let i = 0; i < vins.length; i += BATCH_SIZE) {
    const batch = vins.slice(i, i + BATCH_SIZE);
    const body = new URLSearchParams({ format: 'json', data: batch.join(';') });
    const response = await fetchImpl(NHTSA_BATCH_URL, { method: 'POST', body });
    if (!response.ok) throw new Error(`NHTSA decode failed (HTTP ${response.status})`);
    const json = await response.json();
    for (const row of json.Results || []) {
      const mapped = mapNhtsaResult(row);
      results.set(mapped.vin, mapped);
    }
    onProgress?.(Math.min(i + BATCH_SIZE, vins.length), vins.length);
  }
  return results;
}
