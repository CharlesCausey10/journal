/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  acknowledgeRecovery,
  backupDirectory,
  openProtectedDatabase,
  restoreDatabase,
} from '../main/database-backups';
import { initializeSchema } from '../main/database';

jest.mock('electron', () => ({ app: {} }));

let directory: string;
const opened: Database.Database[] = [];
const open = (migrate = initializeSchema) =>
  openProtectedDatabase({ directory, appVersion: 'test', migrate }).then(
    (connection) => {
      opened.push(connection);
      return connection;
    },
  );
const databasePath = () => path.join(directory, 'journal.sqlite');
const connect = () => {
  const connection = new Database(databasePath());
  opened.push(connection);
  return connection;
};
const sets = () =>
  fs
    .readdirSync(backupDirectory(directory))
    .map((name) => path.join(backupDirectory(directory), name));
const manifest = (folder: string) =>
  JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const contents = (filename = databasePath()) => {
  const connection = new Database(filename, { readonly: true });
  try {
    return connection.prepare('SELECT * FROM entries ORDER BY id').all();
  } finally {
    connection.close();
  }
};

function seed(legacy = false) {
  const connection = connect();
  if (legacy) {
    connection.exec(`
      CREATE TABLE blocks (id INTEGER PRIMARY KEY, label TEXT NOT NULL, placement TEXT NOT NULL,
        position INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE entries (id TEXT PRIMARY KEY, block_id INTEGER REFERENCES blocks(id),
        entry_date TEXT, content TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE user_settings (id INTEGER PRIMARY KEY, center_orientation TEXT CHECK(center_orientation IN ('horizontal', 'vertical')),
        header_size_px INTEGER, footer_size_px INTEGER, left_size_px INTEGER, right_size_px INTEGER,
        center_sizes TEXT, font_family TEXT, gap_px INTEGER);
      INSERT INTO blocks VALUES (1, 'Notes', 'center', 0, 1), (2, 'Tasks', 'right', 0, 1);
      INSERT INTO user_settings VALUES (1, 'vertical', 100, 100, 150, 150, '{}', 'georgia', 8);
    `);
  } else initializeSchema(connection);
  connection.exec(
    `INSERT INTO entries VALUES ('keep-me', 1, '2026-10-16', 'Private journal ✨', 'created', 'updated'); PRAGMA user_version = 1;`,
  );
  return connection;
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-migration-test-'));
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const connection of opened.splice(0))
    if (connection.open) connection.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a clean installation initializes version 3 without migration backups', async () => {
  const connection = await open();
  expect(connection.pragma('user_version', { simple: true })).toBe(3);
  expect(connection.prepare('SELECT count(*) AS n FROM blocks').get()).toEqual({
    n: 2,
  });
  expect(fs.existsSync(backupDirectory(directory))).toBe(false);
});

test('version 2 adds the query index with verified backups and preserves entries', async () => {
  const original = seed();
  original.exec('DROP INDEX entries_block_date_updated; PRAGMA user_version = 2');
  original.close();
  const connection = await open();
  expect(connection.pragma('user_version', { simple: true })).toBe(3);
  expect(manifest(sets()[0])).toMatchObject({ fromSchema: 2, toSchema: 3, status: 'complete' });
  expect(contents()).toHaveLength(1);
  const plans = connection.prepare(
    'EXPLAIN QUERY PLAN SELECT * FROM entries WHERE block_id = ? AND entry_date = ? ORDER BY updated_at DESC LIMIT 1',
  ).all(1, '2026-10-20') as { detail: string }[];
  expect(plans.some(({ detail }) => detail.includes('entries_block_date_updated'))).toBe(true);
  expect(plans.some(({ detail }) => detail.includes('SCAN entries') || detail.includes('TEMP B-TREE'))).toBe(false);
});

