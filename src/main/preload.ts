// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  Block,
  BlockPlacement,
  ColorScheme,
  Entry,
  FontFamily,
  LayoutSettings,
  ResetFrequency,
  SaveEntryInput,
} from './database';

export type Channels = 'ipc-example';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  entries: {
    list(): Promise<Entry[]> {
      return ipcRenderer.invoke('entries:list');
    },
    listForDate(entryDate: string): Promise<Entry[]> {
      return ipcRenderer.invoke('entries:list-for-date', entryDate);
    },
    get(id: string): Promise<Entry | undefined> {
      return ipcRenderer.invoke('entries:get', id);
    },
    save(input: SaveEntryInput): Promise<Entry> {
      return ipcRenderer.invoke('entries:save', input);
    },
    delete(id: string): Promise<boolean> {
      return ipcRenderer.invoke('entries:delete', id);
    },
  },
  blocks: {
    list(): Promise<Block[]> {
      return ipcRenderer.invoke('blocks:list');
    },
    add(label: string, placement: BlockPlacement): Promise<Block> {
      return ipcRenderer.invoke('blocks:add', { label, placement });
    },
    remove(id: number): Promise<boolean> {
      return ipcRenderer.invoke('blocks:remove', id);
    },
    move(
      id: number,
      placement: BlockPlacement,
      position: number,
    ): Promise<Block[]> {
      return ipcRenderer.invoke('blocks:move', { id, placement, position });
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
      return ipcRenderer.invoke('blocks:update-settings', {
        id,
        settings,
        anchorDate,
      });
    },
  },
  layout: {
    get(): Promise<LayoutSettings> {
      return ipcRenderer.invoke('layout:get');
    },
    setCenterOrientation(
      orientation: LayoutSettings['centerOrientation'],
    ): Promise<void> {
      return ipcRenderer.invoke('layout:set-center-orientation', orientation);
    },
    setSize(
      placement: BlockPlacement,
      sizeValue: number,
      blockId?: number,
    ): Promise<number> {
      return ipcRenderer.invoke('layout:set-size', {
        placement,
        sizeValue,
        blockId,
      });
    },
  },
  settings: {
    setFontFamily(fontFamily: FontFamily): Promise<void> {
      return ipcRenderer.invoke('settings:set-font-family', fontFamily);
    },
    setColorScheme(colorScheme: ColorScheme): Promise<void> {
      return ipcRenderer.invoke('settings:set-color-scheme', colorScheme);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
