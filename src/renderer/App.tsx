import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Markdown from 'react-markdown';
import { ListItemNode, ListNode } from '@lexical/list';
import { ORDERED_LIST, UNORDERED_LIST } from '@lexical/markdown';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';

const placeholder = 'Enter some rich text...';

const editorConfig = {
  namespace: 'journal-editor',
  nodes: [ListNode, ListItemNode],
  onError(error: Error) {
    throw error;
  },
  theme: {
    list: {
      listitem: 'editor-list-item',
      ol: 'editor-list-ol',
      ul: 'editor-list-ul',
    },
  },
};

function Home() {
  return (
    <div>
      <h2>Daily Journal</h2>
      <Markdown>{'# Hi, *Pluto*!'}</Markdown>
      <LexicalComposer initialConfig={editorConfig}>
        <div className="editor-container">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="editor-input"
                spellCheck={false}
                aria-label="Journal entry editor"
                aria-placeholder={placeholder}
                placeholder={
                  <div className="editor-placeholder">{placeholder}</div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin shouldPreserveNumbering />
          <MarkdownShortcutPlugin transformers={[UNORDERED_LIST, ORDERED_LIST]} />
          <AutoFocusPlugin />
        </div>
      </LexicalComposer>
    </div>
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
