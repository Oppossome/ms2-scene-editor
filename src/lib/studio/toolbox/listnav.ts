/**
 * Arrow-key navigation shared by the result lists: moves focus to the next or previous row's button and
 * returns it (null when the key is not an arrow or there is no such row).
 */
export function moveRowFocus(e: KeyboardEvent): HTMLElement | null {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return null;
  const li = (e.target as HTMLElement).closest('li');
  const next = e.key === 'ArrowDown' ? li?.nextElementSibling : li?.previousElementSibling;
  const button = next?.querySelector('button');
  if (!button) return null;
  e.preventDefault();
  button.focus();
  button.scrollIntoView({ block: 'nearest' });
  return button;
}

/** Hide a thumbnail that failed to load so the row falls back to text. */
export function hideImage(e: Event) {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
}