test('routine startup uses one quick check without exhaustive integrity scans', async () => {
  (await open()).close();
  const spy = jest.spyOn(Database.prototype, 'pragma');
  await open();
  const checks = spy.mock.calls.map(([statement]) => statement);
  expect(checks.filter((statement) => statement === 'quick_check')).toHaveLength(1);
  expect(checks).not.toContain('integrity_check');
  expect(checks).not.toContain('foreign_key_check');
});

test.each([false, true])(
  'version 1 migration preserves content and creates verified snapshots (legacy=%s)',
  async (legacy) => {
    const original = seed(legacy);
    // Include committed WAL data that a plain file copy might miss.
    original.pragma('journal_mode = WAL');
    original.pragma('wal_autocheckpoint = 0');
    original
      .prepare('UPDATE entries SET content = ?')
      .run('Latest WAL content');
    const expected = contents();
    fs.writeFileSync(
      path.join(directory, 'window-state.json'),
      '{"width":900}',
    );
    const connection = await open();
    original.close();
    expect(connection.pragma('user_version', { simple: true })).toBe(3);
    const [folder] = sets();
    expect(manifest(folder)).toMatchObject({
      status: 'complete',
      beforeVerified: true,
      afterVerified: true,
      fromSchema: 1,
      toSchema: 3,
    });
    expect(contents(path.join(folder, 'before.sqlite'))).toEqual(expected);
    expect(contents(path.join(folder, 'after.sqlite'))).toEqual(expected);
    expect(contents()).toEqual(expected);
    expect(
      fs.readFileSync(path.join(folder, 'window-state.json'), 'utf8'),
    ).toBe('{"width":900}');
    connection.close();
    await open();
    expect(sets()).toHaveLength(1);
  },
);

test('refuses unsupported, unversioned, and damaged schemas without resetting tables', async () => {
  const connection = seed();
  for (const version of [0, 99]) {
    connection.pragma(`user_version = ${version}`);
    await expect(open()).rejects.toThrow('unsupported');
    expect(contents()).toHaveLength(1);
  }
  connection.pragma('user_version = 2');
  connection.exec('ALTER TABLE blocks RENAME COLUMN is_active TO unexpected');
  await expect(open()).rejects.toThrow('damaged or unsupported');
  expect(contents()).toHaveLength(1);
});

test('failed migration rolls back every schema and data change and blocks automatic retries', async () => {
  seed().close();
  await expect(
    open((connection) => {
      connection.exec(
        'ALTER TABLE entries ADD COLUMN extra TEXT; DELETE FROM entries;',
      );
      throw new Error('simulated failure');
    }),
  ).rejects.toThrow('simulated failure');
  expect(contents()).toHaveLength(1);
  const check = connect();
  expect(check.pragma('user_version', { simple: true })).toBe(1);
  expect(
    (check.pragma('table_info(entries)') as { name: string }[]).some(
      ({ name }) => name === 'extra',
    ),
  ).toBe(false);
  check.close();
  await expect(open()).rejects.toThrow('previous migration');
  acknowledgeRecovery(directory);
  await open();
  expect(
    sets()
      .map(manifest)
      .map(({ status }) => status)
      .sort(),
  ).toEqual(['complete', 'superseded']);
});

test('detects silent content loss before commit', async () => {
  seed().close();
  await expect(
    open((connection) => {
      initializeSchema(connection);
      connection.exec("UPDATE entries SET content = 'overwritten'");
    }),
  ).rejects.toThrow('did not preserve entries');
  expect(contents()).toEqual([
    expect.objectContaining({ content: 'Private journal ✨' }),
  ]);
});

test('a before-backup failure prevents all migration writes', async () => {
  seed().close();
  jest
    .spyOn(Database.prototype, 'backup')
    .mockRejectedValue(new Error('disk full'));
  const migrate = jest.fn(initializeSchema);
  await expect(open(migrate)).rejects.toThrow('disk full');
  expect(migrate).not.toHaveBeenCalled();
  expect(contents()).toHaveLength(1);
  expect(manifest(sets()[0])).toMatchObject({
    status: 'failed',
    beforeVerified: false,
  });
});

