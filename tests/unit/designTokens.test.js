import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../../src/styles.css', import.meta.url)),
  'utf8'
);

// Custom properties that are intentionally injected at runtime from JS
// (set as inline styles), so they are referenced in CSS but not statically
// defined. They all carry a CSS fallback. Keep this list tiny and justified.
const RUNTIME_INJECTED = new Set(['--wire-color']);

function definedCustomProps(source) {
  return new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
}

function referencedCustomProps(source) {
  return new Set([...source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
}

function resolveHex(name, defined, source) {
  // Returns the #rrggbb a token resolves to, following one level of var() alias.
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const match = source.match(re);
  assert.ok(match, `token ${name} must be defined`);
  const value = match[1].trim();
  const hex = value.match(/#([0-9a-f]{6})/i);
  if (hex) return hex[1].toLowerCase();
  const alias = value.match(/var\(\s*(--[a-z0-9-]+)/i);
  if (alias) return resolveHex(alias[1], defined, source);
  throw new Error(`token ${name} does not resolve to a hex color (value: ${value})`);
}

function relativeLuminance(hex) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(0, 2), 16));
  const g = channel(parseInt(hex.slice(2, 4), 16));
  const b = channel(parseInt(hex.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

test('every CSS custom property referenced in styles.css is defined (no token drift)', () => {
  const defined = definedCustomProps(css);
  const referenced = referencedCustomProps(css);
  const missing = [...referenced].filter(
    (name) => !defined.has(name) && !RUNTIME_INJECTED.has(name)
  );
  assert.deepEqual(missing, [], `undefined custom properties: ${missing.join(', ')}`);
});

test('stone-surface text colors meet WCAG AA 4.5:1', () => {
  const defined = definedCustomProps(css);
  const stone = resolveHex('--c-stone', defined, css);
  for (const fg of ['--c-muted', '--c-slate']) {
    const ratio = contrastRatio(stone, resolveHex(fg, defined, css));
    assert.ok(
      ratio >= 4.5,
      `${fg} on --c-stone must be >= 4.5:1 for AA body text, got ${ratio.toFixed(2)}:1`
    );
  }
});

test('muted text on the white canvas meets WCAG AA 4.5:1', () => {
  const defined = definedCustomProps(css);
  const ratio = contrastRatio(
    resolveHex('--c-canvas', defined, css),
    resolveHex('--c-muted', defined, css)
  );
  assert.ok(ratio >= 4.5, `--c-muted on --c-canvas must be >= 4.5:1, got ${ratio.toFixed(2)}:1`);
});

test('focus ring uses the dedicated focus token, not coral', () => {
  // Regression guard for P16: the global focus-visible ring must be --c-focus.
  const focusRule = css.match(/:focus-visible[^{]*\{[^}]*\}/);
  assert.ok(focusRule, 'a :focus-visible rule must exist');
  assert.match(focusRule[0], /outline:[^;]*var\(--c-focus\)/);
});
