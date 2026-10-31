import { SPACE_COLOR_PALETTE } from '@taltos/shared';
import { describe, expect, it } from 'vitest';

/** A színpont nem szöveg-jelölő: a WCAG 1.4.11 szerint ≥ 3:1 minden felületen, mindkét témában (NK2, D57). */
const SURFACES: Record<string, string> = {
  'világos surface': '#ffffff',
  'világos bg': '#f7f5f1',
  'világos sunken': '#ede9e1',
  'világos primary-soft': '#ecf5f1',
  'sötét surface': '#1c1a16',
  'sötét raised': '#24211c',
  'sötét bg': '#12100d',
  'sötét sunken': '#16140f',
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('színtér-paletta', () => {
  it('8 különböző, nagybetűs hex szín', () => {
    expect(new Set(SPACE_COLOR_PALETTE).size).toBe(8);
    for (const color of SPACE_COLOR_PALETTE) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it.each(SPACE_COLOR_PALETTE.map((color) => [color]))('%s: ≥ 3:1 minden felületen', (color) => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(color, surface), `${color} a(z) ${name} felületen`).toBeGreaterThanOrEqual(3);
    }
  });
});
