import { $getRoot, createEditor, HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
import { $isListItemNode, ListItemNode, ListNode } from '@lexical/list';
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, TRANSFORMERS } from '@lexical/markdown';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerMoveCheckedToBottom } from '../renderer/checklistOrder';

const transformers = [CHECK_LIST, ...TRANSFORMERS];
function setup(markdown: string, enabled = true) {
  const editor = createEditor({ nodes: [ListItemNode, ListNode], onError: (error) => { throw error; } });
  registerHistory(editor, createEmptyHistoryState(), 0);
  const unregister = enabled ? registerMoveCheckedToBottom(editor) : () => {};
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true });
  const content = () => editor.getEditorState().read(() => $convertToMarkdownString(transformers));
  const toggle = (text: string) => editor.update(() => {
    const item = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)?.getParent();
    if (!$isListItemNode(item)) throw new Error('Task missing');
    item.toggleChecked();
  }, { discrete: true, tag: HISTORY_PUSH_TAG });
  return { editor, content, toggle, unregister };
}

test('checking moves only that task to the bottom and unchecking keeps its position', () => {
  const { content, toggle } = setup('- [ ] First\n- [ ] Second\n- [x] Done');
  toggle('First');
  expect(content()).toBe('- [ ] Second\n- [x] Done\n- [x] First');
  toggle('First');
  expect(content()).toBe('- [ ] Second\n- [x] Done\n- [ ] First');
});

test('disabled setting and removing the registration preserve order', () => {
  const disabled = setup('- [ ] First\n- [ ] Second', false);
  disabled.toggle('First');
  expect(disabled.content()).toBe('- [x] First\n- [ ] Second');
  const enabled = setup('- [ ] First\n- [ ] Second');
  enabled.unregister();
  enabled.toggle('First');
  expect(enabled.content()).toBe('- [x] First\n- [ ] Second');
});

test('loading completed tasks does not reorder them', () => {
  const markdown = '- [x] Done\n- [ ] First\n- [ ] Second';
  expect(setup(markdown).content()).toBe(markdown);
});

test('checking several items in one update moves each only once', () => {
  const { editor, content } = setup('- [ ] First\n- [ ] Second\n- [ ] Third');
  editor.update(() => {
    for (const node of $getRoot().getAllTextNodes().slice(0, 2)) {
      const item = node.getParent();
      if ($isListItemNode(item)) item.setChecked(true);
    }
  }, { discrete: true });
  expect(content()).toBe('- [ ] Third\n- [x] First\n- [x] Second');
});

test('tasks stay in their own checklist and nested children move with their parent', () => {
  const { content, toggle } = setup('- [ ] Parent\n    - [ ] Child\n    - [ ] Sibling\n- [ ] Other\n\nSeparate\n\n- [ ] Another');
  toggle('Child');
  expect(content()).toContain('- [ ] Parent\n    - [ ] Sibling\n    - [x] Child\n- [ ] Other');
  toggle('Parent');
  expect(content()).toBe('- [ ] Other\n- [x] Parent\n    - [ ] Sibling\n    - [x] Child\n\nSeparate\n\n- [ ] Another');
});

test('undo and redo restore both the check state and position together', async () => {
  const { editor, content, toggle } = setup('- [ ] First\n- [ ] Second');
  toggle('First');
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  await Promise.resolve();
  expect(content()).toBe('- [ ] First\n- [ ] Second');
  editor.dispatchCommand(REDO_COMMAND, undefined);
  await Promise.resolve();
  expect(content()).toBe('- [ ] Second\n- [x] First');
});
