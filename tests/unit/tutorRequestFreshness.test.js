import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTutorRequestKey,
  isFreshTutorResponse
} from '../../src/tutorRequestFreshness.js';

test('tutor request key captures target, artifact version, locale, and sequence', () => {
  const key = buildTutorRequestKey({
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  });

  assert.equal(key, 'connection:sda|3|ko|7');
});

test('freshness fails when target, artifact version, locale, or sequence changes', () => {
  const key = 'connection:sda|3|ko|7';
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  }), true);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:scl', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 4,
    locale: 'ko',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'en',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 8
  }), false);
});
