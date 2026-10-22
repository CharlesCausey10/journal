/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { closeDatabase, deleteEntry, getEntry, initializeDatabase, saveEntry } from '../main/database';

jest.mock('electron', () => ({ app: { getPath: jest.fn(), getVersion: () => 'test' } }));
let directory: string;
let connection: Database.Database;
beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(2026, 9, 20, 12) });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-history-test-'));
  jest.mocked(app.getPath).mockReturnValue(directory);
  await initializeDatabase();
  connection = new Database(path.join(directory, 'journal.sqlite'));
});
afterEach(() => {
  connection.close();
  closeDatabase();
  jest.useRealTimers();
  fs.rmSync(directory, { recursive: true, force: true });
});
function seed(date: string) {
  connection.prepare('INSERT INTO entries VALUES (?, 1, ?, ?, ?, ?)').run('existing', date, 'original', 'created', 'updated');
}
test('cannot rewrite history by supplying today or another block', () => {
  seed('2026-10-19');
  expect(() => saveEntry({ id: 'existing', blockId: 1, entryDate: '2026-10-20', content: 'changed' })).toThrow();
  expect(() => saveEntry({ id: 'existing', blockId: 2, entryDate: '2026-10-20', content: 'changed' })).toThrow();
  expect(() => deleteEntry('existing')).toThrow('read-only');
  expect(getEntry('existing')?.content).toBe('original');
});
test.each([
  ['daily', '2026-10-20'],
  ['weekly', '2026-10-19'],
  ['monthly', '2026-10-01'],
  ['yearly', '2026-01-01'],
  ['never', '0001-01-01'],
])('current %s period remains editable and deletable', (frequency, current) => {
  connection.prepare('UPDATE blocks SET reset_frequency = ? WHERE id = 1').run(frequency);
  seed(current!);
  expect(saveEntry({ id: 'existing', blockId: 1, entryDate: '2026-10-20', content: 'changed' }).content).toBe('changed');
  expect(deleteEntry('existing')).toBe(true);
});
test.each([
  ['daily', '2026-10-19'],
  ['weekly', '2026-10-12'],
  ['monthly', '2026-09-01'],
  ['yearly', '2025-01-01'],
])('past %s period cannot be edited or deleted', (frequency, past) => {
  connection.prepare('UPDATE blocks SET reset_frequency = ? WHERE id = 1').run(frequency);
  seed(past);
  expect(() => deleteEntry('existing')).toThrow('read-only');
  expect(() => saveEntry({ id: 'existing', blockId: 1, entryDate: '2026-10-20', content: 'changed' })).toThrow();
});
test('linked blocks reject direct writes', () => {
  connection.exec('UPDATE blocks SET previous_entry_block_id = 2 WHERE id = 1');
  expect(() => saveEntry({ blockId: 1, entryDate: '2026-10-20', content: 'changed' })).toThrow('read-only');
});
test('changing reset frequency to never does not unlock older daily history', () => {
  seed('2026-10-19');
  connection.exec("UPDATE blocks SET reset_frequency = 'never' WHERE id = 1");
  expect(() => deleteEntry('existing')).toThrow('read-only');
});
