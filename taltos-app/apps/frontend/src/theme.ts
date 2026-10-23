/** A téma a `data-theme` attribútumon él (DS 0.3); induláskor a rendszerbeállítást követi. */
export function applyInitialTheme(root: HTMLElement = document.documentElement): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = prefersDark ? 'dark' : 'light';
}
