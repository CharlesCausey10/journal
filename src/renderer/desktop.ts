import type {
  Block,
  BlockPlacement,
  ColorScheme,
  Entry,
  FontFamily,
  LayoutSettings,
  ResetFrequency,
  SaveEntryInput,
} from '../shared/journal';

declare global {
  interface Window {
    __TAURI__: {
      core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      };
      window: {
        getCurrentWindow(): {
          onCloseRequested(
            callback: (event: { preventDefault(): void }) => void,
          ): Promise<() => void>;
          destroy(): Promise<void>;
        };
      };
    };
    journal: typeof journal;
  }
}

// Dispatch requests in UI order, including rapid edits to the same entry.
let queue: Promise<unknown> = Promise.resolve();
const unsavedEntries = new Map<string, unknown>();
export async function flushJournal() {
  window.dispatchEvent(new Event('journal-flush'));
  await queue;
  for (const input of Array.from(unsavedEntries.values())) {
    await request('entries:save', input);
  }
}

function request<T>(action: string, input: unknown = null): Promise<T> {
  const result = queue.then(() =>
    window.__TAURI__.core.invoke<T>('journal_request', { action, input }),
  );
  const id =
    action === 'entries:save' ? (input as SaveEntryInput).id : undefined;
  queue = result.then(
    () => id && unsavedEntries.delete(id),
    () => {
      if (id) unsavedEntries.set(id, input);
    },
  );
  return result;
}

export const journal = {
  entries: {
    list(): Promise<Entry[]> {
      return request('entries:list');
    },
    listForDate(entryDate: string): Promise<Entry[]> {
      return request('entries:list-for-date', entryDate);
    },
    get(id: string): Promise<Entry | undefined> {
      return request('entries:get', id);
    },
    save(input: SaveEntryInput): Promise<Entry> {
      return request('entries:save', input);
    },
    delete(id: string): Promise<boolean> {
      return request('entries:delete', id);
    },
  },
  blocks: {
    list(): Promise<Block[]> {
      return request('blocks:list');
    },
    add(label: string, placement: BlockPlacement): Promise<Block> {
      return request('blocks:add', { label, placement });
    },
    remove(id: number): Promise<boolean> {
      return request('blocks:remove', id);
    },
    move(
      id: number,
      placement: BlockPlacement,
      position: number,
    ): Promise<Block[]> {
      return request('blocks:move', { id, placement, position });
    },
    updateSettings(
      id: number,
      settings: {
        label?: string;
        fontSizePx?: number;
        resetFrequency?: ResetFrequency;
        templateContent?: string;
        previousEntryBlockId?: number | null;
      },
      anchorDate: string,
    ): Promise<Block> {
      return request('blocks:update-settings', {
        id,
        settings,
        anchorDate,
      });
    },
  },
  layout: {
    get(): Promise<LayoutSettings> {
      return request('layout:get');
    },
    setCenterOrientation(
      orientation: LayoutSettings['centerOrientation'],
    ): Promise<void> {
      return request('layout:set-center-orientation', orientation);
    },
    setSize(
      placement: BlockPlacement,
      sizeValue: number,
      blockId?: number,
    ): Promise<number> {
      return request('layout:set-size', {
        placement,
        sizeValue,
        blockId,
      });
    },
  },
  settings: {
    setMoveCheckedToBottom(enabled: boolean): Promise<void> {
      return request('settings:set-move-checked-to-bottom', enabled);
    },
    setFontFamily(fontFamily: FontFamily): Promise<void> {
      return request('settings:set-font-family', fontFamily);
    },
    setColorScheme(colorScheme: ColorScheme): Promise<void> {
      return request('settings:set-color-scheme', colorScheme);
    },
  },
};
