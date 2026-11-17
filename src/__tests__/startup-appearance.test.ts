import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(__dirname, '../renderer/public/startup-theme.js'), 'utf8');

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.startupState;
  jest.restoreAllMocks();
});

test.each([
  ['sage', 'rgb(196, 216, 189)'],
  ['midnight', 'rgb(23, 29, 43)'],
])('applies cached %s before the app module loads', (theme, background) => {
  localStorage.setItem('journal-startup-appearance', JSON.stringify({ theme, background }));
  vm.runInNewContext(source, { document, localStorage });
  expect(document.documentElement.style.backgroundColor).toBe(background);
  expect(document.documentElement.dataset.startupState).toBe('loading');
});

test.each([null, '{broken', '{"theme":"unknown","background":"rgb(1, 2, 3)"}',
  '{"theme":"sage","background":"url(https://example.com/image)"}',
])('uses a neutral background for missing or invalid cache %s', (cache) => {
  if (cache !== null) localStorage.setItem('journal-startup-appearance', cache);
  vm.runInNewContext(source, { document, localStorage });
  expect(document.documentElement.style.backgroundColor).toBe('rgb(230, 231, 227)');
});

test('opens with a neutral background when browser storage is unavailable', () => {
  const unavailable = { getItem: () => { throw new Error('Storage unavailable'); } };
  expect(() => vm.runInNewContext(source, { document, localStorage: unavailable })).not.toThrow();
  expect(document.documentElement.style.backgroundColor).toBe('rgb(230, 231, 227)');
});
