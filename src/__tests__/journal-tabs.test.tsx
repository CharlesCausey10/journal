import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../renderer/App';
import type { Block } from '../main/database';

jest.mock('../renderer/dailyQuotes', () => ({
  quoteForDate: jest.fn().mockResolvedValue({ text: 'Quote', author: 'Author' }),
}));
// Resolve the production lazy import to the real editor, not a display stub.
jest.mock('../renderer/MarkdownEditor.js', () =>
  jest.requireActual('../renderer/MarkdownEditor'), { virtual: true });

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 22, 12) });
  const blocks: Block[] = ['Daily', 'Long-Term Goals', 'Reading'].map((label, index) => ({
    id: index + 1, label, placement: 'left', position: index,
    fontSizePx: 18, resetFrequency: index === 0 ? 'daily' : 'never',
    templateContent: '', previousEntryBlockId: null,
  }));
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: jest.fn(() => ({ observe() {}, disconnect() {} })),
  });
  Object.defineProperty(window, 'electron', {
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
