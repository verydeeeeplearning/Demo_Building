import assert from 'node:assert/strict';
import test from 'node:test';

import { groundAgentResultArtifacts } from '../../src/agentArtifactGrounding.js';

test('grounds LED current paths to the validated circuit spec endpoints', () => {
  const result = groundAgentResultArtifacts({
    requirementMarkdown: [
      '# Project Requirement',
      '',
      'Connections',
      'c1: uno:D8 -> r1:1',
      'c2: r1:2 -> led:A',
      'c3: led:K -> uno:GND',
      '',
      'Current Flow',
      'LED forward current: about 13.6 mA from uno:D9 to uno:GND'
    ].join('\n'),
    circuitSpec: {
      components: [
        { id: 'uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' },
        { id: 'led', partId: 'led-5mm', label: '5 mm LED' }
      ],
      connections: [
        { from: { componentId: 'uno', pin: 'D8' }, to: { componentId: 'r1', pin: '1' }, signal: 'gpio' },
        { from: { componentId: 'r1', pin: '2' }, to: { componentId: 'led', pin: 'A' }, signal: 'gpio' },
        { from: { componentId: 'led', pin: 'K' }, to: { componentId: 'uno', pin: 'GND' }, signal: 'ground' }
      ]
    },
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'led-forward-current',
          label: 'LED forward current',
          from: 'uno:D9',
          through: ['r1', 'led'],
          to: 'uno:GND'
        }
      ]
    },
    agentEvents: [
      {
        name: 'estimate_current_paths',
        status: 'ok',
        summary: 'The tool detailed path still says from uno:D9 to uno:GND.'
      }
    ]
  });

  assert.equal(result.simulationPlan.currentPaths[0].from, 'uno:D8');
  assert.deepEqual(result.simulationPlan.currentPaths[0].through, ['r1', 'led']);
  assert.match(result.requirementMarkdown, /from uno:D8 to uno:GND/);
  assert.doesNotMatch(result.requirementMarkdown, /from uno:D9 to uno:GND/);
  assert.match(result.agentEvents[0].summary, /uno:D8 to uno:GND/);
  assert.doesNotMatch(result.agentEvents[0].summary, /D9/);
});

test('leaves already grounded current paths unchanged', () => {
  const original = {
    requirementMarkdown: 'Current Flow\nLED forward current: about 13.6 mA from uno:D8 to uno:GND',
    circuitSpec: {
      components: [
        { id: 'uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' },
        { id: 'led', partId: 'led-5mm', label: '5 mm LED' }
      ],
      connections: [
        { from: { componentId: 'uno', pin: 'D8' }, to: { componentId: 'r1', pin: '1' }, signal: 'gpio' },
        { from: { componentId: 'r1', pin: '2' }, to: { componentId: 'led', pin: 'A' }, signal: 'gpio' },
        { from: { componentId: 'led', pin: 'K' }, to: { componentId: 'uno', pin: 'GND' }, signal: 'ground' }
      ]
    },
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'led-forward-current',
          label: 'LED forward current',
          from: 'uno:D8',
          through: ['r1', 'led'],
          to: 'uno:GND'
        }
      ]
    }
  };

  assert.equal(groundAgentResultArtifacts(original), original);
});
