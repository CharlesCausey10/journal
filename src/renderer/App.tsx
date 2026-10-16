import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ComponentType,
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent,
  ReactNode,
} from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import '@fontsource/handlee/latin-400.css';
import type {
  Block,
  BlockPlacement,
  ColorScheme,
  Entry,
  FontFamily,
  LayoutSettings,
  ResetFrequency,
} from '../main/database';
import { quoteForDate } from './dailyQuotes';
import type { DailyQuote } from './dailyQuotes';
import './App.css';
import {
  CENTER_MIN_HEIGHT_PX,
  CENTER_MIN_WIDTH_PX,
  PANEL_GAP_PX,
  defaultPanelSizes,
  fitPanelPair,
  layoutSizeLimits,
} from '../shared/layout';

const loadMarkdownEditor = () => import('./MarkdownEditor.js');
const MarkdownEditor = lazy(() =>
  loadMarkdownEditor().then((module) => ({
    default: module.default as unknown as ComponentType<
      import('./MarkdownEditor.js').MarkdownEditorProps
    >,
  })),
);

const tabPlacements = ['header', 'left', 'right', 'footer'] as const;
type TabPlacement = (typeof tabPlacements)[number];
type SettingsTab = 'appearance';

const fontOptions: { value: FontFamily; label: string }[] = [
  { value: 'handlee', label: 'Handlee' },
  { value: 'arial', label: 'Arial' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'trebuchet', label: 'Trebuchet MS' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'courier', label: 'Courier New' },
];

const colorSchemeOptions: { value: ColorScheme; label: string }[] = [
  { value: 'paper', label: 'Soft paper' },
  { value: 'stone', label: 'Cool stone' },
  { value: 'sage', label: 'Quiet sage' },
  { value: 'lavender', label: 'Pale lavender' },
  { value: 'midnight', label: 'Midnight blue' },
  { value: 'charcoal', label: 'Moss charcoal' },
];

const fontStacks: Record<FontFamily, string> = {
  handlee: "'Handlee', cursive",
  arial: 'Arial, sans-serif',
  georgia: 'Georgia, serif',
  trebuchet: "'Trebuchet MS', sans-serif",
  verdana: 'Verdana, sans-serif',
  courier: "'Courier New', monospace",
};

const sectionTitles: Record<BlockPlacement, string> = {
  center: 'Center',
  header: 'Header',
  footer: 'Footer',
  left: 'Left sidebar',
  right: 'Right sidebar',
};

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

interface BlockEditorProps {
  block: Block;
  entry?: Entry;
  entryDate: string;
  readOnly: boolean;
  onSaved: (entry: Entry, requestedDate: string) => void;
}

function BlockEditor({ block, entry, entryDate, readOnly, onSaved }: BlockEditorProps) {
  const [content, setContent] = useState(
    entry?.content ?? (block.previousEntryBlockId === null ? block.templateContent : ''),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const entryId = useRef(entry?.id);
  const skipInitialSave = useRef(true);
  const mounted = useRef(true);
  const pendingContent = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const saveContent = useCallback((contentToSave: string) => {
    if (
      !entryId.current &&
      !contentToSave.trim() &&
      !block.templateContent.trim()
    ) return;

    if (mounted.current) {
      setSaving(true);
      setSaveError(false);
    }
    void window.electron.entries
      .save({
        ...(entryId.current ? { id: entryId.current } : {}),
        blockId: block.id,
        entryDate,
        content: contentToSave,
      })
      .then((savedEntry) => {
        entryId.current = savedEntry.id;
        onSaved(savedEntry, entryDate);
        return savedEntry;
      })
      .catch(() => {
        if (mounted.current) setSaveError(true);
      })
      .finally(() => {
        if (mounted.current) setSaving(false);
      });
  }, [block.id, block.templateContent, entryDate, onSaved]);
  const saveContentRef = useRef(saveContent);
  useEffect(() => {
    saveContentRef.current = saveContent;
  }, [saveContent]);

  useEffect(() => {
    if (readOnly) return undefined;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return undefined;
    }
    if (!entryId.current && !content.trim() && !block.templateContent.trim()) {
      pendingContent.current = null;
      return undefined;
    }

    pendingContent.current = content;
    const timeout = window.setTimeout(() => {
      saveTimer.current = null;
      pendingContent.current = null;
      saveContentRef.current(content);
    }, 600);
    saveTimer.current = timeout;

    return () => {
      window.clearTimeout(timeout);
      if (saveTimer.current === timeout) saveTimer.current = null;
    };
  }, [block.id, block.templateContent, content, entryDate, readOnly]);

  useEffect(() => () => {
    mounted.current = false;
    if (pendingContent.current !== null) {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const contentToSave = pendingContent.current;
      pendingContent.current = null;
      saveContentRef.current(contentToSave);
    }
  }, []);

  return (
    <div className={`block-field placement-${block.placement}`}>
      {block.placement === 'center' && (
        <span className="block-label">
          {block.label}
          <span className="save-status" aria-live="polite">
            {saveError ? ' — Could not save' : saving ? ' — Saving…' : ''}
          </span>
        </span>
      )}
      <Suspense fallback={null}>
        <MarkdownEditor
          value={content}
          label={block.label}
          fontSizePx={block.fontSizePx}
          readOnly={readOnly}
          onChange={readOnly ? undefined : setContent}
        />
      </Suspense>
    </div>
  );
}

