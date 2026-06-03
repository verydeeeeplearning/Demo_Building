import assert from 'node:assert/strict';
import test from 'node:test';

import { installGlobalErrorHandlers } from '../../src/globalErrorHandler.js';

function mockTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
    has(type) {
      return listeners.has(type);
    }
  };
}

test('installs error and unhandledrejection listeners and reports them', () => {
  const target = mockTarget();
  const reported = [];
  const uninstall = installGlobalErrorHandlers(target, { onError: (e) => reported.push(e) });

  assert.ok(target.has('error'));
  assert.ok(target.has('unhandledrejection'));

  target.dispatch('error', { error: new Error('boom') });
  target.dispatch('unhandledrejection', { reason: new Error('rejected') });

  assert.equal(reported.length, 2);
  assert.equal(reported[0].type, 'error');
  assert.equal(reported[0].message, 'boom');
  assert.equal(reported[1].type, 'unhandledrejection');
  assert.equal(reported[1].message, 'rejected');

  uninstall();
  assert.equal(target.has('error'), false);
  assert.equal(target.has('unhandledrejection'), false);
});

test('falls back to a readable message when no Error object is present', () => {
  const target = mockTarget();
  const reported = [];
  installGlobalErrorHandlers(target, { onError: (e) => reported.push(e) });

  target.dispatch('error', { message: 'script error' });
  target.dispatch('unhandledrejection', { reason: 'string reason' });

  assert.equal(reported[0].message, 'script error');
  assert.equal(reported[1].message, 'string reason');
});
