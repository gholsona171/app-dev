# Railcar Loader

**Status:** In progress

## Purpose

Built for Precision to plan train load orders. The user enters vehicle VINs, the app decodes them, and then groups the vehicles into loads using the combinations the user says can travel together (for example, "5 × F-150" or "3 × F-150 + 1 × Equinox EV").

## How it works

1. **Vehicles:** Add VINs by typing/pasting, uploading a PDF, Excel, or CSV file, or scanning (phone camera or handheld scanner). Input methods can be switched on or off in Settings. Each VIN is validated (length, characters, check digit) and decoded with the free NHTSA vPIC database.
2. **Combinations:** Define load types (for example "Railcar") and the allowed vehicle combinations for one load. Order matters: combinations higher in the list win when two plans are equally good.
3. **Load plan:** The app searches for the plan that loads the most vehicles, then uses the fewest loads. Vehicles that can't be loaded are listed with a reason. The plan can be printed or exported to CSV or Excel.

### Camera scanner

- **Automatic:** VIN barcodes are added as soon as they are read. Printed VIN text (windshield plate, door sticker) is read every couple of seconds; a clean read is added right away, and a read that needed a one-character correction pauses and asks you to confirm.
- **Capture button:** tries every method on the current frame (barcode in the box, whole frame, rotated, then text) and shows the result to confirm or edit.
- **Light and zoom** controls appear when the phone supports them.
- Uses the phone's built-in barcode reader when available (Android Chrome), otherwise ZXing. Every other frame is noise-reduced and sharpened to help with blur and glare.

### Matching detail

Make and model are always used to identify a vehicle. Settings has toggles to also use model year, trim, body/cab style, fuel type (EV vs. gas), and drive type. The toggles apply to new combination items; existing items keep the detail they were created with.

## Tech stack

- Plain HTML, CSS, and JavaScript (ES modules), no build step
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) for VIN decoding (free, no key)
- [SheetJS](https://sheetjs.com/) for Excel import/export and [PDF.js](https://mozilla.github.io/pdf.js/) for PDF upload, loaded only when needed
- [ZXing](https://github.com/zxing-js/library) for barcode reading and [Tesseract.js](https://tesseract.projectnaptha.com/) for VIN text reading, loaded only when the scanner opens
- Data is stored in the browser (`localStorage`) for testing. Supabase will replace `js/storage.js` later.

## Running locally

```bash
cd apps/railcar-loader
npm start          # serves the app at http://localhost:8080
```

Camera scanning requires HTTPS or `localhost`.

## Testing

```bash
cd apps/railcar-loader
npm test
```

Requires Node.js 20 or newer. No dependencies to install.

## Test sheet

`test-assets/vin-test-sheet.pdf` is a printable sheet with 37 VINs for 12 real models: Code 39 barcodes, printed VIN text, QR and Data Matrix codes, a full list for the upload test, and one VIN with a bad check digit. Regenerate it with `python3 test-assets/make_test_sheet.py` (needs `reportlab`).

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page layout |
| `css/styles.css` | Styling, including the print layout |
| `js/app.js` | User interface and events |
| `js/vin.js` | VIN cleaning, validation, text matching, and NHTSA decoding |
| `js/scanner.js` | Camera scanner (barcodes and VIN text) |
| `js/grouping.js` | Vehicle matching and load planning |
| `js/storage.js` | Saving data (browser now, Supabase later) |
| `js/export.js` | CSV and Excel export |
| `tests/` | Unit tests for `vin.js`, `grouping.js`, and `scanner.js` |

## Open questions

- What exactly is one "load": a railcar, a deck, or something else? Load types are user-defined so this can be decided later.
- Supabase schema and when to move off browser storage.
