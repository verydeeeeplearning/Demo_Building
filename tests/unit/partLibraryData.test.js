import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PART_LIBRARY,
  PART_CATEGORIES,
  listCategories,
  getPartsByCategory,
  searchParts
} from '../../src/partLibraryData.js';
import {
  localizeLibraryPart,
  missingKoreanLibraryPartIds,
  searchableLibraryText
} from '../../src/partLibraryLocalization.js';

const ALLOWED_KINDS = new Set([
  'board', 'module', 'display', 'chip', 'cylinder', 'dome',
  'motor', 'passive-axial', 'connector', 'sensor', 'breadboard', 'sphere'
]);

test('library defines at least 100 distinct parts', () => {
  assert.ok(PART_LIBRARY.length >= 100, `expected >= 100 parts, got ${PART_LIBRARY.length}`);
  const ids = new Set(PART_LIBRARY.map((part) => part.id));
  assert.equal(ids.size, PART_LIBRARY.length, 'part ids must be unique');
});

test('every part conforms to the renderer recipe schema', () => {
  const categoryIds = new Set(PART_CATEGORIES.map((category) => category.id));
  const hexPattern = /^#[0-9a-fA-F]{6}$/;

  for (const part of PART_LIBRARY) {
    assert.ok(part.id && typeof part.id === 'string', 'part has id');
    assert.ok(part.name && typeof part.name === 'string', `${part.id} has name`);
    assert.ok(categoryIds.has(part.category), `${part.id} has known category`);
    assert.ok(part.description.length >= 24, `${part.id} has a real description`);
    assert.ok(Array.isArray(part.pins), `${part.id} has a pins array`);

    const model = part.model;
    assert.ok(ALLOWED_KINDS.has(model.kind), `${part.id} kind ${model.kind} is allowed`);
    assert.ok(Array.isArray(model.size) && model.size.length === 3, `${part.id} size is 3-tuple`);
    assert.ok(model.size.every((value) => typeof value === 'number' && value > 0), `${part.id} size positive`);
    for (const key of ['body', 'accent', 'detail']) {
      assert.match(model.colors[key], hexPattern, `${part.id} color ${key} is hex`);
    }
  }
});

test('category filtering returns only matching parts', () => {
  assert.deepEqual(listCategories(), PART_CATEGORIES);
  for (const category of PART_CATEGORIES) {
    const parts = getPartsByCategory(category.id);
    assert.ok(parts.length > 0, `${category.id} has parts`);
    assert.ok(parts.every((part) => part.category === category.id), `${category.id} filter is clean`);
  }
  assert.equal(getPartsByCategory('all').length, PART_LIBRARY.length);
});

test('search matches name, description, and category case-insensitively', () => {
  assert.equal(searchParts('').length, PART_LIBRARY.length, 'empty query returns all');
  const sensorHits = searchParts('SENSOR');
  assert.ok(sensorHits.length > 0, 'search finds sensor-related parts');
  const oledHits = searchParts('oled');
  assert.ok(oledHits.some((part) => /oled/i.test(part.name)), 'search finds OLED by name');
});

test('Korean library localization covers every visible part card', () => {
  assert.deepEqual(missingKoreanLibraryPartIds(PART_LIBRARY), []);

  const oled = PART_LIBRARY.find((part) => part.id === 'oled-096-i2c');
  const localized = localizeLibraryPart(oled, 'ko');

  assert.equal(localized.name, 'OLED 0.96" I2C 디스플레이');
  assert.match(localized.description, /상태 표시창/);
  assert.match(searchableLibraryText(oled, 'ko'), /디스플레이/);
  assert.equal(localizeLibraryPart(oled, 'en'), oled);
});
