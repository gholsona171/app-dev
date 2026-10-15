# Conventions

## Apps

- Every app lives in `apps/<app-name>/`. Names are lowercase with hyphens (for example `railcar-loader`).
- Everything an app needs stays inside its folder: source, tests, docs, and config.
- Every app has a `README.md` covering its purpose, how to run it, the tech stack, and its status.
- An app must not import files from another app. Code needed by two or more apps moves to `shared/`.

## Branches

- Branch names start with the app name: `<app-name>/<short-description>`.
- Repo-wide changes use `repo/<short-description>`.

## Status values

Use one of these in each app's README and in the root app table:

- **Idea**: planned, not started
- **In progress**: under active development
- **Testing**: feature-complete, being tested
- **Live**: in use
- **Archived**: no longer maintained
