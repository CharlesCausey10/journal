import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import log from 'electron-log';
import {
  acknowledgeRecovery,
  backupDirectory,
  restoreDatabase,
} from './database-backups';
import {
  closeDatabase,
  initializeDatabase,
  initializeSchema,
} from './database';

export default async function initializeWithRecovery() {
  const directory = app.getPath('userData');
  for (;;) {
    try {
      await initializeDatabase();
      return true;
    } catch (error) {
      closeDatabase();
      log.error('Journal database startup failed', error);
      let retry = false;
      while (!retry) {
        const { response } = await dialog.showMessageBox({
          type: 'error',
          title: 'Journal needs recovery',
          message: 'Your journal could not be opened safely.',
          detail: `${error instanceof Error ? error.message : String(error)}\n\nJournal will not erase or reset your entries. You can retry, inspect backups, or restore a backup. Restoring replaces the active journal; a copy of the current files will be kept for recovery.`,
          buttons: ['Quit', 'Open backup folder', 'Retry', 'Restore backup…'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response === 0) return false;
        try {
          if (response === 1) {
            fs.mkdirSync(backupDirectory(directory), { recursive: true });
            const failure = await shell.openPath(backupDirectory(directory));
            if (failure) throw new Error(failure, { cause: error });
          } else if (response === 2) {
            acknowledgeRecovery(directory);
            retry = true;
          } else if (response === 3) {
            const selected = await dialog.showOpenDialog({
              title: 'Select a Journal database backup',
              defaultPath: backupDirectory(directory),
              properties: ['openFile'],
              filters: [{ name: 'Journal database', extensions: ['sqlite'] }],
            });
            if (!selected.canceled && selected.filePaths[0]) {
              const confirmation = await dialog.showMessageBox({
                type: 'warning',
                title: 'Restore journal backup?',
                message: 'Replace your active journal with this backup?',
                detail: `${selected.filePaths[0]}\n\nEntries written after this backup will not appear in the restored journal. Current database files will be preserved in the recovery folder.`,
                buttons: ['Cancel', 'Restore'],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              if (confirmation.response === 1) {
                await restoreDatabase(
                  directory,
                  selected.filePaths[0],
                  initializeSchema,
                );
                retry = true;
              }
            }
          }
        } catch (recoveryError) {
          log.error('Journal recovery failed', recoveryError);
          dialog.showErrorBox(
            'Recovery could not finish',
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError),
          );
        }
      }
    }
  }
}
