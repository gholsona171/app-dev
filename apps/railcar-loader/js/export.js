// Load plan export (CSV and Excel).

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

const HEADERS = ['Load #', 'Load type', 'Combination', 'VIN', 'Year', 'Make', 'Model', 'Trim', 'Body / cab', 'Fuel', 'Drive'];

// One row per vehicle, loads first, then vehicles left over.
export function planRows(plan, vehiclesById, loadTypesById) {
  const row = (loadNo, loadType, combo, v) => [
    loadNo, loadType, combo, v.vin, v.year || '', v.make || '', v.model || '', v.trim || '', v.body || '', v.fuel || '', v.drive || '',
  ];
  const rows = [HEADERS];
  plan.loads.forEach((load, index) => {
    const loadType = loadTypesById.get(load.loadTypeId)?.name || '';
    for (const id of load.vehicleIds) rows.push(row(index + 1, loadType, load.comboName, vehiclesById.get(id)));
  });
  for (const { id, reason } of plan.unassigned) rows.push(row('Not loaded', '', reason, vehiclesById.get(id)));
  return rows;
}

export function toCsv(rows) {
  const escape = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(escape).join(',')).join('\r\n');
}

export function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => {
        scripts.delete(src);
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(el);
    }));
  }
  return scripts.get(src);
}

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Returns all text in a PDF, one text run per line.
export async function readPdfText(arrayBuffer) {
  await loadScript(PDFJS_URL);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => item.str).join('\n'));
  }
  return pages.join('\n');
}

export async function loadXlsx() {
  await loadScript(XLSX_URL);
  return window.XLSX;
}

export async function downloadXlsx(rows, filename) {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((_, i) => ({ wch: i === 3 ? 20 : 14 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Load plan');
  XLSX.writeFile(book, filename);
}
