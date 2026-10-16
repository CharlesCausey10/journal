/** @jest-environment node */
import { dialog, shell } from 'electron';
import initializeWithRecovery from '../main/database-recovery';
import { initializeDatabase } from '../main/database';
import { acknowledgeRecovery, restoreDatabase } from '../main/database-backups';

jest.mock('electron', () => ({
  app: { getPath: () => 'test-data' },
  dialog: {
    showMessageBox: jest.fn(),
    showOpenDialog: jest.fn(),
    showErrorBox: jest.fn(),
  },
  shell: { openPath: jest.fn() },
}));
jest.mock('node:fs', () => ({ mkdirSync: jest.fn() }));
jest.mock('electron-log', () => ({ error: jest.fn() }));
jest.mock('../main/database', () => ({
  initializeDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  initializeSchema: jest.fn(),
}));
jest.mock('../main/database-backups', () => ({
  acknowledgeRecovery: jest.fn(),
  backupDirectory: () => 'test-backups',
  restoreDatabase: jest.fn(),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(initializeDatabase)
    .mockRejectedValue(new Error('migration failed'));
});

test('quit leaves recovery pending and does not retry', async () => {
  jest
    .mocked(dialog.showMessageBox)
    .mockResolvedValue({ response: 0, checkboxChecked: false });
  await expect(initializeWithRecovery()).resolves.toBe(false);
  expect(initializeDatabase).toHaveBeenCalledTimes(1);
  expect(acknowledgeRecovery).not.toHaveBeenCalled();
});

test('opening backups does not automatically retry migration', async () => {
  jest
    .mocked(dialog.showMessageBox)
    .mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    .mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  jest.mocked(shell.openPath).mockResolvedValue('');
  await expect(initializeWithRecovery()).resolves.toBe(false);
  expect(shell.openPath).toHaveBeenCalledWith('test-backups');
  expect(initializeDatabase).toHaveBeenCalledTimes(1);
});

test('explicit retry acknowledges the failure before opening again', async () => {
  jest
    .mocked(initializeDatabase)
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValue(undefined);
  jest
    .mocked(dialog.showMessageBox)
    .mockResolvedValue({ response: 2, checkboxChecked: false });
  await expect(initializeWithRecovery()).resolves.toBe(true);
  expect(acknowledgeRecovery).toHaveBeenCalledWith('test-data');
  expect(initializeDatabase).toHaveBeenCalledTimes(2);
});

test('canceling backup selection keeps the journal closed', async () => {
  jest
    .mocked(dialog.showMessageBox)
    .mockResolvedValueOnce({ response: 3, checkboxChecked: false })
    .mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  jest
    .mocked(dialog.showOpenDialog)
    .mockResolvedValue({ canceled: true, filePaths: [] });
  await expect(initializeWithRecovery()).resolves.toBe(false);
  expect(restoreDatabase).not.toHaveBeenCalled();
  expect(initializeDatabase).toHaveBeenCalledTimes(1);
});

test('confirmed restore finishes before reopening the journal', async () => {
  jest
    .mocked(initializeDatabase)
    .mockRejectedValueOnce(new Error('broken'))
    .mockResolvedValue(undefined);
  jest
    .mocked(dialog.showMessageBox)
    .mockResolvedValueOnce({ response: 3, checkboxChecked: false })
    .mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  jest
    .mocked(dialog.showOpenDialog)
    .mockResolvedValue({ canceled: false, filePaths: ['before.sqlite'] });
  await expect(initializeWithRecovery()).resolves.toBe(true);
  expect(restoreDatabase).toHaveBeenCalledWith(
    'test-data',
    'before.sqlite',
    expect.any(Function),
  );
  expect(initializeDatabase).toHaveBeenCalledTimes(2);
});
