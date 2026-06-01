import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_PATH_STYLES,
  stageEndpointMap,
  stageCurrentPathDescriptors,
  stageGenericPartDescriptors,
  stageLibraryPartDescriptors,
  stageSpecializedPartPresence
} from '../../src/stageScene.js';

test('stage endpoint map prefers render plan layout endpoints over demo-specific fallback coordinates', () => {
  const endpoints = stageEndpointMap({
    parts: [
      { id: 'custom-controller', type: 'arduino', label: 'Custom Arduino' },
      { id: 'custom-display', type: 'oled', label: 'Custom OLED' }
    ],
    connections: [
      {
        id: 'custom-sda',
        from: { partId: 'custom-controller', pin: 'A4/SDA' },
        to: { partId: 'custom-display', pin: 'SDA' }
      }
    ],
    layout: {
      endpoints: {
        'custom-controller:A4/SDA': { x: 9.1, y: 1.2, z: -3.4 },
        'custom-display:SDA': { x: 4.4, y: 0.8, z: 2.2 }
      }
    }
  });

  assert.equal(endpoints['custom-controller:A4/SDA'].x, 9.1);
  assert.equal(endpoints['custom-controller:A4/SDA'].y, 1.2);
  assert.equal(endpoints['custom-controller:A4/SDA'].z, -3.4);
  assert.equal(endpoints['custom-display:SDA'].x, 4.4);
});

test('stage endpoint map preserves fallback endpoints when render plan layout is partial', () => {
  const endpoints = stageEndpointMap({
    parts: [
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno' },
      { id: 'oled-display', type: 'oled', label: 'OLED' }
    ],
    layout: {
      endpoints: {
        'oled-display:SDA': { x: 5.5, y: 0.9, z: -1.1 }
      }
    }
  });

  assert.equal(endpoints['oled-display:SDA'].x, 5.5);
  assert.equal(endpoints['arduino-uno:5V'].x, -1.12);
});

test('stage generic part descriptors come from render plan parts beyond the OLED demo', () => {
  const descriptors = stageGenericPartDescriptors({
    parts: [
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', position: { x: -1, y: 0.4, z: 0 } },
      { id: 'led-1', type: 'led', label: 'Status LED', position: { x: 0.4, y: 0.35, z: 0.55 } },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', position: { x: 0.85, y: 0.34, z: 0.55 } },
      { id: 'buzzer-1', type: 'buzzer', label: 'Piezo buzzer', position: { x: 1.3, y: 0.35, z: -0.15 } },
      { id: 'wire-1', type: 'wire', label: 'Jumper wire', position: { x: 0, y: 0, z: 0 } }
    ]
  });

  assert.deepEqual(descriptors.map((part) => part.id), ['led-1', 'r1', 'buzzer-1']);
  assert.equal(descriptors[0].shape, 'led');
  assert.equal(descriptors[1].shape, 'resistor');
  assert.equal(descriptors[2].color, '#2b2b32');
  assert.deepEqual(descriptors[0].position, { x: 0.4, y: 0.35, z: 0.55 });
});

test('stage generic part descriptors prefer render plan footprint dimensions over local fallback profiles', () => {
  const descriptors = stageGenericPartDescriptors({
    parts: [
      {
        id: 'custom-led',
        type: 'led',
        label: 'Oversized LED',
        position: { x: 0, y: 0.3, z: 0 },
        footprint: {
          type: 'led',
          width: 0.9,
          depth: 0.42,
          height: 0.74,
          pinAnchors: {
            A: { x: -0.2, y: 0.1, z: 0.2, role: 'anode' },
            K: { x: 0.2, y: 0.1, z: 0.2, role: 'cathode' }
          },
          labelAnchor: { x: 0, y: 0.8, z: 0 },
          placement: { allowedSurfaces: ['breadboard'], breadboardCompatible: true, defaultOrientation: 'legs-down' },
          simulationOverlayAnchors: []
        }
      }
    ]
  });

  assert.deepEqual(descriptors[0].size, { width: 0.9, depth: 0.42, height: 0.74 });
  assert.equal(descriptors[0].footprint.type, 'led');
});

test('stage generic part descriptors prefer render plan visual style over local fallback profiles', () => {
  const descriptors = stageGenericPartDescriptors({
    parts: [
      {
        id: 'custom-output',
        type: 'led',
        label: 'Custom output module',
        footprint: {
          type: 'led',
          width: 0.32,
          depth: 0.24,
          height: 0.18,
          visualStyle: {
            shape: 'module',
            color: '#123456',
            material: 'matte-pcb'
          },
          pinAnchors: {
            A: { x: -0.12, y: 0.05, z: 0.1, role: 'signal' },
            K: { x: 0.12, y: 0.05, z: 0.1, role: 'ground' }
          },
          labelAnchor: { x: 0, y: 0.28, z: 0 },
          placement: { allowedSurfaces: ['breadboard'], breadboardCompatible: true, defaultOrientation: 'horizontal' },
          simulationOverlayAnchors: []
        }
      }
    ]
  });

  assert.equal(descriptors[0].shape, 'module');
  assert.equal(descriptors[0].color, '#123456');
  assert.equal(descriptors[0].material, 'matte-pcb');
});

