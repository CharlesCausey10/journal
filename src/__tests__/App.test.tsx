import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { Block, LayoutSettings } from '../main/database';
import App from '../renderer/App';

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
};

const resizeObserver = {
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
};

describe('Journal app', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // JSDOM does not implement layout observation; this test only checks rendering.
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: jest.fn().mockImplementation(() => resizeObserver),
    });
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        blocks: { list: jest.fn().mockResolvedValue(blocks) },
        entries: { listForDate: jest.fn().mockResolvedValue([]) },
        layout: { get: jest.fn().mockResolvedValue(layoutSettings) },
      },
    });
  });

  it('renders blocks loaded through the preload API', async () => {
    const { unmount } = render(<App />);

    expect(await screen.findByText('Morning notes')).toBeInTheDocument();
    expect(resizeObserver.observe).toHaveBeenCalledWith(document.querySelector('.journal-shell'));

    unmount();
    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
  });
});
