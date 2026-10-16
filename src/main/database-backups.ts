import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const currentVersion = 2;
type Connection = Database.Database;
type Manifest = {
  id: string;
  createdAt: string;
  appVersion: string;
  fromSchema: number;
  toSchema: number;
  status: 'pending' | 'complete' | 'failed' | 'acknowledged' | 'superseded';
  beforeVerified: boolean;
  afterVerified: boolean;
  recoveryFolder?: string;
};

export function backupDirectory(directory: string) {
  return path.join(directory, 'backups', 'migrations');
}

function writeManifest(folder: string, manifest: Manifest) {
  const temporary = path.join(folder, 'manifest.tmp');
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  const descriptor = fs.openSync(temporary, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, path.join(folder, 'manifest.json'));
}

function attempts(directory: string) {
  const root = backupDirectory(directory);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = path.join(root, entry.name);
      // An incomplete or unreadable manifest must also block automatic retries.
      let manifest: Manifest | undefined;
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'),
        );
        if (
          parsed &&
          typeof parsed.id === 'string' &&
          typeof parsed.createdAt === 'string' &&
          typeof parsed.beforeVerified === 'boolean' &&
          typeof parsed.afterVerified === 'boolean' &&
          [
            'pending',
            'complete',
            'failed',
            'acknowledged',
            'superseded',
          ].includes(parsed.status)
        ) {
          manifest = parsed;
        }
      } catch {
        /* interrupted creation */
      }
      return { folder, manifest };
    });
}

export function acknowledgeRecovery(directory: string, restored = false) {
  fs.mkdirSync(path.join(directory, 'backups', 'recovery'), {
    recursive: true,
  });
  if (
    !restored &&
    attempts(directory).some(
      ({ manifest }) =>
        manifest?.recoveryFolder &&
        ['pending', 'failed'].includes(manifest.status),
    )
  ) {
    throw new Error(
      'An interrupted restore must be completed by selecting a backup again before Journal can open.',
    );
  }
  for (const { folder, manifest } of attempts(directory)) {
    if (manifest && ['pending', 'failed'].includes(manifest.status)) {
      writeManifest(folder, { ...manifest, status: 'acknowledged' });
    } else if (!manifest) {
      // Preserve unidentified artifacts, but move them out of the attempt inventory.
      fs.renameSync(
        folder,
        path.join(
          directory,
          'backups',
          'recovery',
          `${path.basename(folder)}-unidentified-${randomUUID()}`,
        ),
      );
    }
  }
}

function supersedeAcknowledged(directory: string) {
  for (const { folder, manifest } of attempts(directory)) {
    if (manifest?.status === 'acknowledged')
      writeManifest(folder, { ...manifest, status: 'superseded' });
  }
}

export function validateDatabase(connection: Connection) {
  if (connection.pragma('integrity_check', { simple: true }) !== 'ok') {
    throw new Error('Database integrity verification failed.');
  }
  if ((connection.pragma('foreign_key_check') as unknown[]).length) {
    throw new Error('Database contains broken journal relationships.');
  }
}

function inspect(filename: string, validate = validateDatabase) {
  const connection = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    validate(connection);
  } finally {
    connection.close();
  }
}

async function snapshot(connection: Connection, filename: string) {
  const temporary = `${filename}.partial-${randomUUID()}`;
  await connection.backup(temporary);
  inspect(temporary);
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, filename);
}

function assertPreserved(connection: Connection) {
  for (const table of ['entries', 'blocks', 'user_settings']) {
    const originalColumns = (
      connection.prepare(`PRAGMA before.table_info(${table})`).all() as {
        name: string;
      }[]
    )
      .map(({ name }) => name)
      .filter((name) => name !== 'gap_px');
    if (!originalColumns.length)
      throw new Error(`Missing original ${table} table.`);
    const columns = originalColumns
      .map((name) => `"${name.replaceAll('"', '""')}"`)
      .join(', ');
    const lost = connection
      .prepare(
        `SELECT ${columns} FROM before.${table} EXCEPT SELECT ${columns} FROM main.${table}`,
      )
      .all();
    const count = (schema: string) =>
      (
        connection
          .prepare(`SELECT count(*) AS n FROM ${schema}.${table}`)
          .get() as { n: number }
      ).n;
    if (lost.length || count('before') !== count('main')) {
      throw new Error(`Migration did not preserve ${table}.`);
    }
  }
}

