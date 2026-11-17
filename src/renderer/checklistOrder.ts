import { $getNodeByKey, type LexicalEditor } from 'lexical';
import { $isListItemNode, $isListNode, ListItemNode } from '@lexical/list';

export function registerMoveCheckedToBottom(editor: LexicalEditor) {
  let previousState = editor.getEditorState();
  const handled = new Set<string>();
  return editor.registerNodeTransform(ListItemNode, (item) => {
    const committedState = editor.getEditorState();
    if (committedState !== previousState) {
      previousState = committedState;
      handled.clear();
    }
    if (handled.has(item.getKey())) return;
    const parent = item.getParent();
    if (!$isListNode(parent) || parent.getListType() !== 'check' || !item.getChecked()) return;

    // Only react to an existing unchecked item being checked. Loading, pasting,
    // and editing already-completed items must preserve their saved order.
    const wasUnchecked = editor.getEditorState().read(() => {
      const previous = $getNodeByKey(item.getKey());
      return $isListItemNode(previous) && previous.getChecked() === false;
    });
    if (!wasUnchecked) return;
    handled.add(item.getKey());

    // Lexical stores an item's indented sublist in a following wrapper item.
    // Move those wrappers with the task so its children keep their parent.
    const group: ListItemNode[] = [item];
    let next = item.getNextSibling();
    while ($isListItemNode(next) && $isListNode(next.getFirstChild())) {
      group.push(next);
      next = next.getNextSibling();
    }
    if (next !== null) parent.append(...group);
  });
}
