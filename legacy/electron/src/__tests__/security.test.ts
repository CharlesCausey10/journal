/** @jest-environment node */
import path from 'node:path';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { assertTrustedSender, isAllowedExternalUrl, isTrustedPage, rendererAssetPath } from '../main/security';

test('only the application main frame may invoke privileged handlers', () => {
  const mainFrame = { url: 'journal://app/index.html' };
  const contents = { mainFrame } as WebContents;
  const event = { sender: contents, senderFrame: mainFrame } as IpcMainInvokeEvent;
  expect(() => assertTrustedSender(event, contents, mainFrame.url)).not.toThrow();
  expect(() => assertTrustedSender({ ...event, senderFrame: { ...mainFrame } } as IpcMainInvokeEvent, contents, mainFrame.url)).toThrow('Untrusted');
  expect(() => assertTrustedSender(event, {} as WebContents, mainFrame.url)).toThrow('Untrusted');
  expect(() => assertTrustedSender(event, undefined, mainFrame.url)).toThrow('Untrusted');
  mainFrame.url = 'https://example.com/';
  expect(() => assertTrustedSender(event, contents, 'journal://app/index.html')).toThrow('Untrusted');
});

test('page validation allows routing hashes but not other documents or origins', () => {
  expect(isTrustedPage('journal://app/index.html#/today', 'journal://app/index.html')).toBe(true);
  expect(isTrustedPage('journal://app/other.html', 'journal://app/index.html')).toBe(false);
  expect(isTrustedPage('http://localhost:1212/index.html', 'http://localhost:1213/index.html')).toBe(false);
});

test.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'custom://open', 'invalid'])(
  'blocks unsafe external link %s',
  (url) => expect(isAllowedExternalUrl(url)).toBe(false),
);
test.each(['https://example.com', 'http://example.com', 'mailto:test@example.com'])(
  'allows external link %s',
  (url) => expect(isAllowedExternalUrl(url)).toBe(true),
);

test('asset protocol cannot escape renderer directory', () => {
  const root = path.resolve('renderer');
  expect(rendererAssetPath('journal://app/assets/app.js', root)).toBe(path.join(root, 'assets', 'app.js'));
  for (const url of ['journal://other/index.html', 'file:///secret', 'journal://app/..%2fsecret', 'journal://app/..%5csecret', 'journal://app/%zz']) {
    expect(rendererAssetPath(url, root)).toBeNull();
  }
});