function PastNote({
  block,
  content,
  showTitle = true,
}: {
  block: Block;
  content: string;
  showTitle?: boolean;
}) {
  return (
    <article className={`past-note placement-${block.placement}`}>
      {showTitle && <h2>{block.label}</h2>}
      <div className="past-note-content" style={{ fontSize: `${block.fontSizePx}px` }}>
        <Suspense fallback={null}>
          <MarkdownEditor
            value={content}
            label={block.label}
            fontSizePx={block.fontSizePx}
            readOnly
          />
        </Suspense>
      </div>
    </article>
  );
}

function TemplatePane({
  block,
  linkedSourceLabel,
  onSave,
  onDragStart,
  onOpenSettings,
}: {
  block: Block;
  linkedSourceLabel?: string;
  onSave: (content: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLSpanElement>) => void;
  onOpenSettings: (blockId: number) => void;
}) {
  const [content, setContent] = useState(block.templateContent);
  const timer = useRef<number | null>(null);
  const contentRef = useRef(content);
  const saveRef = useRef(onSave);
  useEffect(() => {
    contentRef.current = content;
    saveRef.current = onSave;
  }, [content, onSave]);
  useEffect(() => () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      saveRef.current(contentRef.current);
    }
  }, []);
  const changeContent = (value: string) => {
    contentRef.current = value;
    setContent(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onSave(value);
    }, 500);
  };
  return (
    <div className="block-field layout-template-pane">
      <div className="layout-template-heading">
        <span className="layout-template-grip" draggable onDragStart={onDragStart} title="Drag to move or reorder">⠿ {block.label}</span>
        <button type="button" className="block-settings-button" aria-label={`Settings for ${block.label}`} title={`Settings for ${block.label}`} onClick={() => onOpenSettings(block.id)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.2 2.5h3.6l.45 1.8a6 6 0 0 1 1.25.72l1.78-.55 1.8 3.12-1.34 1.25a6 6 0 0 1 0 1.44l1.34 1.25-1.8 3.12-1.78-.55a6 6 0 0 1-1.25.72l-.45 1.8H8.2l-.45-1.8a6 6 0 0 1-1.25-.72l-1.78.55-1.8-3.12 1.34-1.25a6 6 0 0 1 0-1.44L2.92 7.6l1.8-3.12 1.78.55a6 6 0 0 1 1.25-.72L8.2 2.5Z"/><circle cx="10" cy="9.55" r="2.25"/></svg>
        </button>
      </div>
      <div className="layout-template-editor">
        {block.previousEntryBlockId !== null ? (
          <div className="linked-block-notice">
            Shows the most recent earlier entry from “{linkedSourceLabel ?? 'another block'}”. This block is read-only.
          </div>
        ) : (
          <Suspense fallback={null}>
            <MarkdownEditor
              value={content}
              label={`${block.label} template`}
              fontSizePx={block.fontSizePx}
              readOnly={false}
              placeholder="Default content..."
              onChange={changeContent}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function LayoutSectionHeader({
  title,
  isOpen,
  onToggle,
  onAdd,
  extra,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  onAdd: (label: string) => void;
  extra?: ReactNode;
}) {
  const [label, setLabel] = useState('');
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const positionPopover = () => {
      const button = addButtonRef.current;
      const popover = popoverRef.current;
      if (!button || !popover) return;

      const buttonRect = button.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const edgePadding = 8;
      const left = Math.max(
        edgePadding,
        Math.min(buttonRect.right - popoverRect.width, window.innerWidth - popoverRect.width - edgePadding),
      );
      const belowTop = buttonRect.bottom + 4;
      const top = Math.max(
        edgePadding,
        Math.min(
          belowTop + popoverRect.height > window.innerHeight - edgePadding
            ? buttonRect.top - popoverRect.height - 4
            : belowTop,
          window.innerHeight - popoverRect.height - edgePadding,
        ),
      );

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.visibility = 'visible';
    };

    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
    };
  }, [isOpen]);

  return (
    <div className="layout-section-heading">
      <strong>{title}</strong>
      {extra}
      <button ref={addButtonRef} type="button" className="layout-add-toggle" aria-label={`Add block to ${title}`} aria-expanded={isOpen} onClick={onToggle}>
        <span aria-hidden="true">+</span>
        Add Block
      </button>
      {isOpen && (
        <form ref={popoverRef} className="layout-add-popover" onSubmit={(event) => { event.preventDefault(); const cleanLabel = label.trim(); if (!cleanLabel) return; onAdd(cleanLabel); setLabel(''); }}>
          <label>
            Section title
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} placeholder="e.g. Ideas" required />
          </label>
          <div className="layout-add-actions">
            <button type="button" onClick={onToggle}>Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      )}
    </div>
  );
}

interface ResizeHandleProps {
  axis: 'x' | 'y';
  className: string;
  onResize: (delta: number, handle: HTMLButtonElement) => void;
}

