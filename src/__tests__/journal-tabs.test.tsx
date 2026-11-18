import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../renderer/App';
import { $getSelection, $isRangeSelection, getNearestEditorFromDOMNode } from 'lexical';
import type { RangeSelection } from 'lexical';
import type { Block, Entry } from '../shared/journal';

jest.mock('../renderer/dailyQuotes', () => ({
  quoteForDate: jest.fn().mockResolvedValue({ text: 'Quote', author: 'Author' }),
}));
// Resolve the production lazy import to the real editor, not a display stub.
jest.mock('../renderer/MarkdownEditor.js', () =>
  jest.requireActual('../renderer/MarkdownEditor'), { virtual: true });

// Load the real editor during suite setup rather than charging its cold module
// compilation to the first interaction test's deadline on a fresh CI runner.
jest.requireMock('../renderer/MarkdownEditor.js');

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 22, 12) });
  // Lexical scrolls the focused caret into view. JSDOM has no range geometry.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true, value: () => new DOMRect(),
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true, value: () => [],
  });
  const blocks: Block[] = ['Daily', 'Long-Term Goals', 'Reading'].map((label, index) => ({
    id: index + 1, label, placement: 'left', position: index,
    fontSizePx: 18, resetFrequency: index === 0 ? 'daily' : 'never',
    templateContent: '', previousEntryBlockId: null,
  }));
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: jest.fn(() => ({ observe() {}, disconnect() {} })),
  });
  Object.defineProperty(window, 'journal', {
    configurable: true,
    value: {
      blocks: { list: jest.fn().mockResolvedValue(blocks) },
      entries: {
        listForDate: jest.fn(async (date: string) => blocks.map((block) => ({
          id: `${block.id}-${date}`, blockId: block.id,
          entryDate: block.resetFrequency === 'never' ? '0001-01-01' : date,
          content: block.id === 1 ? `Daily entry for ${date}` : `${block.label} persistent content`,
          createdAt: date, updatedAt: date,
        }))),
        save: jest.fn(async (entry) => ({ ...entry, id: 'saved' })),
      },
      layout: { get: jest.fn().mockResolvedValue({
        centerOrientation: 'vertical', headerSizePx: 48, footerSizePx: 36,
        leftSizePx: 180, rightSizePx: 180, centerSizes: {},
        fontFamily: 'handlee', colorScheme: 'paper',
      }) },
    },
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

test('past tabs display their own content and refresh across dates', async () => {
  render(<App />);
  await screen.findByRole('tab', { name: 'Daily' });
  await act(async () => { fireEvent.click(screen.getByLabelText('Previous day')); });
  expect(screen.getByRole('textbox', { name: 'Daily' })).toHaveTextContent('Daily entry for 2026-10-21');

  for (const label of ['Long-Term Goals', 'Reading', 'Daily']) {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: label })); });
    expect(screen.getByRole('textbox', { name: label })).toHaveTextContent(
      label === 'Daily' ? 'Daily entry for 2026-10-21' : `${label} persistent content`,
    );
    expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('aria-readonly', 'true');
  }

  await act(async () => { fireEvent.click(screen.getByLabelText('Previous day')); });
  expect(screen.getByRole('textbox', { name: 'Daily' })).toHaveTextContent('Daily entry for 2026-10-20');
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Reading' })); });
  expect(screen.getByRole('textbox', { name: 'Reading' })).toHaveTextContent('Reading persistent content');
});

test('waits for entry queries and populated editors before signaling startup readiness', async () => {
  let finishEntries!: (entries: Entry[]) => void;
  jest.mocked(window.journal.entries.listForDate).mockReturnValueOnce(new Promise((resolve) => {
    finishEntries = resolve;
  }));
  const ready = jest.fn(() => screen.getByRole('textbox', { name: 'Daily' }).textContent);
  window.addEventListener('journal-ready', ready);
  try {
    render(<App />);
    expect(screen.queryByRole('tab', { name: 'Daily' })).not.toBeInTheDocument();
    expect(ready).not.toHaveBeenCalled();
    await act(async () => finishEntries([{
      id: 'saved', blockId: 1, entryDate: '2026-10-22',
      content: 'Saved journal text is ready', createdAt: 'created', updatedAt: 'updated',
    }]));
    await screen.findByRole('textbox', { name: 'Daily' });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.results[0].value).toContain('Saved journal text is ready');
  } finally {
    window.removeEventListener('journal-ready', ready);
  }
});

test('focuses the first editable center editor once, with the caret after saved text', async () => {
  const panels = await window.journal.blocks.list();
  jest.mocked(window.journal.blocks.list).mockResolvedValue(panels.map((panel, index) => ({
    ...panel, placement: index < 2 ? 'center' : 'right',
    previousEntryBlockId: index === 0 ? 3 : null,
  })));
  render(<App />);
  const editor = await screen.findByRole('textbox', { name: 'Long-Term Goals' });
  const otherEditor = screen.getByRole('textbox', { name: 'Reading' });
  expect(editor).toHaveTextContent('Long-Term Goals persistent content');
  await act(async () => { window.dispatchEvent(new Event('journal-visible')); });
  expect(editor).toHaveFocus();
  const lexicalEditor = getNearestEditorFromDOMNode(editor);
  expect(lexicalEditor).toBeDefined();
  lexicalEditor!.getEditorState().read(() => {
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    const range = selection as RangeSelection;
    expect(range.isCollapsed()).toBe(true);
    expect(range.anchor.getNode().getTextContent()).toBe('Long-Term Goals persistent content');
    expect(range.anchor.offset).toBe('Long-Term Goals persistent content'.length);
  });
  otherEditor.focus();
  await act(async () => { window.dispatchEvent(new Event('journal-visible')); });
  expect(otherEditor).toHaveFocus();
});
