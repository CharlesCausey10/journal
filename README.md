# Journal

Journal is an offline desktop journal built with Tauri, React, Lexical and SQLite.

## Run or build

Install Node.js 24+, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. On this Windows checkout the build scripts also recognize the Rust toolchain installed for the prototype.

```sh
npm ci
npm start
```

Development uses a separate journal. Run `npm run build` to build the full application executable or `npm run package` to build installers for the current operating system. By default, Cargo writes the executable under `src-tauri/target/release` and installers under its `bundle` directory. Windows uses WebView2. The installer downloads its bootstrapper if required.

## Moving from Electron

Quit Electron Journal, then launch the Tauri release. On its first launch it looks in the old Journal app-data folder and copies a consistent SQLite snapshot, including committed changes in the write-ahead log. Your entries, templates, layout and settings move together. From then on, each version saves to its own database. The standalone prototype uses a third, independent database.

The new personal database is `%APPDATA%\com.charlescausey.journal\journal.sqlite` on Windows and `~/Library/Application Support/com.charlescausey.journal/journal.sqlite` on macOS. The Electron database and its backup history remain in the original `journal` folder. The old app can still open that copy. Close both apps before making filesystem copies of a live database.

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

The desktop CI workflow builds on Windows, macOS and Linux. The release workflow prepares a draft on version tags. It builds a Windows x64 installer, a universal macOS DMG for Intel and Apple Silicon, and a Linux AppImage. Configure the repository variable `JOURNAL_UPDATER_PUBLIC_KEY` and the matching secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before tagging. For signed and notarized macOS distribution, configure the Apple certificate and notarization secrets referenced in the workflow.

Signed release builds check for updates and offer installation when closing after saving. Local builds omit the update key. Install the first Tauri release manually when switching from Electron.

## Tauri beta rollback

The Windows 1.2.0-beta.1 pre-release includes an Electron export in Settings and a separate rollback ZIP. Its Restore-Electron.ps1 tool closes the data-format gap between Tauri schema 4 and published Electron 1.1.3 schema 3. Close both apps, run the tool, confirm the replacement, then install Electron 1.1.3. The tool keeps a recovery copy of the displaced Electron database. The export preserves entries, panels, templates and shared preferences. The checklist-order preference is available in Tauri.

Writing independently in both apps requires choosing which journal to retain or arranging a separate merge. The restore tool replaces the Electron database with the Tauri snapshot.