function prune(directory: string) {
  const successful = attempts(directory)
    .filter(({ manifest }) => manifest?.status === 'complete')
    .sort((a, b) => b.manifest!.createdAt.localeCompare(a.manifest!.createdAt));
  // Only prune known completed sets after confirming both snapshots still validate.
  const verified = successful.filter(({ folder }) => {
    try {
      inspect(path.join(folder, 'before.sqlite'));
      inspect(path.join(folder, 'after.sqlite'));
      return true;
    } catch {
      return false;
    }
  });
  for (const { folder } of verified.slice(5))
    fs.rmSync(folder, { recursive: true });
}

export async function openProtectedDatabase(options: {
  directory: string;
  appVersion: string;
  migrate: (connection: Connection) => void;
}) {
  const { directory, appVersion, migrate } = options;
  fs.mkdirSync(directory, { recursive: true });
  if (
    attempts(directory).some(
      ({ manifest }) =>
        !manifest ||
        !['complete', 'acknowledged', 'superseded'].includes(manifest.status),
    )
  ) {
    throw new Error(
      'A previous migration was interrupted or failed. Review your recovery options before retrying.',
    );
  }
  if (
    !fs.existsSync(path.join(directory, 'journal.sqlite')) &&
    attempts(directory).length
  ) {
    throw new Error(
      'The active journal database is missing. Restore a backup to continue.',
    );
  }
  const connection = new Database(path.join(directory, 'journal.sqlite'));
  let folder: string | undefined;
  let manifest: Manifest | undefined;
  try {
    connection.pragma('foreign_keys = ON');
    validateDatabase(connection);
    const version = connection.pragma('user_version', {
      simple: true,
    }) as number;
    const empty =
      version === 0 &&
      !connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all().length;
    if (!empty && version !== 1 && version !== currentVersion) {
      throw new Error(
        'This database version is unsupported. Please use a compatible Journal release.',
      );
    }
    if (empty || version === currentVersion) {
      connection.transaction(() => {
        migrate(connection);
        validateDatabase(connection);
      })();
      // An explicitly retried post-commit failure still needs its after snapshot.
      for (const attempt of attempts(directory)) {
        if (
          version === currentVersion &&
          attempt.manifest?.status === 'acknowledged' &&
          attempt.manifest.beforeVerified &&
          !attempt.manifest.afterVerified
        ) {
          folder = attempt.folder;
          manifest = attempt.manifest;
          connection
            .prepare('ATTACH DATABASE ? AS before')
            .run(path.join(attempt.folder, 'before.sqlite'));
          try {
            assertPreserved(connection);
          } finally {
            connection.exec('DETACH DATABASE before');
          }
          await snapshot(connection, path.join(attempt.folder, 'after.sqlite'));
          manifest = {
            ...attempt.manifest,
            status: 'complete',
            afterVerified: true,
          };
          writeManifest(attempt.folder, manifest);
          try {
            prune(directory);
          } catch {
            /* retain extra backups */
          }
        }
      }
    } else {
      // A rolled-back attempt must not later be mistaken for a post-commit failure.
      supersedeAcknowledged(directory);
      folder = path.join(
        backupDirectory(directory),
        `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`,
      );
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      manifest = {
        id: path.basename(folder),
        createdAt: new Date().toISOString(),
        appVersion,
        fromSchema: version,
        toSchema: currentVersion,
        status: 'pending',
        beforeVerified: false,
        afterVerified: false,
      };
      writeManifest(folder, manifest);
      const settings = path.join(directory, 'window-state.json');
      if (fs.existsSync(settings))
        fs.copyFileSync(settings, path.join(folder, 'window-state.json'));
      await snapshot(connection, path.join(folder, 'before.sqlite'));
      manifest.beforeVerified = true;
      writeManifest(folder, manifest);
      connection
        .prepare('ATTACH DATABASE ? AS before')
        .run(path.join(folder, 'before.sqlite'));
      try {
        connection
          .transaction(() => {
            migrate(connection);
            validateDatabase(connection);
            assertPreserved(connection);
            if (
              connection.pragma('user_version', { simple: true }) !==
              currentVersion
            )
              throw new Error('Migration version was not updated.');
          })
          .immediate();
      } finally {
        connection.exec('DETACH DATABASE before');
      }
      await snapshot(connection, path.join(folder, 'after.sqlite'));
      manifest.afterVerified = true;
      manifest.status = 'complete';
      writeManifest(folder, manifest);
      // Retention failures must not turn a verified migration into a failed one.
      try {
        prune(directory);
      } catch {
        /* retain extra backups */
      }
    }
    connection.pragma('journal_mode = WAL');
    return connection;
  } catch (error) {
    connection.close();
    if (folder && manifest) {
      try {
        writeManifest(folder, { ...manifest, status: 'failed' });
      } catch {
        /* pending marker remains */
      }
    }
    throw error;
  }
}