test('stage generic part descriptors carry render footprint hover targets', () => {
  const descriptors = stageGenericPartDescriptors({
    parts: [
      {
        id: 'led-1',
        type: 'led',
        label: 'Status LED',
        footprint: {
          type: 'led',
          width: 0.3,
          depth: 0.3,
          height: 0.5,
          visualStyle: {
            shape: 'led',
            color: '#ff5b59',
            material: 'translucent-emissive'
          },
          pinAnchors: {
            A: { x: -0.08, y: 0.05, z: 0.14, role: 'anode' },
            K: { x: 0.08, y: 0.05, z: 0.14, role: 'cathode' }
          },
          labelAnchor: { x: 0, y: 0.58, z: 0 },
          placement: { allowedSurfaces: ['breadboard'], breadboardCompatible: true, defaultOrientation: 'legs-down' },
          simulationOverlayAnchors: [],
          hoverTargets: [
            { id: 'body', label: 'LED body', explainableAs: ['current-limited-load'] },
            { id: 'pin-anode', label: 'Anode', pin: 'A', explainableAs: ['polarity'] }
          ]
        }
      }
    ]
  });

  assert.deepEqual(descriptors[0].hoverTargets.map((target) => target.id), ['body', 'pin-anode']);
  assert.equal(descriptors[0].hoverTargets[1].pin, 'A');
});

test('stage specialized part presence is derived from render plan parts instead of demo defaults', () => {
  assert.deepEqual(
    stageSpecializedPartPresence({
      parts: [
        { id: 'breadboard', type: 'breadboard', label: 'Breadboard' },
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno' },
        { id: 'led-1', type: 'led', label: 'LED' }
      ]
    }),
    { breadboard: true, arduino: true, oled: false }
  );

  assert.deepEqual(
    stageSpecializedPartPresence({
      parts: [
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno' },
        { id: 'oled-display', type: 'oled', label: 'OLED' }
      ]
    }),
    { breadboard: false, arduino: true, oled: true }
  );
});

test('stage library-only descriptors are rendered only when the render plan declares them', () => {
  assert.deepEqual(
    stageLibraryPartDescriptors({
      parts: [
        { id: 'breadboard', type: 'breadboard', label: 'Breadboard' },
        { id: 'led-1', type: 'led', label: 'LED' }
      ]
    }),
    []
  );

  const descriptors = stageLibraryPartDescriptors({
    parts: [
      { id: 'photo-sensor', type: 'sensor', label: 'Light sensor', libraryOnly: true, position: { x: 2.4, y: 0.3, z: 1.4 } },
      { id: 'dc-motor', type: 'motor', label: 'DC motor', libraryOnly: true, position: { x: -2.4, y: 0.3, z: 1.4 } }
    ]
  });

  assert.deepEqual(descriptors.map((part) => part.id), ['photo-sensor', 'dc-motor']);
  assert.equal(descriptors[0].shape, 'sensor');
  assert.equal(descriptors[1].shape, 'motor');
});

test('stage exposes current path overlay styles by semantic kind', () => {
  assert.deepEqual(Object.keys(CURRENT_PATH_STYLES).sort(), [
    'bus-activity',
    'fault-current',
    'load-current',
    'sensing-divider',
    'signal-activity',
    'supply-current'
  ].sort());

  for (const style of Object.values(CURRENT_PATH_STYLES)) {
    assert.equal(typeof style.color, 'number');
    assert.equal(typeof style.pulse, 'boolean');
  }
});

test('stage current path descriptors are disabled unless simulation is valid', () => {
  const invalidDescriptors = stageCurrentPathDescriptors({
    simulationPlan: {
      status: 'invalid',
      currentPaths: [
        {
          id: 'blocked',
          kind: 'fault-current',
          from: 'arduino-uno:5V',
          through: ['bad-wire'],
          to: 'arduino-uno:GND',
          label: 'Blocked fault path'
        }
      ]
    }
  });

  assert.deepEqual(invalidDescriptors, []);

  const descriptors = stageCurrentPathDescriptors({
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'display-bus',
          kind: 'bus-activity',
          from: 'arduino-uno:A4/SDA',
          through: ['oled-display'],
          to: 'oled-display:SDA',
          label: 'Display bus activity'
        }
      ]
    }
  });

  assert.equal(descriptors[0].id, 'display-bus');
  assert.equal(descriptors[0].style.color, CURRENT_PATH_STYLES['bus-activity'].color);
  assert.equal(descriptors[0].style.pulse, false);
});
