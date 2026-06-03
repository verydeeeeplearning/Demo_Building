import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clarificationOptionsForDisplay,
  clarificationQuestion,
  resumeValueForOption,
  renderClarificationOptions
} from '../../src/clarificationView.js';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const awaiting = {
  responseKind: 'awaiting_input',
  clarificationRequest: {
    level: 'output',
    question: '무엇을 만들어 볼까요?',
    options: [
      { id: 'light', label: '빛 / LED' },
      { id: 'sound', label: '소리' },
      { id: 'dht11-temperature-humidity-display', label: '온습도 (DHT11)', capabilityId: 'dht11-temperature-humidity-display' }
    ]
  }
};

void test('options shown only for awaiting_input turns', () => {
  assert.equal(clarificationOptionsForDisplay({ responseKind: 'circuit' }).length, 0);
  assert.equal(clarificationOptionsForDisplay({ responseKind: 'chat' }).length, 0);
  assert.equal(clarificationOptionsForDisplay(undefined).length, 0);
  assert.equal(clarificationOptionsForDisplay(awaiting).length, 3);
});

void test('blank-label options are dropped', () => {
  const messy = { responseKind: 'awaiting_input', clarificationRequest: { options: [{ id: 'x', label: '  ' }, { id: 'ok', label: '소리' }] } };
  assert.deepEqual(clarificationOptionsForDisplay(messy).map((o) => o.id), ['ok']);
});

void test('resume value is the option id (category id or capabilityId)', () => {
  assert.equal(resumeValueForOption({ id: 'light' }), 'light');
  assert.equal(resumeValueForOption({ id: 'dht11-temperature-humidity-display' }), 'dht11-temperature-humidity-display');
  assert.equal(resumeValueForOption(null), null);
});

void test('renders one chip per option, escaped, with index hooks', () => {
  const html = renderClarificationOptions(clarificationOptionsForDisplay(awaiting), { escapeHtml });
  assert.equal((html.match(/data-action="clarify-option"/g) || []).length, 3);
  assert.match(html, /data-option-index="0"/);
  assert.match(html, /data-testid="clarify-options"/);
  assert.equal(renderClarificationOptions([], { escapeHtml }), '');
  const xss = renderClarificationOptions([{ id: 'x', label: '<b>x</b>' }], { escapeHtml });
  assert.match(xss, /&lt;b&gt;x&lt;\/b&gt;/);
});

void test('clarificationQuestion returns the prompt', () => {
  assert.equal(clarificationQuestion(awaiting), '무엇을 만들어 볼까요?');
  assert.equal(clarificationQuestion({}), '');
});
