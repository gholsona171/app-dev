// Data storage. For testing, everything is saved in the browser (localStorage).
// When Supabase is added, only this file needs to change.

const STORAGE_KEY = 'railcar-loader:v1';

export function defaultState() {
  return {
    settings: {
      inputMethods: { paste: true, file: true, scan: true },
      matchFields: { year: false, trim: false, body: false, fuel: true, drive: false },
    },
    vehicles: [],
    loadTypes: [{ id: 'lt-railcar', name: 'Railcar' }],
    combos: [],
    decodeCache: {},
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const defaults = defaultState();
    return {
      ...defaults,
      ...saved,
      settings: {
        inputMethods: { ...defaults.settings.inputMethods, ...saved.settings?.inputMethods },
        matchFields: { ...defaults.settings.matchFields, ...saved.settings?.matchFields },
      },
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