/** All application database connections must be closed before calling this. */
export async function restoreDatabase(
  directory: string,
  filename: string,
  migrate: (connection: Connection) => void,
) {
  fs.mkdirSync(path.join(directory, 'backups', 'recovery'), {
    recursive: true,
  });
  const folder = fs.mkdtempSync(
    path.join(directory, 'backups', 'recovery', 'restore-'),
  );
  const staged = path.join(folder, 'selected.sqlite');
  // Snapshot the selection first: never restore directly from a changing source.
  const source = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    validateDatabase(source);
    await snapshot(source, staged);
  } finally {
    source.close();
  }
  const candidate = new Database(staged);
  try {
    const selectedVersion = candidate.pragma('user_version', { simple: true });
    if (selectedVersion !== 1 && selectedVersion !== currentVersion) {
      throw new Error(
        'The selected file is not a supported Journal backup; its schema version is not supported.',
      );
    }
    // Prove this release can migrate the selection, without modifying that snapshot.
    candidate.pragma('foreign_keys = ON');
    candidate.exec('BEGIN');
    try {
      migrate(candidate);
      validateDatabase(candidate);
    } finally {
      candidate.exec('ROLLBACK');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const original = path.join(directory, `journal.sqlite${suffix}`);
      if (fs.existsSync(original))
        fs.copyFileSync(
          original,
          path.join(folder, `original.sqlite${suffix}`),
        );
    }
    const markerFolder = path.join(
      backupDirectory(directory),
      `restore-${randomUUID()}`,
    );
    fs.mkdirSync(markerFolder, { recursive: true });
    const marker: Manifest = {
      id: path.basename(markerFolder),
      createdAt: new Date().toISOString(),
      recoveryFolder: folder,
      appVersion: 'recovery',
      fromSchema: candidate.pragma('user_version', { simple: true }) as number,
      toSchema: currentVersion,
      status: 'pending',
      beforeVerified: false,
      afterVerified: false,
    };
    writeManifest(markerFolder, marker);
    // Build a standalone replacement before touching the active files. A corrupt
    // destination cannot be overwritten using SQLite's backup API directly.
    const replacement = path.join(folder, 'replacement.sqlite');
    await snapshot(candidate, replacement);
    const standalone = new Database(replacement);
    try {
      standalone.pragma('journal_mode = DELETE');
      validateDatabase(standalone);
    } finally {
      standalone.close();
    }
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const original = path.join(directory, `journal.sqlite${suffix}`);
      if (fs.existsSync(original))
        fs.renameSync(original, path.join(folder, `displaced.sqlite${suffix}`));
    }
    fs.renameSync(replacement, path.join(directory, 'journal.sqlite'));
    inspect(path.join(directory, 'journal.sqlite'));
    acknowledgeRecovery(directory, true);
    supersedeAcknowledged(directory);
  } finally {
    candidate.close();
  }
  return folder;
}
