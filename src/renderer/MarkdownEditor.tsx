import { useEffect, useMemo, useRef } from 'react';
import {
  CHECK_LIST,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown';
import { CodeNode } from '@lexical/code-core';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { JSX } from 'react';

export interface MarkdownEditorProps {
  value: string;
  label: string;
  fontSizePx: number;
  readOnly: boolean;
  onChange?: (markdown: string) => void;
  placeholder?: string;
}

const theme = {
  list: {
    listitem: 'lexical-list-item',
    listitemChecked: 'lexical-list-item-checked',
    listitemUnchecked: 'lexical-list-item-unchecked',
  },
};

const journalTransformers = [CHECK_LIST, ...TRANSFORMERS];

function MarkdownChangePlugin({
  onChange,
}: {
  onChange: (markdown: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        if (!dirtyElements.size && !dirtyLeaves.size) return;
        editorState.read(() => {
          onChangeRef.current($convertToMarkdownString(journalTransformers));
        });
      }),
    [editor],
  );

  return null;
}

export default function MarkdownEditor({
  value,
  label,
  fontSizePx,
  readOnly,
  onChange,
  placeholder,
}: MarkdownEditorProps): JSX.Element {
  const initialConfig = useMemo(
    () => ({
      namespace: 'JournalNote',
      nodes: [
        CodeNode,
        HeadingNode,
        LinkNode,
        ListItemNode,
        ListNode,
        QuoteNode,
      ],
      theme,
      editable: !readOnly,
      editorState: () => {
        $convertFromMarkdownString(value, journalTransformers);
      },
      onError: (error: Error) => {
        throw error;
      },
    }),
    [readOnly, value],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        className={`lexical-note ${readOnly ? 'lexical-note-readonly' : ''}`}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="lexical-note-content"
              aria-label={label}
              aria-readonly={readOnly}
              spellCheck={!readOnly}
          placeholder={placeholder ? <div className="lexical-note-placeholder">{placeholder}</div> : null}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {!readOnly && (
          <>
            <HistoryPlugin />
            <ListPlugin />
            <CheckListPlugin disableTakeFocusOnClick />
            <MarkdownShortcutPlugin transformers={journalTransformers} />
            <MarkdownChangePlugin onChange={onChange ?? (() => {})} />
          </>
        )}
      </div>
    </LexicalComposer>
  );
}
