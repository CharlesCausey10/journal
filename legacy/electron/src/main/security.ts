import type { IpcMainInvokeEvent, WebContents } from 'electron';
import path from 'node:path';

export function rendererAssetPath(value: string, root: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'journal:' || url.host !== 'app' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const filename = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return filename;
  } catch {
    return null;
  }
}

export function isTrustedPage(candidate: string, expected: string): boolean {
  try {
    const actual = new URL(candidate);
    const trusted = new URL(expected);
    actual.hash = '';
    trusted.hash = '';
    return actual.href === trusted.href;
  } catch {
    return false;
  }
}

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  contents: WebContents | undefined,
  expectedUrl: string,
) {
  if (
    !contents ||
    event.sender !== contents ||
    event.senderFrame !== contents.mainFrame ||
    !isTrustedPage(event.senderFrame.url, expectedUrl)
  ) {
    throw new Error('Untrusted IPC sender');
  }
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}
