/**
 * Közös tesztkörnyezet: a jsdom-ból hiányzó böngészőfunkciók (Radix, cmdk igényli őket).
 * Nincs hálózat: minden teszt a saját `fetch`-mockját állítja be.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

for (const name of [
  'scrollIntoView',
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
]) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, { value: () => false, configurable: true });
  }
}

// Asztali méret az alapértelmezés (a táblázat-nézet); a mobil-nézethez a teszt felülírja.
export function setViewportDesktop(desktop: boolean): void {
  window.matchMedia = (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}
setViewportDesktop(true);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});
