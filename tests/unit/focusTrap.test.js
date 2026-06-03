import assert from 'node:assert/strict';
import test from 'node:test';

import { nextTrapIndex } from '../../src/focusTrap.js';

test('nextTrapIndex returns -1 when there is nothing focusable', () => {
  assert.equal(nextTrapIndex(0, -1, false), -1);
  assert.equal(nextTrapIndex(0, 0, true), -1);
});

test('forward Tab wraps from the last element back to the first', () => {
  assert.equal(nextTrapIndex(3, 2, false), 0);
});

test('forward Tab from outside the trap pulls focus to the first element', () => {
  assert.equal(nextTrapIndex(3, -1, false), 0);
});

test('forward Tab in the middle defers to the browser (returns -1)', () => {
  assert.equal(nextTrapIndex(3, 0, false), -1);
  assert.equal(nextTrapIndex(3, 1, false), -1);
});

test('Shift+Tab wraps from the first element to the last', () => {
  assert.equal(nextTrapIndex(3, 0, true), 2);
});

test('Shift+Tab from outside the trap pulls focus to the last element', () => {
  assert.equal(nextTrapIndex(3, -1, true), 2);
});

test('Shift+Tab in the middle defers to the browser (returns -1)', () => {
  assert.equal(nextTrapIndex(3, 2, true), -1);
  assert.equal(nextTrapIndex(3, 1, true), -1);
});

test('single focusable element always keeps focus on itself', () => {
  assert.equal(nextTrapIndex(1, 0, false), 0);
  assert.equal(nextTrapIndex(1, 0, true), 0);
});
