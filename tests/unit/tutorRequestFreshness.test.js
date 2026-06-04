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

  assert.equal(key, 'connection:sda|version:3|ko|7');
});

test('freshness fails when target, artifact version, locale, or sequence changes', () => {
  const key = 'connection:sda|version:3|ko|7';
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

test('request key prefers explicit target id and artifact fingerprint', () => {
  const key = buildTutorRequestKey({
    target: { id: 'connection:sda', type: 'connection' },
    targetId: 'connection-sda',
    artifactVersion: 3,
    artifactFingerprint: 'afp-request-a',
    locale: 'ko',
    sequence: 7
  });

  assert.equal(key, 'connection-sda|afp-request-a|ko|7');
});

test('freshness compares response-time current artifact fingerprint', () => {
  const requestKey = buildTutorRequestKey({
    targetId: 'part-led-1',
    artifactFingerprint: 'afp-request-a',
    locale: 'ko',
    sequence: 7
  });

  assert.equal(isFreshTutorResponse(requestKey, {
    targetId: 'part-led-1',
    artifactFingerprint: 'afp-current-b',
    locale: 'ko',
    sequence: 7
  }), false);
});

test('freshness falls back to artifact version only when no fingerprint exists', () => {
  const requestKey = buildTutorRequestKey({
    targetId: 'part-led-1',
    artifactVersion: 3,
    locale: 'ko',
    sequence: 2
  });

  assert.equal(isFreshTutorResponse(requestKey, {
    targetId: 'part-led-1',
    artifactVersion: 3,
    locale: 'ko',
    sequence: 2
  }), true);
});
