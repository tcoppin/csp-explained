/**
 * The colour tokens of global.css against the design rules (CLAUDE.md › Design rules): text readable in both themes,
 * the two dark blocks identical, and an action colour no one can mistake for a status (blocked, allowed, warning),
 * colour-blind visitors included. The site used raspberry until 2026-11-24: for tritanopes it matched the
 * vermilion "blocked" (ΔE 8 in dark), for deuteranopes the green "allowed" (ΔE 17).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./global.css', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../components/ui/document.css', import.meta.url), 'utf8');

/** The `--name: #hex` tokens of the block that opens at `selector`. */
function block(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`No block ${selector}`);
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const light = block(css, ':root {');
const dark = block(css, ":root[data-theme='dark'] {");
const darkSystem = block(css, ":root:not([data-theme='light']) {");

// Colour maths: WCAG 2 contrast, CIELAB distance, colour-vision deficiency simulation (Machado et al. 2009,
// full severity, in linear RGB).
type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: RGB) => {
  const [r, g, b] = c.map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const DEFICIENCIES = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
type Vision = keyof typeof DEFICIENCIES;

/** CIELAB (D65) of a colour as seen with `vision`. */
function lab(hex: string, vision: Vision): RGB {
  const linear = rgb(hex).map(toLinear);
  const [r, g, b] = DEFICIENCIES[vision].map((row) => Math.min(1, Math.max(0, row.reduce((sum, k, i) => sum + k * linear[i]!, 0)))) as RGB;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (a: string, b: string, vision: Vision) => Math.hypot(...lab(a, vision).map((v, i) => v - lab(b, vision)[i]!));

const THEMES = { light, dark };
const TEXT = ['ink', 'ink-soft', 'action', 'ok', 'bad', 'warn', 'info'];
const HIGHLIGHTS = ['hl-keyword', 'hl-host', 'hl-scheme', 'hl-nonce', 'hl-unsafe', 'hl-invalid'];
const STATUSES = ['ok', 'bad', 'warn'];
/** Below this CIELAB distance, two colours are easy to take for each other. */
const DISTINCT = 20;

describe('colour tokens', () => {
  it('has the same dark tokens whether dark mode is chosen or comes from the system', () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    expect(darkSystem).toEqual(dark);
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    describe(theme, () => {
      it.each(TEXT.flatMap((text) => ['paper', 'surface'].map((bg) => [text, bg])))('%s text on %s passes WCAG AA', (text, bg) => {
        expect(contrast(tokens[text]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
      it('button text on the action colour passes WCAG AA', () => {
        expect(contrast(tokens['action-ink']!, tokens.action!)).toBeGreaterThanOrEqual(4.5);
      });
      it('the focus ring stands out from the page (3:1 for non-text)', () => {
        expect(contrast(tokens.focus!, tokens.paper!)).toBeGreaterThanOrEqual(3);
      });
      it.each(HIGHLIGHTS)('code on the %s highlighter passes WCAG AA', (hl) => {
        expect(contrast(tokens.ink!, tokens[hl]!)).toBeGreaterThanOrEqual(4.5);
      });
      it.each(STATUSES.flatMap((status) => Object.keys(DEFICIENCIES).map((vision) => [status, vision])))(
        'the action colour is not mistaken for %s with %s',
        (status, vision) => {
          expect(distance(tokens.action!, tokens[status]!, vision as Vision)).toBeGreaterThanOrEqual(DISTINCT);
        },
      );
    });
  }

  it('prints reports in the light colours of the site', () => {
    const paper = block(doc, '.report-doc {');
    for (const name of ['ink', 'ink-soft', 'rule', 'action', 'ok', 'bad', 'warn']) expect(paper[`doc-${name}`], name).toBe(light[name]);
    expect(paper['doc-highlight']).toBe(light['hl-keyword']);
  });
});
