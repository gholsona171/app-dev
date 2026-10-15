# Railcar Loader

**Status:** In progress

## Purpose

Built for Precision to plan train load orders. The user enters vehicle VINs, the app decodes them, and then groups the vehicles into loads using the combinations the user says can travel together (for example, "5 × F-150" or "3 × F-150 + 1 × Equinox EV").

## How it works

1. **Vehicles:** Add VINs by typing/pasting, uploading an Excel/CSV file, or scanning barcodes (phone camera or handheld scanner). Input methods can be switched on or off in Settings. Each VIN is validated (length, characters, check digit) and decoded with the free NHTSA vPIC database.
2. **Combinations:** Define load types (for example "Railcar") and the allowed vehicle combinations for one load. Order matters: combinations higher in the list win when two plans are equally good.
3. **Load plan:** The app searches for the plan that loads the most vehicles, then uses the fewest loads. Vehicles that can't be loaded are listed with a reason. The plan can be printed or exported to CSV or Excel.

### Matching detail

Make and model are always used to identify a vehicle. Settings has toggles to also use model year, trim, body/cab style, fuel type (EV vs. gas), and drive type. The toggles apply to new combination items; existing items keep the detail they were created with.

## Tech stack

- Plain HTML, CSS, and JavaScript (ES modules), no build step
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) for VIN decoding (free, no key)
- [SheetJS](https://sheetjs.com/) for Excel import/export, loaded only when needed
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) for camera barcode scanning, loaded only when needed
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

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page layout |
| `css/styles.css` | Styling, including the print layout |
| `js/app.js` | User interface and events |
| `js/vin.js` | VIN cleaning, validation, and NHTSA decoding |
| `js/grouping.js` | Vehicle matching and load planning |
| `js/storage.js` | Saving data (browser now, Supabase later) |
| `js/export.js` | CSV and Excel export |
| `tests/` | Unit tests for `vin.js` and `grouping.js` |

## Open questions

- What exactly is one "load": a railcar, a deck, or something else? Load types are user-defined so this can be decided later.
- Supabase schema and when to move off browser storage.
