import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Entry {
  id: string;
  blockId: number;
  entryDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Block {
  id: number;
  label: string;
  placement: BlockPlacement;
  position: number;
  fontSizePx: number;
  resetFrequency: ResetFrequency;
}

export type ResetFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export type BlockPlacement =
  | 'header'
  | 'footer'
  | 'left'
  | 'right'
  | 'center';

export type FontFamily =
  | 'handlee'
  | 'arial'
  | 'georgia'
  | 'trebuchet'
  | 'verdana'
  | 'courier';

export type ColorScheme =
  | 'paper'
  | 'stone'
  | 'sage'
  | 'lavender'
  | 'midnight'
  | 'charcoal';

export interface LayoutSettings {
  centerOrientation: 'horizontal' | 'vertical' | 'grid';
  headerSizePx: number;
  footerSizePx: number;
  leftSizePx: number;
  rightSizePx: number;
  centerSizes: Record<number, number>;
  fontFamily: FontFamily;
  colorScheme: ColorScheme;
}

export interface SaveEntryInput {
  id?: string;
  blockId: number;
  entryDate: string;
  content: string;
}

let database: Database.Database | null = null;

function hasCurrentSchema(connection: Database.Database) {
  const version = connection.pragma('user_version', { simple: true }) as number;
  if (version !== 1) return false;

  const columnsFor = (table: string) =>
    new Set(
      (connection.pragma(`table_info(${table})`) as { name: string }[]).map(
        (column) => column.name,
      ),
    );
  const blockColumns = columnsFor('blocks');
  const entryColumns = columnsFor('entries');
  const layoutColumns = columnsFor('user_settings');
  const userSettingsDefinition = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_settings'")
    .get() as { sql: string } | undefined;
  const userSettingsSql = userSettingsDefinition?.sql ?? '';

  return (
    userSettingsSql.includes("'grid'") &&
    userSettingsSql.includes("'midnight'") &&
    userSettingsSql.includes("'charcoal'") &&
    !userSettingsSql.includes('gap_px') &&
    userSettingsSql.includes('header_size_px BETWEEN 32 AND 240') &&
    userSettingsSql.includes('footer_size_px BETWEEN 32 AND 240') &&
    [
      'id',
      'label',
      'placement',
      'position',
      'is_active',
      'font_size_px',
      'reset_frequency',
    ].every(
      (column) => blockColumns.has(column),
    ) &&
    ['id', 'block_id', 'entry_date', 'content', 'created_at', 'updated_at'].every(
      (column) => entryColumns.has(column),
    ) &&
    [
      'id',
      'center_orientation',
      'header_size_px',
      'footer_size_px',
      'left_size_px',
      'right_size_px',
      'center_sizes',
      'font_family',
      'color_scheme',
    ].every((column) =>
      layoutColumns.has(column),
    )
  );
}

function initializeSchema(connection: Database.Database) {
  const version = connection.pragma('user_version', { simple: true }) as number;
  if (version === 1) {
    const settingsDefinition = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_settings'")
      .get() as { sql: string } | undefined;
    if (
      settingsDefinition &&
      (!settingsDefinition.sql.includes("'grid'") ||
        settingsDefinition.sql.includes('gap_px') ||
        !settingsDefinition.sql.includes("'midnight'") ||
        !settingsDefinition.sql.includes("'charcoal'"))
    ) {
      const existingSettingsColumns = new Set(
        (connection.pragma('table_info(user_settings)') as { name: string }[]).map(
          (column) => column.name,
        ),
      );
      const existingColorScheme = existingSettingsColumns.has('color_scheme')
        ? 'color_scheme'
        : "'paper'";
      const migrateLayoutSettings = connection.transaction(() => {
        connection.exec(`
          CREATE TABLE user_settings_updated (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            center_orientation TEXT NOT NULL CHECK (
              center_orientation IN ('horizontal', 'vertical', 'grid')
            ),
            header_size_px INTEGER NOT NULL CHECK (header_size_px BETWEEN 32 AND 240),
            footer_size_px INTEGER NOT NULL CHECK (footer_size_px BETWEEN 32 AND 240),
            left_size_px INTEGER NOT NULL CHECK (left_size_px BETWEEN 120 AND 360),
            right_size_px INTEGER NOT NULL CHECK (right_size_px BETWEEN 120 AND 360),
            center_sizes TEXT NOT NULL,
            font_family TEXT NOT NULL CHECK (
              font_family IN ('handlee', 'arial', 'georgia', 'trebuchet', 'verdana', 'courier')
            ),
            color_scheme TEXT NOT NULL CHECK (
              color_scheme IN ('paper', 'stone', 'sage', 'lavender', 'midnight', 'charcoal')
            )
          );
          INSERT INTO user_settings_updated
            (id, center_orientation, header_size_px, footer_size_px,
             left_size_px, right_size_px, center_sizes, font_family, color_scheme)
          SELECT id, center_orientation, header_size_px, footer_size_px,
                 left_size_px, right_size_px, center_sizes, font_family,
                 ${existingColorScheme}
          FROM user_settings;
          DROP TABLE user_settings;
          ALTER TABLE user_settings_updated RENAME TO user_settings;
        `);
      });
      migrateLayoutSettings();
    }
    const blockColumns = new Set(
      (connection.pragma('table_info(blocks)') as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    if (blockColumns.has('is_active') && !blockColumns.has('font_size_px')) {
      connection.exec(`
        ALTER TABLE blocks ADD COLUMN font_size_px INTEGER NOT NULL DEFAULT 18
          CHECK (font_size_px BETWEEN 12 AND 36);
      `);
    }
    if (blockColumns.has('is_active') && !blockColumns.has('reset_frequency')) {
      connection.exec(`
        ALTER TABLE blocks ADD COLUMN reset_frequency TEXT NOT NULL DEFAULT 'daily'
          CHECK (reset_frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'never'));
      `);
    }
  }
  if (hasCurrentSchema(connection)) return;

  const initialize = connection.transaction(() => {
    connection.exec(`
      DROP TABLE IF EXISTS entries;
      DROP TABLE IF EXISTS blocks;
      DROP TABLE IF EXISTS user_settings;
      DROP TABLE IF EXISTS layout_settings;

      CREATE TABLE blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        placement TEXT NOT NULL CHECK (
          placement IN ('header', 'footer', 'left', 'right', 'center')
        ),
        position INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        font_size_px INTEGER NOT NULL DEFAULT 18 CHECK (font_size_px BETWEEN 12 AND 36),
        reset_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (
          reset_frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'never')
        ),
        UNIQUE (placement, position)
      );

      CREATE TABLE entries (
        id TEXT PRIMARY KEY NOT NULL,
        block_id INTEGER NOT NULL REFERENCES blocks(id),
        entry_date TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        center_orientation TEXT NOT NULL CHECK (
          center_orientation IN ('horizontal', 'vertical', 'grid')
        ),
        header_size_px INTEGER NOT NULL CHECK (header_size_px BETWEEN 32 AND 240),
        footer_size_px INTEGER NOT NULL CHECK (footer_size_px BETWEEN 32 AND 240),
        left_size_px INTEGER NOT NULL CHECK (left_size_px BETWEEN 120 AND 360),
        right_size_px INTEGER NOT NULL CHECK (right_size_px BETWEEN 120 AND 360),
        center_sizes TEXT NOT NULL,
        font_family TEXT NOT NULL CHECK (
          font_family IN ('handlee', 'arial', 'georgia', 'trebuchet', 'verdana', 'courier')
        ),
        color_scheme TEXT NOT NULL CHECK (
          color_scheme IN ('paper', 'stone', 'sage', 'lavender', 'midnight', 'charcoal')
        )
      );

      INSERT INTO blocks (label, placement, position)
      VALUES
        ('Notes', 'center', 0),
        ('Highlights', 'center', 1),
        ('Gratitude', 'center', 2),
        ('Header', 'header', 0),
        ('Ideas', 'left', 0),
        ('Tasks', 'right', 0),
        ('Footer', 'footer', 0);

      INSERT INTO user_settings
        (id, center_orientation, header_size_px, footer_size_px,
         left_size_px, right_size_px, center_sizes, font_family, color_scheme)
      VALUES (1, 'vertical', 48, 36, 180, 180, '{}', 'handlee', 'paper');
    `);
    connection.pragma('user_version = 1');
  });
  initialize();
}

export function initializeDatabase() {
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true });
  const connection = new Database(path.join(directory, 'journal.sqlite'));
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  initializeSchema(connection);
  database = connection;
}

function db() {
  if (!database) throw new Error('Database has not been initialized');
  return database;
}

export function listEntries(): Entry[] {
  return db()
    .prepare(
      `SELECT id, block_id AS blockId, entry_date AS entryDate, content,
              created_at AS createdAt, updated_at AS updatedAt
       FROM entries ORDER BY entry_date DESC`,
    )
    .all() as Entry[];
}

export function listBlocks(): Block[] {
  return db()
    .prepare(
      `SELECT id, label, placement, position,
              font_size_px AS fontSizePx, reset_frequency AS resetFrequency
       FROM blocks WHERE is_active = 1 ORDER BY placement, position`,
    )
    .all() as Block[];
}

export function getLayoutSettings(): LayoutSettings {
  const row = db()
    .prepare(
      `SELECT center_orientation AS centerOrientation,
              header_size_px AS headerSizePx, footer_size_px AS footerSizePx,
              left_size_px AS leftSizePx, right_size_px AS rightSizePx,
              center_sizes AS centerSizesJson, font_family AS fontFamily,
              color_scheme AS colorScheme
       FROM user_settings WHERE id = 1`,
    )
    .get() as (Omit<LayoutSettings, 'centerSizes'> & { centerSizesJson: string }) | undefined;
  if (!row) throw new Error('User settings are missing');
  const { centerSizesJson, ...settings } = row;
  return {
    ...settings,
    centerSizes: JSON.parse(centerSizesJson) as Record<number, number>,
  };
}

export function setFontFamily(fontFamily: FontFamily) {
  const choices: FontFamily[] = [
    'handlee',
    'arial',
    'georgia',
    'trebuchet',
    'verdana',
    'courier',
  ];
  if (!choices.includes(fontFamily)) throw new TypeError('Invalid font family');
  db().prepare('UPDATE user_settings SET font_family = ? WHERE id = 1').run(fontFamily);
}

export function setColorScheme(colorScheme: ColorScheme) {
  const choices: ColorScheme[] = [
    'paper',
    'stone',
    'sage',
    'lavender',
    'midnight',
    'charcoal',
  ];
  if (!choices.includes(colorScheme)) throw new TypeError('Invalid color scheme');
  db().prepare('UPDATE user_settings SET color_scheme = ? WHERE id = 1').run(colorScheme);
}

export function addBlock(label: string, placement: BlockPlacement): Block {
  const cleanLabel = label.trim();
  if (!cleanLabel || cleanLabel.length > 40) {
    throw new RangeError('Panel title must be between 1 and 40 characters');
  }
  const placements: BlockPlacement[] = ['header', 'footer', 'left', 'right', 'center'];
  if (!placements.includes(placement)) throw new TypeError('Invalid panel placement');
  const connection = db();
  const position = connection
    .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS nextPosition FROM blocks WHERE placement = ?')
    .get(placement) as { nextPosition: number };
  const result = connection
    .prepare('INSERT INTO blocks (label, placement, position) VALUES (?, ?, ?)')
    .run(cleanLabel, placement, position.nextPosition);
  return connection
    .prepare(`SELECT id, label, placement, position,
                     font_size_px AS fontSizePx,
                     reset_frequency AS resetFrequency
              FROM blocks WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as Block;
}

export function updateBlockSettings(
  id: number,
  settings: { fontSizePx?: number; resetFrequency?: ResetFrequency },
  anchorDate = localDateString(new Date()),
): Block {
  if (!Number.isInteger(id)) throw new TypeError('Invalid panel id');
  if (anchorDate < localDateString(new Date())) {
    anchorDate = localDateString(new Date());
  }
  const connection = db();
  const block = connection
    .prepare(
      `SELECT id, reset_frequency AS resetFrequency,
              font_size_px AS fontSizePx
       FROM blocks WHERE id = ? AND is_active = 1`,
    )
    .get(id) as
    | { id: number; resetFrequency: ResetFrequency; fontSizePx: number }
    | undefined;
  if (!block) throw new Error('Panel is unavailable');

  const fontSizePx = settings.fontSizePx ?? block.fontSizePx;
  const resetFrequency = settings.resetFrequency ?? block.resetFrequency;
  if (!Number.isInteger(fontSizePx) || fontSizePx < 12 || fontSizePx > 36) {
    throw new RangeError('Font size must be between 12 and 36 pixels');
  }
  const frequencies: ResetFrequency[] = [
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'never',
  ];
  if (!frequencies.includes(resetFrequency)) {
    throw new TypeError('Invalid reset frequency');
  }

  const update = connection.transaction(() => {
    if (settings.resetFrequency && settings.resetFrequency !== block.resetFrequency) {
      const previousPeriod = periodKey(anchorDate, block.resetFrequency);
      const newPeriod = periodKey(anchorDate, resetFrequency);
      connection
        .prepare(
          `UPDATE entries SET entry_date = ?, updated_at = ?
           WHERE block_id = ? AND entry_date = ?`,
        )
        .run(newPeriod, new Date().toISOString(), id, previousPeriod);
    }
    connection
      .prepare(
        'UPDATE blocks SET font_size_px = ?, reset_frequency = ? WHERE id = ?',
      )
      .run(fontSizePx, resetFrequency, id);
  });
  update();
  return connection
    .prepare(`SELECT id, label, placement, position,
                     font_size_px AS fontSizePx,
                     reset_frequency AS resetFrequency
              FROM blocks WHERE id = ?`)
    .get(id) as Block;
}

export function removeBlock(id: number): boolean {
  if (!Number.isInteger(id)) throw new TypeError('Invalid panel id');
  return db()
    .prepare('UPDATE blocks SET is_active = 0 WHERE id = ? AND is_active = 1')
    .run(id).changes > 0;
}

export function moveBlock(id: number, placement: BlockPlacement, position: number) {
  if (!Number.isInteger(id) || !Number.isInteger(position) || position < 0) {
    throw new TypeError('Invalid panel position');
  }
  const placements: BlockPlacement[] = ['header', 'footer', 'left', 'right', 'center'];
  if (!placements.includes(placement)) throw new TypeError('Invalid panel placement');
  const connection = db();
  const move = connection.transaction(() => {
    const block = connection
      .prepare('SELECT placement FROM blocks WHERE id = ? AND is_active = 1')
      .get(id) as { placement: BlockPlacement } | undefined;
    if (!block) throw new Error('Panel is unavailable');
    const affected = [...new Set([block.placement, placement])];
    const activeIds = new Map<BlockPlacement, number[]>();
    const inactiveIds = new Map<BlockPlacement, number[]>();
    affected.forEach((itemPlacement) => {
      const rows = connection
        .prepare('SELECT id, is_active AS isActive FROM blocks WHERE placement = ? ORDER BY position')
        .all(itemPlacement) as { id: number; isActive: number }[];
      activeIds.set(
        itemPlacement,
        rows.filter((row) => row.isActive === 1 && row.id !== id).map((row) => row.id),
      );
      inactiveIds.set(
        itemPlacement,
        rows.filter((row) => row.isActive === 0).map((row) => row.id),
      );
    });
    const targetIds = activeIds.get(placement)!;
    targetIds.splice(Math.min(position, targetIds.length), 0, id);

    connection
      .prepare(
        `UPDATE blocks SET position = position + 1000000
         WHERE placement = ? OR placement = ?`,
      )
      .run(affected[0], affected[1] ?? affected[0]);
    connection
      .prepare('UPDATE blocks SET placement = ?, position = ? WHERE id = ?')
      .run(placement, 2000000 + id, id);

    affected.forEach((itemPlacement) => {
      const ids = [
        ...(activeIds.get(itemPlacement) ?? []),
        ...(inactiveIds.get(itemPlacement) ?? []),
      ];
      ids.forEach((itemId, index) => {
        connection
          .prepare('UPDATE blocks SET position = ? WHERE id = ?')
          .run(index, itemId);
      });
    });
  });
  move();
  return listBlocks();
}

export function updateCenterOrientation(
  orientation: LayoutSettings['centerOrientation'],
) {
  if (!['horizontal', 'vertical', 'grid'].includes(orientation)) {
    throw new Error('Invalid center orientation');
  }
  db()
    .prepare('UPDATE user_settings SET center_orientation = ? WHERE id = 1')
    .run(orientation);
}

export function updateLayoutSize(
  placement: BlockPlacement,
  sizeValue: number,
  blockId?: number,
) {
  if (!Number.isFinite(sizeValue)) throw new TypeError('Invalid layout size');
  const connection = db();
  if (placement === 'center') {
    if (!Number.isInteger(blockId)) throw new TypeError('Center block id is required');
    const block = connection
      .prepare("SELECT id FROM blocks WHERE id = ? AND placement = 'center'")
      .get(blockId);
    if (!block) throw new Error('Unknown center block');
    const settings = getLayoutSettings();
    const size = Math.max(0.25, Math.min(4, sizeValue));
    settings.centerSizes[blockId] = size;
    connection
      .prepare('UPDATE user_settings SET center_sizes = ? WHERE id = 1')
      .run(JSON.stringify(settings.centerSizes));
    return size;
  }

  const sizeField: Record<Exclude<BlockPlacement, 'center'>, string> = {
    header: 'header_size_px',
    footer: 'footer_size_px',
    left: 'left_size_px',
    right: 'right_size_px',
  };
  const bounds =
    placement === 'header' || placement === 'footer'
      ? { min: 32, max: 240 }
      : { min: 120, max: 360 };
  const size = Math.max(bounds.min, Math.min(bounds.max, sizeValue));
  connection
    .prepare(`UPDATE user_settings SET ${sizeField[placement]} = ? WHERE id = 1`)
    .run(size);
  return size;
}

export function listEntriesForDate(entryDate: string): Entry[] {
  const entryForBlock = db().prepare(
    `SELECT id, block_id AS blockId, entry_date AS entryDate, content,
            created_at AS createdAt, updated_at AS updatedAt
     FROM entries WHERE block_id = ? AND entry_date = ?
     ORDER BY updated_at DESC LIMIT 1`,
  );
  return listBlocks().flatMap((block) => {
    const entry = entryForBlock.get(
      block.id,
      periodKey(entryDate, block.resetFrequency),
    ) as Entry | undefined;
    return entry ? [entry] : [];
  });
}

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function periodKey(entryDate: string, frequency: ResetFrequency) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error('Entry date must use YYYY-MM-DD format');
  }
  const [year, month, day] = entryDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (localDateString(date) !== entryDate) throw new Error('Invalid entry date');
  if (frequency === 'never') return '0001-01-01';
  if (frequency === 'yearly') return `${entryDate.slice(0, 4)}-01-01`;
  if (frequency === 'monthly') return `${entryDate.slice(0, 7)}-01`;
  if (frequency === 'daily') return entryDate;
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateString(date);
}

export function getEntry(id: string): Entry | undefined {
  return db()
    .prepare(
      `SELECT id, block_id AS blockId, entry_date AS entryDate, content,
              created_at AS createdAt, updated_at AS updatedAt
       FROM entries WHERE id = ?`,
    )
    .get(id) as Entry | undefined;
}

export function saveEntry(input: SaveEntryInput): Entry {
  if (!input.entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    throw new Error('entryDate must use YYYY-MM-DD format');
  }
  const nowDate = new Date();
  const todayDate = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  if (input.entryDate < todayDate) {
    throw new Error('Past journal entries are read-only');
  }
  if (typeof input.content !== 'string') {
    throw new Error('content must be a string');
  }

  const connection = db();
  const now = new Date().toISOString();
  const block = connection
    .prepare(
      `SELECT id, reset_frequency AS resetFrequency
       FROM blocks WHERE id = ? AND is_active = 1`,
    )
    .get(input.blockId) as { id: number; resetFrequency: ResetFrequency } | undefined;
  if (!block) throw new Error('Unknown journal block');
  const storedEntryDate = periodKey(input.entryDate, block.resetFrequency);
  const existing = input.id
    ? (connection
        .prepare('SELECT id, created_at FROM entries WHERE id = ?')
        .get(input.id) as
        | { id: string; created_at: string }
        | undefined)
    : undefined;
  const id = existing?.id ?? input.id ?? randomUUID();

  connection
    .prepare(
      `INSERT INTO entries (id, block_id, entry_date, content, created_at, updated_at)
       VALUES (@id, @blockId, @entryDate, @content, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         block_id = excluded.block_id,
         entry_date = excluded.entry_date,
         content = excluded.content,
         updated_at = excluded.updated_at`,
    )
    .run({
      id,
      blockId: input.blockId,
      entryDate: storedEntryDate,
      content: input.content,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    });

  const entry = connection
    .prepare(
      `SELECT id, block_id AS blockId, entry_date AS entryDate, content,
              created_at AS createdAt, updated_at AS updatedAt
       FROM entries WHERE id = ?`,
    )
    .get(id) as Entry | undefined;
  if (!entry) throw new Error('Failed to save journal entry');
  return entry;
}

export function deleteEntry(id: string): boolean {
  return db().prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
}

export function closeDatabase() {
  database?.close();
  database = null;
}
