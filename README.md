A daily journal for personal use and development experience

## Local data

The installed app keeps its existing personal database in Electron's default
`userData` directory. Development runs (`npm start`) use a separate
`Journal Development` directory under Electron's `appData` directory instead.
On Windows, the development database is
`%APPDATA%\Journal Development\journal.sqlite`.

The development database is created on its first run with the default blocks.
Existing personal data is not moved or copied. Development window settings and
browser session data are also kept in the separate development directory.

## Migration backups and recovery

Journal upgrades existing version 1 databases to schema version 2 on startup.
Before changing an existing database it creates and verifies a SQLite snapshot;
it then migrates in a transaction, checks that entries, blocks, and settings were
preserved, and creates a verified snapshot of the result before enabling editing.
New, empty databases are initialized directly. Unsupported or damaged databases
are never automatically reset.

Backups live under `<userData>/backups/migrations/<timestamp-and-id>/` alongside
the personal database, outside the application installation directory. Each
successful set includes `before.sqlite`, `after.sqlite`, a `manifest.json` with
app/schema versions and verification status, and `window-state.json` if present.
Journal keeps the latest five verified successful pairs. Failed and interrupted
attempts are retained. These local snapshots are not encrypted and do not protect
against disk failure; copy important backups to another drive as well.

If startup or migration fails, a recovery dialog offers **Quit**, **Open backup
folder**, **Retry**, and **Restore backup**. Retry requires an explicit user action.
If migration committed but the after-backup failed, Retry verifies preservation
and finishes that snapshot before enabling editing. Restore validates that the
selected database can be used by this release and preserves the current database
and SQLite sidecar files under `<userData>/backups/recovery/` before replacing it.
An interrupted restore requires selecting a backup again; it cannot silently
initialize an empty journal. Restoring changes the database (including journal
settings); window placement remains unchanged.

Do not open the upgraded database with older Journal releases that contain the
previous schema-reset behavior. To return to one of those releases, quit Journal
and use its compatible `before.sqlite` snapshot, preserving the current database
first. Newer safeguarded releases refuse unsupported schema versions.

Migration tests use disposable temporary databases, never your personal data.
The publish workflow runs TypeScript checks and application/migration tests before
publishing installers. Packaged installer upgrade testing is still a separate
release check.
