# app-dev

One repository for all of our apps. Each app lives in its own folder under `apps/` and is self-contained.

## Apps

| App | Folder | Status | Description |
|---|---|---|---|
| Railcar Loader | [`apps/railcar-loader`](apps/railcar-loader) | In progress | Decodes VINs and groups vehicles into railcar load orders using user-defined combinations. |

## Repository layout

```
app-dev/
├── apps/                  # One folder per app
├── shared/                # Code or assets reused by two or more apps
├── templates/app-template # Starter folder for a new app
├── docs/                  # Repo-wide conventions
└── .github/workflows/     # CI and GitHub Pages deployment
```

## Adding a new app

1. Copy `templates/app-template` to `apps/<app-name>` (lowercase, hyphens).
2. Fill in the app's `README.md`.
3. Add the app to the table above.
4. Work on a branch named `<app-name>/<short-description>`.

See [`docs/conventions.md`](docs/conventions.md) for the full guidelines.

## Hosting

Apps are published with GitHub Pages at `https://<owner>.github.io/app-dev/<app-name>/`.
The deploy workflow (`.github/workflows/deploy-pages.yml`) runs on every push to `main`.