test('an after-backup failure keeps the before snapshot and blocks editing and automatic retry', async () => {
  seed().close();
  const backup = Database.prototype.backup;
  jest.spyOn(Database.prototype, 'backup').mockImplementation(function (
    this: Database.Database,
    filename,
    options,
  ) {
    if (filename.includes('after.sqlite.partial'))
      return Promise.reject(new Error('disk full'));
    return backup.call(this, filename, options);
  });
  await expect(open()).rejects.toThrow('disk full');
  const [folder] = sets();
  expect(contents(path.join(folder, 'before.sqlite'))).toHaveLength(1);
  expect(manifest(folder)).toMatchObject({
    status: 'failed',
    beforeVerified: true,
    afterVerified: false,
  });
  await expect(open()).rejects.toThrow('previous migration');
});

test('interrupted and unreadable attempts require an explicit retry', async () => {
  seed().close();
  const folder = path.join(backupDirectory(directory), 'interrupted');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'manifest.json'), '{');
  await expect(open()).rejects.toThrow('previous migration');
  acknowledgeRecovery(directory);
  await open();
  expect(contents()).toHaveLength(1);
});

test('restore preserves current files and restores a supported before-backup', async () => {
  seed(true).close();
  const connection = await open();
  const [folder] = sets();
  connection.exec("UPDATE entries SET content = 'Newer content'");
  connection.close();
  const recovery = await restoreDatabase(
    directory,
    path.join(folder, 'before.sqlite'),
    initializeSchema,
  );
  expect(contents(path.join(recovery, 'original.sqlite'))).toEqual([
    expect.objectContaining({ content: 'Newer content' }),
  ]);
  expect(contents()).toEqual([
    expect.objectContaining({ content: 'Private journal ✨' }),
  ]);
  await open();
  expect(contents()).toHaveLength(1);
});

test('rejects corrupt and incompatible restore selections without changing the journal', async () => {
  seed().close();
  const corrupt = path.join(directory, 'corrupt.sqlite');
  fs.writeFileSync(corrupt, 'not a database');
  await expect(
    restoreDatabase(directory, corrupt, initializeSchema),
  ).rejects.toThrow();
  const future = path.join(directory, 'future.sqlite');
  const futureConnection = new Database(future);
  futureConnection.pragma('user_version = 99');
  futureConnection.close();
  await expect(
    restoreDatabase(directory, future, initializeSchema),
  ).rejects.toThrow('not supported');
  const empty = path.join(directory, 'empty.sqlite');
  new Database(empty).close();
  await expect(
    restoreDatabase(directory, empty, initializeSchema),
  ).rejects.toThrow('not supported');
  expect(contents()).toHaveLength(1);
});

test('retains five complete pairs and preserves failed attempts', async () => {
  seed().close();
  await expect(
    open(() => {
      throw new Error('failed');
    }),
  ).rejects.toThrow('failed');
  acknowledgeRecovery(directory);
  for (let i = 0; i < 7; i += 1) {
    const connection = await open();
    connection.pragma('user_version = 1');
    connection.close();
  }
  expect(
    sets()
      .map(manifest)
      .filter(({ status }) => status === 'complete'),
  ).toHaveLength(5);
  expect(
    sets()
      .map(manifest)
      .filter(({ status }) => status === 'superseded'),
  ).toHaveLength(1);
});

test('retry finishes a failed after-backup before allowing edits', async () => {
  seed().close();
  const backup = Database.prototype.backup;
  const spy = jest
    .spyOn(Database.prototype, 'backup')
    .mockImplementation(function (this: Database.Database, filename, options) {
      if (filename.includes('after.sqlite.partial'))
        return Promise.reject(new Error('disk full'));
      return backup.call(this, filename, options);
    });
  await expect(open()).rejects.toThrow('disk full');
  spy.mockRestore();
  acknowledgeRecovery(directory);
  const connection = await open();
  expect(manifest(sets()[0])).toMatchObject({
    status: 'complete',
    afterVerified: true,
  });
  connection.exec("UPDATE entries SET content = 'Allowed edit'");
  connection.close();
  await open();
  expect(contents()).toEqual([
    expect.objectContaining({ content: 'Allowed edit' }),
  ]);
});

