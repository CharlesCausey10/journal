export interface Entry {
  id: string;
  blockId: number;
  entryDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Block {
  id: number;
  label: string;
  placement: BlockPlacement;
  position: number;
  fontSizePx: number;
  resetFrequency: ResetFrequency;
  templateContent: string;
  previousEntryBlockId: number | null;
}

export type ResetFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export type BlockPlacement =
  | 'header'
  | 'footer'
  | 'left'
  | 'right'
  | 'center';

export type FontFamily =
  | 'handlee'
  | 'arial'
  | 'georgia'
  | 'trebuchet'
  | 'verdana'
  | 'courier';

export type ColorScheme =
  | 'paper'
  | 'stone'
  | 'sage'
  | 'lavender'
  | 'midnight'
  | 'charcoal';

export interface LayoutSettings {
  centerOrientation: 'horizontal' | 'vertical' | 'grid';
  headerSizePx: number;
  footerSizePx: number;
  leftSizePx: number;
  rightSizePx: number;
  centerSizes: Record<number, number>;
  fontFamily: FontFamily;
  colorScheme: ColorScheme;
  moveCheckedToBottom: boolean;
}

export interface SaveEntryInput {
  id?: string;
  blockId: number;
  entryDate: string;
  content: string;
}
