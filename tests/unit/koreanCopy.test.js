import assert from 'node:assert/strict';
import test from 'node:test';

import { ko } from '../../src/locales/ko.js';

const ALLOWED_TECHNICAL_TERMS = [
  'Arduino',
  'OLED',
  'LED',
  'GND',
  'SDA',
  'SCL',
  'PWM',
  'I2C',
  'USB',
  'Deepagents',
  'JSON',
  'KOR',
  'ENG',
  'H-eduware',
  'RALPHTON BUSAN'
];

const BANNED_INTERNAL_TERMS = [
  /canonical context/i,
  /missing support evidence/i,
  /validated synthesis/i,
  /context layer/i,
  /\bcoverage\b/i,
  /\brender\b/i,
  /\btrace\b/i,
  /\bartifact\b/i,
  /\binspector\b/i,
  /\bgrounding\b/i
];

function flattenStrings(value, path = []) {
  if (typeof value === 'string') {
    return [{ path: path.join('.'), value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenStrings(item, path.concat(String(index))));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => flattenStrings(child, path.concat(key)));
  }
  return [];
}

function stripAllowedTechnicalTerms(value) {
  return ALLOWED_TECHNICAL_TERMS.reduce(
    (text, term) => text.replaceAll(term, ''),
    value
  );
}

test('Korean locale strings are readable Korean copy, not mojibake', () => {
  const offenders = flattenStrings(ko)
    .filter(({ value }) => /[\uFFFD\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(stripAllowedTechnicalTerms(value)))
    .map(({ path, value }) => `${path}: ${value}`);

  assert.deepEqual(offenders, []);
});

test('Korean locale strings do not expose internal agent/debug wording', () => {
  const offenders = flattenStrings(ko)
    .filter(({ value }) => BANNED_INTERNAL_TERMS.some((pattern) => pattern.test(value)))
    .map(({ path, value }) => `${path}: ${value}`);

  assert.deepEqual(offenders, []);
});
