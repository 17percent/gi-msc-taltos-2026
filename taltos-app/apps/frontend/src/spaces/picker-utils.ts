/** Az a gyökér-attribútum, amelyről a dialógok tudják: az Esc először a keresőlistát zárja. */
export const PICKER_OPEN_ATTR = 'data-picker-open';

/** A dialógok `onEscapeKeyDown`-jához: ha a keresőlista nyitva van, az Esc ne zárja be a dialógot. */
export function keepDialogOpenWhilePickerOpen(event: Event): void {
  const target = event.target;
  if (target instanceof Element && target.closest(`[${PICKER_OPEN_ATTR}="true"]`)) {
    event.preventDefault();
  }
}
