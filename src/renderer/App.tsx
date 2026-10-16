import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type {
  ComponentType,
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent,
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

const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor.js').then((module) => ({
    default: module.default as unknown as ComponentType<
      import('./MarkdownEditor.js').MarkdownEditorProps
    >,
  })),
);

const tabPlacements = ['header', 'left', 'right', 'footer'] as const;
type TabPlacement = (typeof tabPlacements)[number];
type SettingsTab = 'layout' | 'appearance';

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

const placementOptions: { value: BlockPlacement; label: string }[] = [
  { value: 'center', label: 'Center' },
  { value: 'header', label: 'Header' },
  { value: 'footer', label: 'Footer' },
  { value: 'left', label: 'Left sidebar' },
  { value: 'right', label: 'Right sidebar' },
];

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
  const [content, setContent] = useState(entry?.content ?? '');
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
      if (!entryId.current && !content.trim()) return;

      setSaving(true);
      setSaveError(false);
      void window.electron.entries
        .save({
          id: entryId.current,
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
  }, [block.id, content, entryDate, readOnly]);

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
      <Suspense fallback={<div className="lexical-note-loading">Loading editor…</div>}>
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
        <Suspense fallback={<p>Loading note…</p>}>
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
  const [newBlockLabel, setNewBlockLabel] = useState('');
  const [newBlockPlacement, setNewBlockPlacement] =
    useState<BlockPlacement>('center');
  const [panelError, setPanelError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [selectedSettingsBlockId, setSelectedSettingsBlockId] =
    useState<number | null>(null);
  const sizeSaveTimers = useRef(new Map<string, number>());
  const layoutSaveTimers = useRef(new Map<'orientation', number>());
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
      layoutSaveTimers.current.forEach((timer) => window.clearTimeout(timer));
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
    const previousTimer = layoutSaveTimers.current.get('orientation');
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      void window.electron.layout
        .setCenterOrientation(centerOrientation)
        .catch(() => setLayoutError(true));
      layoutSaveTimers.current.delete('orientation');
    }, 200);
    layoutSaveTimers.current.set('orientation', timer);
  };

  const selectedBlock = (placement: TabPlacement) =>
    groupedBlocks(placement).find(
      (block) => block.id === activeBlocks[placement],
    );

  const setSelectedBlock = (placement: TabPlacement, id: number) => {
    setActiveBlocks((previous) => ({ ...previous, [placement]: id }));
  };

  const addPanel = async () => {
    try {
      setPanelError('');
      const block = await window.electron.blocks.add(
        newBlockLabel,
        newBlockPlacement,
      );
      setBlocks((previous) => [...previous, block]);
      setSelectedSettingsBlockId(block.id);
      if (block.placement !== 'center') {
        setActiveBlocks((previous) => ({
          ...previous,
          [block.placement]: block.id,
        }));
      }
      setNewBlockLabel('');
    } catch {
      setPanelError('Could not add this panel. Use a title up to 40 characters.');
    }
  };

  const removePanel = async (block: Block) => {
    try {
      setPanelError('');
      const removed = await window.electron.blocks.remove(block.id);
      if (!removed) throw new Error('Panel was not found');
      setBlocks((previous) => previous.filter((item) => item.id !== block.id));
      if (selectedSettingsBlockId === block.id) {
        setSelectedSettingsBlockId(null);
      }
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

  const updatePanelSettings = async (
    blockId: number,
    update: { fontSizePx?: number; resetFrequency?: ResetFrequency },
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

  const renderLayoutZone = (placement: BlockPlacement, label: string) => {
    const zoneBlocks = groupedBlocks(placement);
    return (
      <div
        className={`layout-zone layout-zone-${placement}${placement === 'center' ? ` ${settings.centerOrientation}` : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropPanel(event, placement, zoneBlocks.length)}
      >
        <span className="layout-zone-title">{label}</span>
        <div className="layout-zone-blocks" role="list">
          {zoneBlocks.map((block, index) => (
            <div
              key={block.id}
              className="layout-panel-card"
              role="listitem"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', String(block.id));
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropPanel(event, placement, index)}
            >
              <span className="layout-drag-grip" aria-hidden="true">⠿</span>
              <span className="layout-panel-label">{block.label}</span>
              <button
                type="button"
                className="layout-remove-panel"
                aria-label={`Remove ${block.label}`}
                onClick={() => void removePanel(block)}
              >
                ×
              </button>
              <button
                type="button"
                className="layout-panel-settings"
                aria-label={`Settings for ${block.label}`}
                onClick={() => setSelectedSettingsBlockId(block.id)}
              >
                ⚙
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const blocksForDate = (placement: BlockPlacement) =>
    groupedBlocks(placement).filter((block) => {
      if (!isReadOnlyDate) return true;
      return Boolean(entriesByBlock.get(block.id)?.content.trim());
    });

  const cssVariables = {
    '--header-size': `${settings.headerSizePx}px`,
    '--footer-size': `${settings.footerSizePx}px`,
    '--left-size': `${settings.leftSizePx}px`,
    '--right-size': `${settings.rightSizePx}px`,
    '--header-resize-size': !isReadOnlyDate || blocksForDate('header').length > 0 ? '8px' : '0px',
    '--footer-resize-size': !isReadOnlyDate || blocksForDate('footer').length > 0 ? '8px' : '0px',
    '--left-resize-size': !isReadOnlyDate || blocksForDate('left').length > 0 ? '8px' : '0px',
    '--right-resize-size': !isReadOnlyDate || blocksForDate('right').length > 0 ? '8px' : '0px',
  } as CSSProperties;

  const renderTabRegion = (placement: TabPlacement) => {
    const regionBlocks = blocksForDate(placement);
    const active =
      regionBlocks.find((block) => block.id === activeBlocks[placement]) ??
      regionBlocks[0];
    const activeEntry = active ? entriesByBlock.get(active.id) : undefined;
    return (
      <section className={`tab-region region-${placement}`}>
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
        ) : active ? (
          <div className="region-title">{active.label}</div>
        ) : null}
        {active && isReadOnlyDate && activeEntry ? (
          <PastNote block={active} content={activeEntry.content} showTitle={false} />
        ) : active && (
          <BlockEditor
            key={`${active.id}-${entryDate}-${activeEntry?.id ?? 'empty'}`}
            block={active}
            entry={activeEntry}
            entryDate={entryDate}
            readOnly={isReadOnlyDate}
          />
        )}
      </section>
    );
  };

  const centerBlocks = blocksForDate('center');
  return (
    <main className={`journal-page theme-${settings.colorScheme}`}>
      {loading ? (
        <p className="load-message">Loading…</p>
      ) : loadError ? (
        <p className="load-message" role="alert">
          Could not load or save the journal layout.
        </p>
      ) : (
        <>
        <div
          className={`journal-shell font-${settings.fontFamily} theme-${settings.colorScheme}`}
          style={cssVariables}
        >
          {renderTabRegion('header')}
          {(!isReadOnlyDate || blocksForDate('header').length > 0) && (
            <ResizeHandle
              axis="y"
              className="header-resize"
              onResize={(delta) => {
                const block = selectedBlock('header');
                if (block) updateSize('header', delta);
              }}
            />
          )}
          {renderTabRegion('left')}
          {(!isReadOnlyDate || blocksForDate('left').length > 0) && (
            <ResizeHandle
              axis="x"
              className="left-resize"
              onResize={(delta) => {
                const block = selectedBlock('left');
                if (block) updateSize('left', delta);
              }}
            />
          )}
          <section className="center-region">
            <div
              className={`center-panes ${settings.centerOrientation}`}
            >
              {centerBlocks.map((block, index) => (
                <div
                  className="center-pane-wrap"
                  key={`${block.id}-${entryDate}-${entriesByBlock.get(block.id)?.id ?? 'empty'}`}
                  style={{ flexGrow: settings.centerSizes[block.id] ?? 1, flexShrink: 1, flexBasis: 0 }}
                >
                  {isReadOnlyDate ? (
                    <PastNote
                      block={block}
                      content={entriesByBlock.get(block.id)!.content}
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
                      className="center-resize"
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
          {(!isReadOnlyDate || blocksForDate('right').length > 0) && (
            <ResizeHandle
              axis="x"
              className="right-resize"
              onResize={(delta) => {
                const block = selectedBlock('right');
                if (block) updateSize('right', -delta);
              }}
            />
          )}
          {renderTabRegion('right')}
          {(!isReadOnlyDate || blocksForDate('footer').length > 0) && (
            <ResizeHandle
              axis="y"
              className="footer-resize"
              onResize={(delta) => {
                const block = selectedBlock('footer');
                if (block) updateSize('footer', -delta);
              }}
            />
          )}
          {renderTabRegion('footer')}
          {activeDialog && (
            <div className="dialog-layer">
              <button
                type="button"
                className="dialog-backdrop"
                aria-label="Close dialog"
                onClick={() => setActiveDialog(null)}
              />
              <section
                className="app-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dialog-title"
              >
                <div className="dialog-heading">
                  <h2 id="dialog-title">Settings</h2>
                  <button
                    type="button"
                    aria-label="Close dialog"
                    onClick={() => setActiveDialog(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="settings-tabs" role="tablist" aria-label="Settings sections">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDialog === 'layout'}
                    onClick={() => setActiveDialog('layout')}
                  >
                    Layout
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDialog === 'appearance'}
                    onClick={() => setActiveDialog('appearance')}
                  >
                    Appearance
                  </button>
                </div>
                {activeDialog === 'layout' ? (
                  <div className="dialog-content">
                    <form
                      className="add-panel-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addPanel();
                      }}
                    >
                      <label>
                        Panel title
                        <input
                          value={newBlockLabel}
                          onChange={(event) => setNewBlockLabel(event.target.value)}
                          maxLength={40}
                          required
                        />
                      </label>
                      <label>
                        Placement
                        <select
                          value={newBlockPlacement}
                          onChange={(event) =>
                            setNewBlockPlacement(event.target.value as BlockPlacement)
                          }
                        >
                          {placementOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit">Add panel</button>
                    </form>
                    <p className="dialog-help">
                      Drag a panel to move or reorder it. Removing a panel hides it from the layout and keeps its saved entries.
                    </p>
                    <fieldset className="center-orientation-setting">
                      <legend>Center panels</legend>
                      <button
                        type="button"
                        aria-label="Arrange center panels in rows"
                        title="Rows"
                        aria-pressed={settings.centerOrientation === 'vertical'}
                        onClick={() => changeOrientation('vertical')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 5h16M4 12h16M4 19h16" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Arrange center panels in columns"
                        title="Columns"
                        aria-pressed={settings.centerOrientation === 'horizontal'}
                        onClick={() => changeOrientation('horizontal')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 4v16M12 4v16M19 4v16" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Arrange center panels in a grid"
                        title="Grid"
                        aria-pressed={settings.centerOrientation === 'grid'}
                        onClick={() => changeOrientation('grid')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="4" y="4" width="7" height="7" />
                          <rect x="13" y="4" width="7" height="7" />
                          <rect x="4" y="13" width="7" height="7" />
                          <rect x="13" y="13" width="7" height="7" />
                        </svg>
                      </button>
                    </fieldset>
                    <div className="layout-editor-grid">
                      {renderLayoutZone('header', 'Header')}
                      {renderLayoutZone('left', 'Left sidebar')}
                      {renderLayoutZone('center', 'Center')}
                      {renderLayoutZone('right', 'Right sidebar')}
                      {renderLayoutZone('footer', 'Footer')}
                    </div>
                    {(() => {
                      const selectedPanelForSettings =
                        blocks.find((block) => block.id === selectedSettingsBlockId) ??
                        blocks[0];
                      return selectedPanelForSettings ? (
                        <section className="block-settings-panel" aria-label={`Settings for ${selectedPanelForSettings.label}`}>
                          <h3>{selectedPanelForSettings.label} settings</h3>
                          <label>
                            Font size: {selectedPanelForSettings.fontSizePx}px
                            <input
                              type="range"
                              min="12"
                              max="36"
                              step="1"
                              value={selectedPanelForSettings.fontSizePx}
                              onChange={(event) =>
                                void updatePanelSettings(selectedPanelForSettings.id, {
                                  fontSizePx: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Reset text
                            <select
                              value={selectedPanelForSettings.resetFrequency}
                              onChange={(event) =>
                                void updatePanelSettings(selectedPanelForSettings.id, {
                                  resetFrequency: event.target.value as ResetFrequency,
                                })
                              }
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                              <option value="never">Never</option>
                            </select>
                          </label>
                        </section>
                      ) : null;
                    })()}
                    {panelError && <p className="dialog-error" role="alert">{panelError}</p>}
                  </div>
                ) : (
                  <div className="dialog-content settings-content">
                    <label>
                      Textbox font
                      <select
                        value={settings.fontFamily}
                        style={{ fontFamily: fontStacks[settings.fontFamily] }}
                        onChange={(event) =>
                          void changeFontFamily(event.target.value as FontFamily)
                        }
                      >
                        {fontOptions.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            style={{ fontFamily: fontStacks[option.value] }}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="color-scheme-setting">
                      <legend>Color scheme</legend>
                      <div className="color-scheme-options">
                        {colorSchemeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-label={option.label}
                            aria-pressed={settings.colorScheme === option.value}
                            onClick={() => void changeColorScheme(option.value)}
                          >
                            <span className={`scheme-name-preview scheme-name-preview-${option.value}`}>
                              {option.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {settingsError && <p className="dialog-error" role="alert">{settingsError}</p>}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
        <div className="center-toolbar bottom-toolbar">
          {layoutError && (
            <span className="layout-save-error" role="alert">
              Layout change could not be saved
            </span>
          )}
          <button type="button" onClick={() => setActiveDialog('layout')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.2 2.5h3.6l.45 1.8a6 6 0 0 1 1.25.72l1.78-.55 1.8 3.12-1.34 1.25a6 6 0 0 1 0 1.44l1.34 1.25-1.8 3.12-1.78-.55a6 6 0 0 1-1.25.72l-.45 1.8H8.2l-.45-1.8a6 6 0 0 1-1.25-.72l-1.78.55-1.8-3.12 1.34-1.25a6 6 0 0 1 0-1.44L2.92 7.6l1.8-3.12 1.78.55a6 6 0 0 1 1.25-.72L8.2 2.5Z" />
              <circle cx="10" cy="9.55" r="2.25" />
            </svg>
            Settings
          </button>
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
          {isReadOnlyDate && (
            <span className="readonly-date-note">Read only</span>
          )}
          {dailyQuote && (
            <span className="daily-quote" aria-label="Today's thought">
              “{dailyQuote.text}” — {dailyQuote.author}
            </span>
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
