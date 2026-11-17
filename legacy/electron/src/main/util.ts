import { app } from 'electron';

export function resolveHtmlPath(htmlFileName: string) {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return new URL(htmlFileName, `${process.env.ELECTRON_RENDERER_URL}/`).href;
  }
  return new URL(htmlFileName, 'journal://app/').href;
}
