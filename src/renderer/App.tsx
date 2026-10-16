import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  { value: 'charcoal', label: 'Soft charcoal' },
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
}

function BlockEditor({ block, entry, entryDate, readOnly }: BlockEditorProps) {
  const [content, setContent] = useState(
    entry?.content ?? block.templateContent,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const entryId = useRef(entry?.id);
  const skipInitialSave = useRef(true);

  useEffect(() => {
    if (readOnly) return undefined;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      if (
        !entryId.current &&
        !content.trim() &&
        !block.templateContent.trim()
      ) return;

      setSaving(true);
      setSaveError(false);
      void window.electron.entries
        .save({
          ...(entryId.current ? { id: entryId.current } : {}),
          blockId: block.id,
          entryDate,
          content,
        })
        .then((savedEntry) => {
          entryId.current = savedEntry.id;
          return savedEntry;
        })
        .catch(() => {
          setSaveError(true);
        })
        .finally(() => {
          setSaving(false);
        });
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [block.id, block.templateContent, content, entryDate, readOnly]);

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
  onSave,
  onDragStart,
  onOpenSettings,
}: {
  block: Block;
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
  onResize: (delta: number) => void;
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
        onResize(current - lastCoordinate.current);
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
          onResize(-8);
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          onResize(8);
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
  const [settings, setSettings] = useState<LayoutSettings>({
    centerOrientation: 'vertical',
    headerSizePx: 48,
    footerSizePx: 36,
    leftSizePx: 180,
    rightSizePx: 180,
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
  const isReadOnlyDate = entryDate < today();

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
    setEntryDate(
      `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`,
    );
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

  const sizeFor = (placement: BlockPlacement, blockId?: number) => {
    if (placement === 'center') return settings.centerSizes[blockId!] ?? 1;
    const key = `${placement}SizePx` as
      | 'headerSizePx'
      | 'footerSizePx'
      | 'leftSizePx'
      | 'rightSizePx';
    return settings[key];
  };

  const setLayoutSize = (
    placement: BlockPlacement,
    value: number,
    blockId?: number,
  ) => {
    const min = placement === 'center'
      ? 0.25
      : placement === 'header' || placement === 'footer' ? 32 : 120;
    const max = placement === 'center'
      ? 4
      : placement === 'header' || placement === 'footer' ? 240 : 360;
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

  const updateCenterPair = (first: Block, second: Block, delta: number) => {
    const firstSize = sizeFor('center', first.id);
    const secondSize = sizeFor('center', second.id);
    const pairSize = firstSize + secondSize;
    const nextFirst = Math.max(0.25, Math.min(4, firstSize + delta / 300));
    const nextSecond = Math.max(0.25, Math.min(4, pairSize - nextFirst));
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
      if (update.resetFrequency) {
        const entries = await window.electron.entries.listForDate(entryDate);
        setEntriesByBlock(
          new Map(entries.map((entry) => [entry.blockId, entry])),
        );
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
    const pageBackgrounds: Record<ColorScheme, string> = {
      paper: 'rgb(250, 239, 198)',
      stone: 'rgb(232, 236, 239)',
      sage: 'rgb(231, 239, 229)',
      lavender: 'rgb(239, 235, 246)',
      midnight: 'rgb(23, 29, 43)',
      charcoal: 'rgb(32, 33, 32)',
    };
    document.body.style.backgroundColor = pageBackgrounds[settings.colorScheme];
  }, [settings.colorScheme]);

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

  const blocksForDate = (placement: BlockPlacement) =>
    groupedBlocks(placement).filter((block) => {
      if (editingLayout) return true;
      if (!isReadOnlyDate) return true;
      const entry = entriesByBlock.get(block.id);
      return Boolean(entry?.content.trim());
    });

  const cssVariables = {
    '--header-size': `${settings.headerSizePx}px`,
    '--footer-size': `${settings.footerSizePx}px`,
    '--left-size': `${settings.leftSizePx}px`,
    '--right-size': `${settings.rightSizePx}px`,
  } as CSSProperties;

  const renderTabRegion = (placement: TabPlacement) => {
    const regionBlocks = blocksForDate(placement);
    const active =
      regionBlocks.find((block) => block.id === activeBlocks[placement]) ??
      regionBlocks[0];
    const activeEntry = active ? entriesByBlock.get(active.id) : undefined;
    const activeContent = active
      ? activeEntry?.content ?? active.templateContent
      : '';
    return (
      <section
        className={`tab-region region-${placement}${editingLayout ? ' layout-edit-region' : ''}`}
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
                  key={`${active.id}-${entryDate}-${activeEntry?.id ?? 'template'}-${activeEntry ? '' : active.templateContent}`}
            block={active}
            entry={activeEntry}
            entryDate={entryDate}
            readOnly={isReadOnlyDate}
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
                  key={editingLayout ? `template-${block.id}` : `${block.id}-${entryDate}-${entriesByBlock.get(block.id)?.id ?? 'template'}-${entriesByBlock.has(block.id) ? '' : block.templateContent}`}
                  style={{ flexGrow: settings.centerSizes[block.id] ?? 1, flexShrink: 1, flexBasis: 0 }}
                  onDragOver={editingLayout ? (event) => event.preventDefault() : undefined}
                  onDrop={editingLayout ? (event) => dropPanel(event, 'center', index) : undefined}
                >
                  {editingLayout ? (
                    <TemplatePane
                      block={block}
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
                      readOnly={false}
                    />
                  )}
                  {settings.centerOrientation !== 'grid' && index < centerBlocks.length - 1 && (
                    <ResizeHandle
                      axis={
                        settings.centerOrientation === 'horizontal' ? 'x' : 'y'
                      }
                      className={`center-resize ${settings.centerOrientation === 'horizontal' ? 'center-resize-x' : 'center-resize-y'}`}
                      onResize={(delta) =>
                        updateCenterPair(
                          block,
                          centerBlocks[index + 1],
                          delta,
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
                    Reset text
                    <select value={panelSettingsBlock.resetFrequency} onChange={(event) => void updatePanelSettings(panelSettingsBlock.id, { resetFrequency: event.target.value as ResetFrequency })}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                      <option value="never">Never</option>
                    </select>
                  </label>
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
              {isReadOnlyDate && (
                <span className="readonly-date-note">Read only</span>
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
                  onChange={(event) => setEntryDate(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="Next day"
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
