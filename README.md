# Journal

Journal is an offline desktop journal built with Tauri, React, Lexical and SQLite.

## Run or build

Install Node.js 24+, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. On this Windows checkout the build scripts also recognize a local Rust toolchain under output/tauri-toolchain.

```sh
npm ci
npm start
```

Development uses a separate journal. Run `npm run build` to build the full application executable or `npm run package` to build installers for the current operating system. By default, Cargo writes the executable under `src-tauri/target/release` and installers under its `bundle` directory. Windows uses WebView2. The installer downloads its bootstrapper if required.

## Local data and recovery

Journal stores its personal database in the following locations.

- Windows — `%APPDATA%\com.charlescausey.journal\journal.sqlite`
- macOS — `~/Library/Application Support/com.charlescausey.journal/journal.sqlite`

Close Journal before copying the database folder for a backup.

Journal checks older schema versions 1–3 and upgrades them to version 4. It saves verified before/after snapshots under `backups/tauri` and compares existing entries, blocks and settings before committing the migration. When startup fails, the recovery screen lets you retry, locate the data folder, or select a SQLite backup. Restore verifies the selected database and archives the displaced database and its SQLite sidecars under `backups/recovery`.

## Verify

```sh
npm exec tsc -- --noEmit
npm run lint
npm test -- --runInBand
npm run build:web
npm run test:native
```

On Windows, run `npm run test:smoke` after a release build. It starts the packaged app with a fresh temporary journal, types in the Notes editor, closes the window, and checks the text and checklist preference after reopening.

## Releases

The desktop CI workflow builds on Windows, macOS and Linux. The release workflow prepares a draft on version tags. It builds a Windows x64 installer, a universal macOS DMG for Intel and Apple Silicon, and a Linux AppImage. For automatic update builds, configure the repository variable `JOURNAL_UPDATER_PUBLIC_KEY` and the matching secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before tagging. For signed and notarized macOS distribution, configure the Apple certificate and notarization secrets referenced in the workflow.

Signed release builds check for updates and offer installation when closing after saving. Builds without the update key use manual installation. Create a GitHub release draft for the version tag before pushing it so the workflow can attach the installers.
