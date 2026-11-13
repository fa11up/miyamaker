/* A field the person is typing in keeps its own keys (undo, redo, Escape): inputs, text areas, selects and
   anything editable. */
export function isTextEntry(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!(target.isContentEditable || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