test('an old rolled-back attempt cannot block later legitimate edits', async () => {
  seed().close();
  await expect(
    open(() => {
      throw new Error('failed');
    }),
  ).rejects.toThrow('failed');
  acknowledgeRecovery(directory);
  const connection = await open();
  connection.exec("UPDATE entries SET content = 'Allowed edit'");
  connection.close();
  await open();
  expect(contents()).toEqual([
    expect.objectContaining({ content: 'Allowed edit' }),
  ]);
});

test('restores a backup when the active database is corrupt', async () => {
  seed().close();
  const connection = await open();
  const [folder] = sets();
  connection.close();
  fs.writeFileSync(databasePath(), 'damaged database');
  const recovery = await restoreDatabase(
    directory,
    path.join(folder, 'after.sqlite'),
    initializeSchema,
  );
  expect(fs.readFileSync(path.join(recovery, 'original.sqlite'), 'utf8')).toBe(
    'damaged database',
  );
  expect(contents()).toHaveLength(1);
  await open();
});

test('an interrupted replacement cannot initialize a blank journal or bypass recovery', async () => {
  seed().close();
  const connection = await open();
  const [folder] = sets();
  connection.close();
  const rename = fs.renameSync;
  const interruption = jest
    .spyOn(fs, 'renameSync')
    .mockImplementation((from, to) => {
      if (
        String(from).endsWith('replacement.sqlite') &&
        to === databasePath()
      ) {
        throw new Error('simulated interruption');
      }
      rename(from, to);
    });
  await expect(
    restoreDatabase(
      directory,
      path.join(folder, 'after.sqlite'),
      initializeSchema,
    ),
  ).rejects.toThrow('simulated interruption');
  interruption.mockRestore();
  expect(fs.existsSync(databasePath())).toBe(false);
  await expect(open()).rejects.toThrow('previous migration');
  expect(() => acknowledgeRecovery(directory)).toThrow('interrupted restore');
  await restoreDatabase(
    directory,
    path.join(folder, 'after.sqlite'),
    initializeSchema,
  );
  await open();
  expect(contents()).toHaveLength(1);
});

test('a missing database with existing backups requires restore', async () => {
  seed().close();
  (await open()).close();
  fs.renameSync(databasePath(), path.join(directory, 'saved.sqlite'));
  await expect(open()).rejects.toThrow('database is missing');
  expect(fs.existsSync(databasePath())).toBe(false);
});

test('a failed explicit after-backup retry still blocks future automatic attempts', async () => {
  seed().close();
  const backup = Database.prototype.backup;
  jest.spyOn(Database.prototype, 'backup').mockImplementation(function (
    this: Database.Database,
    filename,
    options,
  ) {
    if (filename.includes('after.sqlite.partial'))
      return Promise.reject(new Error('disk full'));
    return backup.call(this, filename, options);
  });
  await expect(open()).rejects.toThrow('disk full');
  acknowledgeRecovery(directory);
  await expect(open()).rejects.toThrow('disk full');
  await expect(open()).rejects.toThrow('previous migration');
});

test('invalid snapshots prevent migration even if the backup call reports success', async () => {
  seed().close();
  jest
    .spyOn(Database.prototype, 'backup')
    .mockImplementation(async (filename) => {
      fs.writeFileSync(filename, 'corrupt snapshot');
      return { totalPages: 1, remainingPages: 0 };
    });
  const migrate = jest.fn(initializeSchema);
  await expect(open(migrate)).rejects.toThrow();
  expect(migrate).not.toHaveBeenCalled();
  expect(contents()).toHaveLength(1);
});
