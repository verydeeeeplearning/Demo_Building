import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderWarningsMarkdown,
  renderWarningTitle
} from '../../src/renderWarnings.js';

test('render warnings markdown explains missing visual footprints for students', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'MISSING_RENDER_FOOTPRINT',
      componentId: 'mystery-module',
      message: 'Mystery module is validated electrically but has no render footprint in the catalog.'
    }
  ], 'en');

  assert.match(markdown, /^# Render warnings/);
  assert.match(markdown, /MISSING_RENDER_FOOTPRINT/);
  assert.match(markdown, /mystery-module/);
  assert.match(markdown, /validated electrically/);
});

test('render warning title is localized without exposing raw debug wording first', () => {
  assert.equal(renderWarningTitle('ko'), '화면 표시 경고');
  assert.equal(renderWarningTitle('en'), 'Render warnings');
});

test('render warnings markdown explains placement DRC issues in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
      componentId: 'led-1',
      message: 'LED is outside the breadboard outline, so the visual placement cannot be trusted.'
    }
  ], 'ko');

  assert.match(markdown, /^# 화면 표시 경고/);
  assert.match(markdown, /전기적으로 검증된 회로라도/);
  assert.match(markdown, /부품: led-1/);
  assert.match(markdown, /BREADBOARD_PLACEMENT_OUT_OF_BOUNDS/);
});

test('render warnings markdown explains connection DRC issues in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'RENDER_CONNECTION_ENDPOINT_MISSING',
      componentId: 'arduino-uno',
      message: 'Connection bad-wire references arduino-uno:D99, but that endpoint has no render anchor.'
    },
    {
      code: 'RENDER_CONNECTION_TOO_SHORT',
      componentId: 'led-1',
      message: 'Connection same-endpoint-wire is too short to render as a trustworthy jumper wire.'
    }
  ], 'ko');

  assert.match(markdown, /연결선의 시작점이나 끝점에 화면 좌표가 없어/);
  assert.match(markdown, /양 끝이 같은 위치에 가까워/);
  assert.match(markdown, /RENDER_CONNECTION_ENDPOINT_MISSING/);
  assert.match(markdown, /RENDER_CONNECTION_TOO_SHORT/);
});

test('render warnings markdown explains breadboard row collapse in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_PIN_ROW_COLLAPSE',
      componentId: 'bad-led',
      message: 'Bad LED has multiple terminals on the same breadboard row.'
    }
  ], 'ko');

  assert.match(markdown, /여러 핀이 같은 브레드보드 줄에 겹쳐/);
  assert.match(markdown, /BREADBOARD_PIN_ROW_COLLAPSE/);
});

test('render warnings markdown explains breadboard grid misalignment in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_PIN_GRID_MISALIGNMENT',
      componentId: 'floating-led',
      message: 'Floating LED pin A is not aligned to the breadboard hole grid.'
    }
  ], 'ko');

  assert.match(markdown, /브레드보드 구멍 위치에 맞지 않아/);
  assert.match(markdown, /BREADBOARD_PIN_GRID_MISALIGNMENT/);
});

test('render warnings markdown explains hidden breadboard node conflicts in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_PHYSICAL_NODE_CONFLICT',
      componentId: 'led-1',
      message: 'led-1:A and button-1:B share the same physical breadboard node without a logical connection.'
    }
  ], 'ko');

  assert.match(markdown, /논리적으로 연결되지 않은 핀들이 같은 브레드보드 구멍에/);
  assert.match(markdown, /BREADBOARD_PHYSICAL_NODE_CONFLICT/);
});

test('render warnings markdown explains hidden breadboard continuity conflicts in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_CONTINUITY_CONFLICT',
      componentId: 'led-1',
      message: 'led-1:A and button-1:B share the same breadboard continuity group without a logical connection.'
    }
  ], 'ko');

  assert.match(markdown, /같은 브레드보드 연결 줄에 있어/);
  assert.match(markdown, /BREADBOARD_CONTINUITY_CONFLICT/);
});

test('render warnings markdown explains hidden breadboard rail conflicts in readable Korean', () => {
  const markdown = renderWarningsMarkdown([
    {
      code: 'BREADBOARD_RAIL_CONFLICT',
      componentId: 'led-1',
      message: 'led-1:A and button-1:B share the same breadboard rail without a logical connection.'
    }
  ], 'ko');

  assert.match(markdown, /같은 브레드보드 전원 레일에 있어/);
  assert.match(markdown, /BREADBOARD_RAIL_CONFLICT/);
});
