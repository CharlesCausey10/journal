import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import type { Block, LayoutSettings } from '../shared/journal';
import App from '../renderer/App';
import { quoteForDate } from '../renderer/dailyQuotes';

jest.mock('../renderer/dailyQuotes', () => ({
  quoteForDate: jest.fn().mockResolvedValue({ text: 'Daily quote', author: 'Author' }),
}));

jest.mock('../renderer/MarkdownEditor.js', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });

const blocks: Block[] = [
  {
    id: 1,
    label: 'Morning notes',
    placement: 'header',
    position: 0,
    fontSizePx: 18,
    resetFrequency: 'daily',
    templateContent: '',
    previousEntryBlockId: null,
  },
];

const layoutSettings: LayoutSettings = {
  centerOrientation: 'vertical',
  headerSizePx: 48,
  footerSizePx: 36,
  leftSizePx: 180,
  rightSizePx: 180,
  centerSizes: {},
  fontFamily: 'handlee',
  colorScheme: 'paper',
  moveCheckedToBottom: false,
};

const resizeObserver = {
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
};

describe('Journal app', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date(2026, 9, 22, 23, 59, 59) });
    // JSDOM does not implement layout observation; this test only checks rendering.
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: jest.fn().mockImplementation(() => resizeObserver),
    });
    Object.defineProperty(window, 'journal', {
      configurable: true,
      value: {
        blocks: { list: jest.fn().mockResolvedValue(blocks) },
        entries: { listForDate: jest.fn().mockResolvedValue([]) },
        layout: { get: jest.fn().mockResolvedValue(layoutSettings) },
        settings: { setMoveCheckedToBottom: jest.fn().mockResolvedValue(undefined) },
      },
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('advances at local midnight and refreshes entries and the quote', async () => {
    const { unmount } = render(<App />);
    await screen.findByText('Morning notes');

    await act(async () => { jest.advanceTimersByTime(1000); });

    expect(screen.getByLabelText('Journal date')).toHaveValue('2026-10-23');
    expect(window.journal.entries.listForDate).toHaveBeenLastCalledWith('2026-10-23');
    expect(quoteForDate).toHaveBeenLastCalledWith('2026-10-23');
    expect(screen.getByLabelText('Next day')).toBeDisabled();
    unmount();
    jest.runAllTicks();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['focus', 'visibilitychange'])('catches up after sleep on %s', async (event) => {
    render(<App />);
    await screen.findByText('Morning notes');
    jest.setSystemTime(new Date(2026, 9, 25, 9));

    await act(async () => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });

    expect(screen.getByLabelText('Journal date')).toHaveValue('2026-10-25');
    expect(window.journal.entries.listForDate).toHaveBeenLastCalledWith('2026-10-25');
  });

  it('keeps a deliberately selected historical date while updating Today', async () => {
    render(<App />);
    await screen.findByText('Morning notes');
    fireEvent.click(screen.getByLabelText('Previous day'));

    await act(async () => { jest.advanceTimersByTime(1000); });

    expect(screen.getByLabelText('Journal date')).toHaveValue('2026-10-21');
    expect(screen.getByLabelText('Journal date')).toHaveAttribute('max', '2026-10-23');
    await act(async () => { fireEvent.click(screen.getByText('Today', { selector: 'button' })); });
    expect(screen.getByLabelText('Journal date')).toHaveValue('2026-10-23');
  });

  it('renders blocks loaded through the preload API', async () => {
    const { unmount } = render(<App />);

    expect(await screen.findByText('Morning notes')).toBeInTheDocument();
    expect(resizeObserver.observe).toHaveBeenCalledWith(document.querySelector('.journal-shell'));

    unmount();
    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
  });

  it('saves the checklist setting and keeps the previous value if saving fails', async () => {
    render(<App />);
    await screen.findByText('Morning notes');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const checkbox = screen.getByRole('checkbox', { name: 'Move checked items to the bottom of the checklist' });
    expect(checkbox).not.toBeChecked();
    await act(async () => { fireEvent.click(checkbox); });
    expect(window.journal.settings.setMoveCheckedToBottom).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
    jest.mocked(window.journal.settings.setMoveCheckedToBottom).mockRejectedValueOnce(new Error('Save failed'));
    await act(async () => { fireEvent.click(checkbox); });
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the checklist setting.');
  });
});