function ResizeHandle({ axis, className, onResize }: ResizeHandleProps) {
  const lastCoordinate = useRef<number | null>(null);
  const coordinate = (event: PointerEvent<HTMLButtonElement>) =>
    axis === 'x' ? event.clientX : event.clientY;

  return (
    <button
      type="button"
      className={`resize-handle ${className}`}
      aria-label="Resize panel"
      onPointerDown={(event) => {
        lastCoordinate.current = coordinate(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastCoordinate.current === null) return;
        const current = coordinate(event);
        onResize(current - lastCoordinate.current, event.currentTarget);
        lastCoordinate.current = current;
      }}
      onPointerUp={() => {
        lastCoordinate.current = null;
      }}
      onPointerCancel={() => {
        lastCoordinate.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          onResize(-8, event.currentTarget);
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          onResize(8, event.currentTarget);
        }
      }}
    />
  );
}

function Home() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [entriesByBlock, setEntriesByBlock] = useState<Map<number, Entry>>(
    () => new Map(),
  );
  const [entriesRevision, setEntriesRevision] = useState(0);
  const [settings, setSettings] = useState<LayoutSettings>({
    centerOrientation: 'vertical',
    ...defaultPanelSizes,
    centerSizes: {},
    fontFamily: 'handlee',
    colorScheme: 'paper',
  });
  const [activeBlocks, setActiveBlocks] = useState<
    Record<TabPlacement, number | null>
  >({ header: null, left: null, right: null, footer: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [layoutError, setLayoutError] = useState(false);
  const [activeDialog, setActiveDialog] = useState<SettingsTab | null>(null);
  const [selectedPanelSettingsId, setSelectedPanelSettingsId] = useState<number | null>(null);
  const [pendingPanelRemoval, setPendingPanelRemoval] = useState<Block | null>(null);
  const [panelSettingsLabel, setPanelSettingsLabel] = useState('');
  const [editingLayout, setEditingLayout] = useState(false);
  const [addMenuPlacement, setAddMenuPlacement] = useState<BlockPlacement | null>(null);
  const [panelError, setPanelError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const sizeSaveTimers = useRef(new Map<string, number>());
  const [entryDate, setEntryDate] = useState(today());
  const [dailyQuote, setDailyQuote] = useState<DailyQuote | null>(null);
  const [layoutViewport, setLayoutViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const entryDateRef = useRef(entryDate);
  useEffect(() => {
    entryDateRef.current = entryDate;
  }, [entryDate]);
  const todayDate = today();
  const isReadOnlyDate = entryDate < todayDate;

  const handleEntrySaved = (savedEntry: Entry, requestedDate: string) => {
    if (entryDateRef.current !== requestedDate) return;
    setEntriesByBlock((previous) => {
      const existingEntry = previous.get(savedEntry.blockId);
      if (existingEntry && existingEntry.updatedAt > savedEntry.updatedAt) {
        return previous;
      }
      return new Map(previous).set(savedEntry.blockId, savedEntry);
    });
  };

  useEffect(() => {
    let isCurrent = true;

    void quoteForDate(today()).then((quote) => {
      if (isCurrent) setDailyQuote(quote);
      return quote;
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  const changeDateByDays = (days: number) => {
    const nextDate = new Date(`${entryDate}T00:00:00`);
    nextDate.setDate(nextDate.getDate() + days);
    const nextDateString = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    if (nextDateString <= todayDate) setEntryDate(nextDateString);
  };

  useEffect(
    () => () => {
      sizeSaveTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    let isCurrent = true;

    async function loadLayout() {
      try {
        const [savedBlocks, savedEntries, savedSettings] = await Promise.all([
          window.electron.blocks.list(),
          window.electron.entries.listForDate(entryDate),
          window.electron.layout.get(),
          loadMarkdownEditor(),
        ]);
        if (!isCurrent) return;

        const entries = new Map<number, Entry>();
        savedEntries.forEach((entry) => entries.set(entry.blockId, entry));
        const active: Record<TabPlacement, number | null> = {
          header: null,
          left: null,
          right: null,
          footer: null,
        };
        tabPlacements.forEach((placement) => {
          active[placement] =
            savedBlocks.find((block) => block.placement === placement)?.id ??
            null;
        });

        setBlocks(savedBlocks);
        setEntriesByBlock(entries);
        setEntriesRevision((revision) => revision + 1);
        setSettings(savedSettings);
        setActiveBlocks(active);
      } catch {
        if (isCurrent) setLoadError(true);
      } finally {
        if (isCurrent) setLoading(false);
      }
    }

    void loadLayout();
    return () => {
      isCurrent = false;
    };
  }, [entryDate]);

  const groupedBlocks = (placement: BlockPlacement) =>
    blocks
      .filter((block) => block.placement === placement)
      .sort((a, b) => a.position - b.position);

  const blocksForDate = (placement: BlockPlacement) =>
    groupedBlocks(placement).filter((block) => {
      if (editingLayout) return true;
      if (isReadOnlyDate || block.previousEntryBlockId !== null) {
        return Boolean(entriesByBlock.get(block.id)?.content.trim());
      }
      return true;
    });

  const visibleRegions = {
    left: editingLayout || blocksForDate('left').length > 0,
    right: editingLayout || blocksForDate('right').length > 0,
    header: editingLayout || blocksForDate('header').length > 0,
    footer: editingLayout || blocksForDate('footer').length > 0,
  };

  useLayoutEffect(() => {
    if (loading) return undefined;
    const shell = document.querySelector('.journal-shell');
    if (!shell) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setLayoutViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [loading]);

  const [leftSizePx, rightSizePx] = fitPanelPair(
    settings.leftSizePx, settings.rightSizePx, layoutViewport.width,
    layoutSizeLimits.left.min, layoutSizeLimits.right.min, CENTER_MIN_WIDTH_PX,
    visibleRegions.left, visibleRegions.right,
  );
  const [headerSizePx, footerSizePx] = fitPanelPair(
    settings.headerSizePx, settings.footerSizePx, layoutViewport.height,
    layoutSizeLimits.header.min, layoutSizeLimits.footer.min, CENTER_MIN_HEIGHT_PX,
    visibleRegions.header, visibleRegions.footer,
  );
  const visiblePanelSizes = { headerSizePx, footerSizePx, leftSizePx, rightSizePx };

  const sizeFor = (placement: BlockPlacement, blockId?: number) => {
    if (placement === 'center') return settings.centerSizes[blockId!] ?? 1;
    const key = `${placement}SizePx` as
      | 'headerSizePx'
      | 'footerSizePx'
      | 'leftSizePx'
      | 'rightSizePx';
    return visiblePanelSizes[key];
  };

  const setLayoutSize = (
    placement: BlockPlacement,
    value: number,
    blockId?: number,
  ) => {
    const { min } = layoutSizeLimits[placement];
    let { max } = layoutSizeLimits[placement];
    if (placement !== 'center') {
      const vertical = placement === 'header' || placement === 'footer';
      const opposite = { header: 'footer', footer: 'header', left: 'right', right: 'left' } as const;
      const available = vertical ? layoutViewport.height : layoutViewport.width;
      const centerMin = vertical ? CENTER_MIN_HEIGHT_PX : CENTER_MIN_WIDTH_PX;
      const gaps = vertical
        ? Number(visibleRegions.header) + Number(visibleRegions.footer)
        : Number(visibleRegions.left) + Number(visibleRegions.right);
      max = Math.max(min, Math.min(max, available - sizeFor(opposite[placement]) - centerMin - PANEL_GAP_PX * gaps));
    }
    const sizeValue = Math.max(min, Math.min(max, value));
    if (sizeValue === sizeFor(placement, blockId)) return;

    setSettings((previous) => {
      if (placement === 'center') {
        return {
          ...previous,
          centerSizes: { ...previous.centerSizes, [blockId!]: sizeValue },
        };
      }
      const key = `${placement}SizePx` as
        | 'headerSizePx'
        | 'footerSizePx'
        | 'leftSizePx'
        | 'rightSizePx';
      return { ...previous, [key]: sizeValue };
    });

    const timerKey = `${placement}:${blockId ?? ''}`;
    const previousTimer = sizeSaveTimers.current.get(timerKey);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      void window.electron.layout
        .setSize(placement, sizeValue, blockId)
        .catch(() => setLayoutError(true));
      sizeSaveTimers.current.delete(timerKey);
    }, 250);
    sizeSaveTimers.current.set(timerKey, timer);
  };

  const updateSize = (placement: BlockPlacement, delta: number, blockId?: number) => {
    setLayoutSize(placement, sizeFor(placement, blockId) + delta, blockId);
  };

  const updateCenterPair = (first: Block, second: Block, delta: number, handle: HTMLButtonElement) => {
    const firstPane = handle.parentElement;
    const secondPane = firstPane?.nextElementSibling;
    if (!firstPane || !secondPane) return;
    const firstBounds = firstPane.getBoundingClientRect();
    const secondBounds = secondPane.getBoundingClientRect();
    const pairPixels = settings.centerOrientation === 'horizontal'
      ? firstBounds.width + secondBounds.width
      : firstBounds.height + secondBounds.height;
    if (pairPixels <= 0) return;
    const firstSize = sizeFor('center', first.id);
    const secondSize = sizeFor('center', second.id);
    const pairSize = firstSize + secondSize;
    const minWeight = Math.max(layoutSizeLimits.center.min, pairSize * Math.min(48, pairPixels / 2) / pairPixels);
    const lower = Math.max(minWeight, pairSize - layoutSizeLimits.center.max);
    const upper = Math.min(layoutSizeLimits.center.max, pairSize - minWeight);
    const nextFirst = Math.max(lower, Math.min(upper, firstSize + delta * pairSize / pairPixels));
    const nextSecond = pairSize - nextFirst;
    setLayoutSize('center', nextFirst, first.id);
    setLayoutSize('center', nextSecond, second.id);
  };

  const changeOrientation = (centerOrientation: 'horizontal' | 'vertical' | 'grid') => {
    setSettings((previous) => ({ ...previous, centerOrientation }));
    setLayoutError(false);
    void window.electron.layout
      .setCenterOrientation(centerOrientation)
      .catch(() => setLayoutError(true));
  };

  const setSelectedBlock = (placement: TabPlacement, id: number) => {
    setActiveBlocks((previous) => ({ ...previous, [placement]: id }));
  };

  const addPanel = async (label: string, placement: BlockPlacement) => {
    try {
      setPanelError('');
      const block = await window.electron.blocks.add(label, placement);
      setBlocks((previous) => [...previous, block]);
      if (block.placement !== 'center') {
        setActiveBlocks((previous) => ({
          ...previous,
          [block.placement]: block.id,
        }));
      }
      setAddMenuPlacement(null);
    } catch {
      setPanelError('Could not add this panel. Use a title up to 40 characters.');
    }
  };

  const toggleAddMenu = (placement: BlockPlacement) => {
    setPanelError('');
    setAddMenuPlacement((current) => current === placement ? null : placement);
  };

  const removePanel = async (block: Block) => {
    try {
      setPanelError('');
      const removed = await window.electron.blocks.remove(block.id);
      if (!removed) throw new Error('Panel was not found');
      setBlocks((previous) => previous.filter((item) => item.id !== block.id));
      if (selectedPanelSettingsId === block.id) setSelectedPanelSettingsId(null);
      if (block.placement !== 'center' && activeBlocks[block.placement] === block.id) {
        const replacement = blocks.find(
          (item) => item.placement === block.placement && item.id !== block.id,
        );
        setActiveBlocks((previous) => ({
          ...previous,
          [block.placement]: replacement?.id ?? null,
        }));
      }
    } catch {
      setPanelError('Could not remove this panel.');
    }
  };

  const confirmPanelRemoval = async () => {
    if (!pendingPanelRemoval) return;
    const block = pendingPanelRemoval;
    setPendingPanelRemoval(null);
    await removePanel(block);
  };

  const openPanelSettings = (block: Block) => {
    setPanelSettingsLabel(block.label);
    setSelectedPanelSettingsId(block.id);
  };

  const updatePanelSettings = async (
    blockId: number,
    update: {
      fontSizePx?: number;
      resetFrequency?: ResetFrequency;
      templateContent?: string;
      label?: string;
      previousEntryBlockId?: number | null;
    },
  ) => {
    try {
      setPanelError('');
      const updatedBlock = await window.electron.blocks.updateSettings(
        blockId,
        update,
        entryDate < today() ? today() : entryDate,
      );
      setBlocks((previous) =>
        previous.map((block) =>
          block.id === blockId ? updatedBlock : block,
        ),
      );
      if (
        update.resetFrequency ||
        update.previousEntryBlockId !== undefined ||
        update.templateContent !== undefined
      ) {
        const entries = await window.electron.entries.listForDate(entryDate);
        setEntriesByBlock(
          new Map(entries.map((entry) => [entry.blockId, entry])),
        );
        setEntriesRevision((revision) => revision + 1);
      }
    } catch {
      setPanelError('Could not save this panel setting.');
    }
  };

  const changeFontFamily = async (fontFamily: FontFamily) => {
    setSettingsError('');
    setSettings((previous) => ({ ...previous, fontFamily }));
    try {
      await window.electron.settings.setFontFamily(fontFamily);
    } catch {
      setSettingsError('Could not save the font setting.');
    }
  };

  const changeColorScheme = async (colorScheme: ColorScheme) => {
    setSettingsError('');
    setSettings((previous) => ({ ...previous, colorScheme }));
    try {
      await window.electron.settings.setColorScheme(colorScheme);
    } catch {
      setSettingsError('Could not save the color scheme.');
    }
  };

  useEffect(() => {
    const page = document.querySelector('.journal-page');
    if (page) {
      document.body.style.backgroundColor = getComputedStyle(page)
        .getPropertyValue('--theme-page').trim();
    }
  }, [settings.colorScheme, loading]);

  const movePanel = async (
    blockId: number,
    placement: BlockPlacement,
    position: number,
  ) => {
    try {
      setPanelError('');
      const updatedBlocks = await window.electron.blocks.move(
        blockId,
        placement,
        position,
      );
      setBlocks(updatedBlocks);
      setActiveBlocks((previous) => {
        const next = { ...previous };
        tabPlacements.forEach((tabPlacement) => {
          if (tabPlacement === placement) {
            next[tabPlacement] = blockId;
          } else if (
            next[tabPlacement] !== null &&
            !updatedBlocks.some(
              (block) =>
                block.id === next[tabPlacement] &&
                block.placement === tabPlacement,
            )
          ) {
            next[tabPlacement] =
              updatedBlocks.find((block) => block.placement === tabPlacement)
                ?.id ?? null;
          }
        });
        return next;
      });
    } catch {
      setPanelError('Could not move this panel.');
    }
  };

  const dropPanel = (
    event: ReactDragEvent<HTMLElement>,
    placement: BlockPlacement,
    position: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const blockId = Number(event.dataTransfer.getData('text/plain'));
    if (Number.isInteger(blockId) && blockId > 0) {
      void movePanel(blockId, placement, position);
    }
  };

  const cssVariables = {
    '--header-size': `${headerSizePx}px`,
    '--footer-size': `${footerSizePx}px`,
    '--left-size': `${leftSizePx}px`,
    '--right-size': `${rightSizePx}px`,
    gridTemplateColumns: [
      ...(visibleRegions.left ? ['var(--left-size)'] : []),
      'minmax(0, 1fr)',
      ...(visibleRegions.right ? ['var(--right-size)'] : []),
    ].join(' '),
    gridTemplateRows: [
      ...(visibleRegions.header ? ['var(--header-size)'] : []),
      'minmax(0, 1fr)',
      ...(visibleRegions.footer ? ['var(--footer-size)'] : []),
    ].join(' '),
    gridTemplateAreas: [
      ...(visibleRegions.header ? ['header'] : []),
      'center',
      ...(visibleRegions.footer ? ['footer'] : []),
    ].map((region) => `"${[
      ...(visibleRegions.left ? ['left'] : []),
      region,
      ...(visibleRegions.right ? ['right'] : []),
    ].join(' ')}"`).join(' '),
  } as CSSProperties;

  const renderTabRegion = (placement: TabPlacement) => {
    const regionBlocks = blocksForDate(placement);
    if (!visibleRegions[placement]) return null;
    const active =
      regionBlocks.find((block) => block.id === activeBlocks[placement]) ??
      regionBlocks[0];
    const activeEntry = active ? entriesByBlock.get(active.id) : undefined;
    const activeContent = active
      ? activeEntry?.content ?? active.templateContent
      : '';
    return (
      <section
        className={`tab-region region-${placement}${active ? ' has-content' : ''}${regionBlocks.length > 1 ? ' has-tabs' : ''}${editingLayout ? ' layout-edit-region' : ''}`}
        onDragOver={editingLayout ? (event) => event.preventDefault() : undefined}
        onDrop={editingLayout ? (event) => dropPanel(event, placement, regionBlocks.length) : undefined}
      >
        {editingLayout && (
          <LayoutSectionHeader
            title={sectionTitles[placement]}
            isOpen={addMenuPlacement === placement}
            onToggle={() => toggleAddMenu(placement)}
            onAdd={(label) => void addPanel(label, placement)}
          />
        )}
        {regionBlocks.length > 1 ? (
          <div className="region-tabs" role="tablist" aria-label={`${placement} blocks`}>
            {regionBlocks.map((block) => (
              <button
                key={block.id}
                className="region-tab"
                type="button"
                role="tab"
                aria-selected={active?.id === block.id}
                onClick={() => setSelectedBlock(placement, block.id)}
              >
                {block.label}
              </button>
            ))}
          </div>
        ) : active && !editingLayout ? (
          <div className="region-title">{active.label}</div>
        ) : null}
        {active && editingLayout ? (
          <TemplatePane
            key={`template-${active.id}`}
            block={active}
            linkedSourceLabel={blocks.find((block) => block.id === active.previousEntryBlockId)?.label}
            onSave={(templateContent) => void updatePanelSettings(active.id, { templateContent })}
            onOpenSettings={() => openPanelSettings(active)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', String(active.id));
              event.dataTransfer.effectAllowed = 'move';
            }}
          />
        ) : active && isReadOnlyDate ? (
          activeContent.trim() ? (
            <PastNote block={active} content={activeContent} showTitle={false} />
          ) : null
        ) : active ? (
          <BlockEditor
            key={`${active.id}-${entryDate}-${entriesRevision}-${active.previousEntryBlockId ?? 'normal'}`}
            block={active}
            entry={activeEntry}
            entryDate={entryDate}
            readOnly={active.previousEntryBlockId !== null}
            onSaved={handleEntrySaved}
          />
        ) : null}
        {(!isReadOnlyDate || regionBlocks.length > 0) && placement === 'header' && (
          <ResizeHandle axis="y" className="header-resize" onResize={(delta) => updateSize('header', delta)} />
        )}
        {(!isReadOnlyDate || regionBlocks.length > 0) && placement === 'footer' && (
          <ResizeHandle axis="y" className="footer-resize" onResize={(delta) => updateSize('footer', -delta)} />
        )}
        {(!isReadOnlyDate || regionBlocks.length > 0) && placement === 'left' && (
          <ResizeHandle axis="x" className="left-resize" onResize={(delta) => updateSize('left', delta)} />
        )}
        {(!isReadOnlyDate || regionBlocks.length > 0) && placement === 'right' && (
          <ResizeHandle axis="x" className="right-resize" onResize={(delta) => updateSize('right', -delta)} />
        )}
      </section>
    );
  };

  const centerBlocks = blocksForDate('center');
  const panelSettingsBlock = blocks.find((block) => block.id === selectedPanelSettingsId);
  const previousEntrySources = blocks.filter(
    (block) =>
      block.id !== panelSettingsBlock?.id &&
      block.previousEntryBlockId === null,
  );
  if (loading) return null;

  return (
    <main className={`journal-page theme-${settings.colorScheme} app-ready${editingLayout ? ' layout-edit-mode' : ''}`}>
      {loadError ? (
        <p className="load-message" role="alert">
          Could not load or save the journal layout.
        </p>
      ) : (
        <>
        <div
          className={`journal-shell font-${settings.fontFamily} theme-${settings.colorScheme}${editingLayout ? ' layout-editing' : ''}`}
          style={cssVariables}
        >
          {renderTabRegion('header')}
          {renderTabRegion('left')}
          <section
            className={`center-region${editingLayout ? ' layout-edit-region' : ''}`}
            onDragOver={editingLayout ? (event) => event.preventDefault() : undefined}
            onDrop={editingLayout ? (event) => dropPanel(event, 'center', centerBlocks.length) : undefined}
          >
            {editingLayout && (
              <LayoutSectionHeader
                title={sectionTitles.center}
                isOpen={addMenuPlacement === 'center'}
                onToggle={() => toggleAddMenu('center')}
                onAdd={(label) => void addPanel(label, 'center')}
                extra={centerBlocks.length > 1 ? (
                  <div className="center-arrangement-controls" aria-label="Center arrangement">
                    <span>Arrangement</span>
                    <button type="button" aria-label="Rows" title="Rows" aria-pressed={settings.centerOrientation === 'vertical'} onClick={() => changeOrientation('vertical')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16" /></svg></button>
                    <button type="button" aria-label="Columns" title="Columns" aria-pressed={settings.centerOrientation === 'horizontal'} onClick={() => changeOrientation('horizontal')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16" /></svg></button>
                    <button type="button" aria-label="Grid" title="Grid" aria-pressed={settings.centerOrientation === 'grid'} onClick={() => changeOrientation('grid')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg></button>
                  </div>
                ) : undefined}
              />
            )}
            <div
              className={`center-panes ${settings.centerOrientation}`}
            >
              {centerBlocks.map((block, index) => (
                <div
                  className={`center-pane-wrap${editingLayout ? ' layout-edit-pane' : ''}`}
                  key={editingLayout ? `template-${block.id}` : `${block.id}-${entryDate}-${entriesRevision}-${block.previousEntryBlockId ?? 'normal'}`}
                  style={{ flexGrow: settings.centerSizes[block.id] ?? 1, flexShrink: 1, flexBasis: 0 }}
                  onDragOver={editingLayout ? (event) => event.preventDefault() : undefined}
                  onDrop={editingLayout ? (event) => dropPanel(event, 'center', index) : undefined}
                >
                  {editingLayout ? (
                    <TemplatePane
                      block={block}
                      linkedSourceLabel={blocks.find((source) => source.id === block.previousEntryBlockId)?.label}
                      onSave={(templateContent) => void updatePanelSettings(block.id, { templateContent })}
                      onOpenSettings={() => openPanelSettings(block)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', String(block.id));
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                    />
                  ) : isReadOnlyDate ? (
                    <PastNote
                      block={block}
                      content={
                        entriesByBlock.get(block.id)?.content ??
                        block.templateContent
                      }
                    />
                  ) : (
                    <BlockEditor
                      block={block}
                      entry={entriesByBlock.get(block.id)}
                      entryDate={entryDate}
                      readOnly={block.previousEntryBlockId !== null}
                      onSaved={handleEntrySaved}
                    />
                  )}
                  {settings.centerOrientation !== 'grid' && index < centerBlocks.length - 1 && (
                    <ResizeHandle
                      axis={
                        settings.centerOrientation === 'horizontal' ? 'x' : 'y'
                      }
                      className={`center-resize ${settings.centerOrientation === 'horizontal' ? 'center-resize-x' : 'center-resize-y'}`}
                      onResize={(delta, handle) =>
                        updateCenterPair(
                          block,
                          centerBlocks[index + 1],
                          delta,
                          handle,
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
          {renderTabRegion('right')}
          {renderTabRegion('footer')}
          {activeDialog && (
            <div className="dialog-layer">
              <button type="button" className="dialog-backdrop" aria-label="Close dialog" onClick={() => setActiveDialog(null)} />
              <section className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
                <div className="dialog-heading">
                  <h2 id="dialog-title">Settings</h2>
                  <button type="button" aria-label="Close dialog" onClick={() => setActiveDialog(null)}>×</button>
                </div>
                <div className="dialog-content settings-content">
                  <label>
                    Textbox font
                    <select value={settings.fontFamily} style={{ fontFamily: fontStacks[settings.fontFamily] }} onChange={(event) => void changeFontFamily(event.target.value as FontFamily)}>
                      {fontOptions.map((option) => <option key={option.value} value={option.value} style={{ fontFamily: fontStacks[option.value] }}>{option.label}</option>)}
                    </select>
                  </label>
                  <fieldset className="color-scheme-setting">
                    <legend>Color scheme</legend>
                    <div className="color-scheme-options">
                      {colorSchemeOptions.map((option) => (
                        <button key={option.value} type="button" aria-label={option.label} aria-pressed={settings.colorScheme === option.value} onClick={() => void changeColorScheme(option.value)}>
                          <span className={`scheme-name-preview scheme-name-preview-${option.value}`}>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {settingsError && <p className="dialog-error" role="alert">{settingsError}</p>}
                </div>
              </section>
            </div>
          )}
          {panelSettingsBlock && (
            <div className="dialog-layer">
              <button type="button" className="dialog-backdrop" aria-label="Close panel settings" onClick={() => setSelectedPanelSettingsId(null)} />
              <section className="app-dialog block-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="panel-settings-dialog-title">
                <div className="dialog-heading">
                  <h2 id="panel-settings-dialog-title">{panelSettingsBlock.label} settings</h2>
                  <button type="button" aria-label="Close panel settings" onClick={() => setSelectedPanelSettingsId(null)}>×</button>
                </div>
                <div className="dialog-content settings-content block-settings-content">
                  <form onSubmit={(event) => { event.preventDefault(); const label = panelSettingsLabel.trim(); if (label) void updatePanelSettings(panelSettingsBlock.id, { label }); }}>
                    <label>
                      Panel title
                      <input value={panelSettingsLabel} onChange={(event) => setPanelSettingsLabel(event.target.value)} maxLength={40} required />
                    </label>
                    <button type="submit">Save title</button>
                  </form>
                  <label>
                    Show previous entry from
                    <select
                      value={panelSettingsBlock.previousEntryBlockId ?? ''}
                      onChange={(event) => void updatePanelSettings(panelSettingsBlock.id, {
                        previousEntryBlockId: event.target.value ? Number(event.target.value) : null,
                      })}
                    >
                      <option value="">None — editable block</option>
                      {previousEntrySources.map((sourceBlock) => (
                        <option key={sourceBlock.id} value={sourceBlock.id}>
                          {sourceBlock.label} ({sectionTitles[sourceBlock.placement]})
                        </option>
                      ))}
                    </select>
                  </label>
                  {panelSettingsBlock.previousEntryBlockId === null ? (
                    <label>
                      Reset text
                      <select value={panelSettingsBlock.resetFrequency} onChange={(event) => void updatePanelSettings(panelSettingsBlock.id, { resetFrequency: event.target.value as ResetFrequency })}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                        <option value="never">Never</option>
                      </select>
                    </label>
                  ) : (
                    <p className="dialog-help">
                      This panel shows the source block’s most recent saved entry before the entry currently showing. Its own saved text is hidden while linked.
                    </p>
                  )}
                  <label>
                    Text size: {panelSettingsBlock.fontSizePx}px
                    <input type="range" min="12" max="36" value={panelSettingsBlock.fontSizePx} onChange={(event) => void updatePanelSettings(panelSettingsBlock.id, { fontSizePx: Number(event.target.value) })} />
                  </label>
                  <button type="button" className="remove-panel-button" onClick={() => setPendingPanelRemoval(panelSettingsBlock)}>Remove panel</button>
                  {panelError && <p className="dialog-error" role="alert">{panelError}</p>}
                </div>
              </section>
            </div>
          )}
          {pendingPanelRemoval && (
            <div className="dialog-layer confirmation-layer">
              <button type="button" className="dialog-backdrop" aria-label="Cancel panel removal" onClick={() => setPendingPanelRemoval(null)} />
              <section className="app-dialog confirm-removal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-panel-title" aria-describedby="remove-panel-description">
                <div className="dialog-heading">
                  <h2 id="remove-panel-title">Remove panel?</h2>
                  <button type="button" aria-label="Cancel panel removal" onClick={() => setPendingPanelRemoval(null)}>×</button>
                </div>
                <div className="dialog-content confirm-removal-content">
                  <p id="remove-panel-description">Remove “{pendingPanelRemoval.label}” from the layout? Its saved entries will be kept.</p>
                  <div className="confirm-removal-actions">
                    <button type="button" onClick={() => setPendingPanelRemoval(null)}>Cancel</button>
                    <button type="button" className="confirm-remove-button" onClick={() => void confirmPanelRemoval()}>Remove panel</button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
        <div className="center-toolbar bottom-toolbar">
          {editingLayout ? (
            <>
              <strong className="layout-edit-title">Editing layout and templates</strong>
              <span className={`layout-edit-status${panelError || layoutError ? ' has-error' : ''}`} role={panelError || layoutError ? 'alert' : undefined}>
                {panelError || (layoutError ? 'Layout change could not be saved' : 'Changes set default content. Drag ⠿ to move or reorder panels.')}
              </span>
              <button
                type="button"
                className="layout-done-button"
                onClick={() => setEditingLayout(false)}
              >
                Done
              </button>
            </>
          ) : (
            <>
              {!editingLayout && dailyQuote && (
                <span className="daily-quote" aria-label="Today's thought">
                  “{dailyQuote.text}” — {dailyQuote.author}
                </span>
              )}
              {layoutError && (
            <span className="layout-save-error" role="alert">
              Layout change could not be saved
            </span>
              )}
              {entryDate !== todayDate && (
                <button type="button" onClick={() => setEntryDate(todayDate)}>
                  Today
                </button>
              )}
              <div className="date-selector">
                <button
                  type="button"
                  aria-label="Previous day"
                  onClick={() => changeDateByDays(-1)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m12 4-6 6 6 6" />
                  </svg>
                </button>
                <input
                  type="date"
                  aria-label="Journal date"
                  value={entryDate}
                  max={todayDate}
                  onChange={(event) => {
                    if (event.target.value <= todayDate) setEntryDate(event.target.value);
                  }}
                />
                <button
                  type="button"
                  aria-label="Next day"
                  disabled={entryDate >= todayDate}
                  onClick={() => changeDateByDays(1)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m8 4 6 6-6 6" />
                  </svg>
                </button>
              </div>
          <button type="button" onClick={() => setActiveDialog('appearance')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.2 2.5h3.6l.45 1.8a6 6 0 0 1 1.25.72l1.78-.55 1.8 3.12-1.34 1.25a6 6 0 0 1 0 1.44l1.34 1.25-1.8 3.12-1.78-.55a6 6 0 0 1-1.25.72l-.45 1.8H8.2l-.45-1.8a6 6 0 0 1-1.25-.72l-1.78.55-1.8-3.12 1.34-1.25a6 6 0 0 1 0-1.44L2.92 7.6l1.8-3.12 1.78.55a6 6 0 0 1 1.25-.72L8.2 2.5Z" />
              <circle cx="10" cy="9.55" r="2.25" />
            </svg>
            Settings
          </button>
          {!editingLayout && (
            <button type="button" onClick={() => setEditingLayout(true)}>Edit Layout</button>
          )}
            </>
          )}
        </div>
        </>
      )}
    </main>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Router>
  );
}
