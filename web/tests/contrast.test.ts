// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = (re: RegExp) => Object.fromEntries([...(css.match(re)?.[1] ?? '').matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
const light = block(/:root\s*{([^}]*)}/);
const dark = { ...light, ...block(/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]*)}/) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [foreground, background, minimum ratio]: 4.5 for text, 3 for borders/UI components.
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['accent', 'surface', 4.5], ['accent', 'bg', 4.5],
  ['accent-fg', 'accent', 4.5], ['accent', 'accent-soft', 4.5], ['text', 'accent-soft', 4.5], ['danger', 'surface', 4.5], ['danger', 'danger-soft', 4.5],
  ['warn', 'warn-soft', 4.5], ['ok', 'surface', 4.5], ['border', 'surface', 1.5],
];

describe.each([['light', light], ['dark', dark]])('%s theme contrast', (_name, t) => {
  it.each(PAIRS)('%s on %s >= %s', (fg, bg, min) => {
    expect(t[fg], `missing --${fg}`).toBeDefined();
    expect(t[bg], `missing --${bg}`).toBeDefined();
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
  });
});

it('parsed both themes', () => {
  expect(Object.keys(light).length).toBeGreaterThan(10);
  expect(dark.bg).not.toBe(light.bg);
});
