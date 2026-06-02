import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import * as stageSceneModule from '../../src/stageScene.js';
import {
  CURRENT_PATH_STYLES,
  stageAnimatedWireDescriptors,
  stageCameraFit,
  stageConnectionRoutePoints,
  stageEndpointMap,
  stageCurrentPathDescriptors,
  stageGenericPartDescriptors,
  stageLibraryPartDescriptors,
  stageLabelLayoutForPart,
  stageSpecializedPartDescriptors,
  stageSpecializedPartPresence
} from '../../src/stageScene.js';

function roundedPoint(point) {
  return {
    x: Number(point.x.toFixed(2)),
    y: Number(point.y.toFixed(2)),
    z: Number(point.z.toFixed(2))
  };
}

function routeHashForCircuit(circuit) {
  const endpoints = stageEndpointMap(circuit);
  const routeSnapshot = (circuit.connections ?? []).map((connection, index) => {
    const fromId = connection.from.partId ?? connection.from.componentId;
    const toId = connection.to.partId ?? connection.to.componentId;
    const from = endpoints[`${fromId}:${connection.from.pin}`];
    const to = endpoints[`${toId}:${connection.to.pin}`];
    return {
      id: connection.id,
      points: stageConnectionRoutePoints(connection, from, to, index).map(roundedPoint)
    };
  });

  return createHash('sha256')
    .update(JSON.stringify(routeSnapshot))
    .digest('hex');
}

function descriptorPositionsById(circuit) {
  const specializedParts = Object.values(stageSpecializedPartDescriptors(circuit)).filter(Boolean);
  const allParts = [
    ...specializedParts,
    ...stageGenericPartDescriptors(circuit),
    ...stageLibraryPartDescriptors(circuit)
  ];

  return Object.fromEntries(allParts.map((part) => [part.id, roundedPoint(part.position)]));
}

function phase2StageDebugSnapshot(circuit) {
  const directSnapshotHelpers = [
    stageSceneModule.stageDebugSnapshot,
    stageSceneModule.createStageDebugSnapshot,
    stageSceneModule.stageSceneDebugSnapshot
  ];

  for (const helper of directSnapshotHelpers) {
    if (typeof helper !== 'function') {
      continue;
    }
    const snapshot = helper(circuit);
    if (snapshot?.partPositions && snapshot?.wireRouteHash) {
      return snapshot;
    }
  }

  return {
    partPositions: descriptorPositionsById(circuit),
    wireRouteHash: routeHashForCircuit(circuit)
  };
}

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
  assert.equal(Number(endpoints['arduino-uno:5V'].x.toFixed(2)), -1.12);
});

test('stage camera fit consumes server-provided render plan metadata', () => {
  const fit = stageCameraFit({
    layout: {
      camera: {
        position: { x: 7.1, y: 5.2, z: 6.3 },
        target: { x: 0.4, y: 0.5, z: -0.2 },
        fov: 42,
        minDistance: 3.8,
        maxDistance: 13.5
      }
    }
  });

  assert.deepEqual(fit.position, { x: 7.1, y: 5.2, z: 6.3 });
  assert.deepEqual(fit.target, { x: 0.4, y: 0.5, z: -0.2 });
  assert.equal(fit.fov, 42);
  assert.equal(fit.minDistance, 3.8);
  assert.equal(fit.maxDistance, 13.5);
});

test('stage camera fit ignores invalid server metadata', () => {
  const fit = stageCameraFit({
    layout: {
      camera: {
        position: { x: Number.NaN, y: 5.2, z: 6.3 },
        target: { x: 0.4, y: 0.5, z: -0.2 },
        fov: 42,
        minDistance: 3.8,
        maxDistance: 13.5
      }
    }
  });

  assert.equal(fit, null);
});

test('stage wire routing consumes server-provided route points before fallback curves', () => {
  const points = stageConnectionRoutePoints(
    {
      route: [
        { x: 1, y: 2, z: 3 },
        { x: 4, y: 5, z: 6 },
        { x: 7, y: 8, z: 9 }
      ]
    },
    { x: -1, y: -1, z: -1 },
    { x: -2, y: -2, z: -2 },
    9
  );

  assert.deepEqual(points.map(roundedPoint), [
    { x: 1, y: 2, z: 3 },
    { x: 4, y: 5, z: 6 },
    { x: 7, y: 8, z: 9 }
  ]);
});

test('stage wire routing falls back for older snapshots without server route points', () => {
  const points = stageConnectionRoutePoints(
    {},
    { x: 1, y: 0.3, z: 2 },
    { x: 3, y: 0.5, z: 4 },
    0
  );

  assert.deepEqual(roundedPoint(points[0]), { x: 1, y: 0.54, z: 2 });
  assert.deepEqual(roundedPoint(points[2]), { x: 3, y: 0.74, z: 4 });
  assert.equal(points[1].y > points[0].y, true);
});

test('stage part descriptors consume server-provided label layout metadata', () => {
  const circuit = {
    parts: [
      { id: 'led-1', type: 'led', label: 'Status LED', position: { x: 0.4, y: 0.35, z: 0.55 } }
    ],
    layout: {
      labels: {
        'led-1': {
          partId: 'led-1',
          text: 'D1',
          position: { x: 0.4, y: 0.9, z: 0.72 },
          width: 0.42,
          height: 0.15
        }
      }
    }
  };
  const descriptors = stageGenericPartDescriptors(circuit);

  assert.deepEqual(stageLabelLayoutForPart(circuit, 'led-1'), {
    text: 'D1',
    position: { x: 0.4, y: 0.9, z: 0.72 },
    width: 0.42,
    height: 0.15
  });
  assert.deepEqual(descriptors[0].labelLayout, stageLabelLayoutForPart(circuit, 'led-1'));
});

test('stage specialized descriptors consume render plan positions for special meshes', () => {
  const descriptors = stageSpecializedPartDescriptors({
    parts: [
      { id: 'breadboard', type: 'breadboard', label: 'Breadboard', position: { x: 2, y: 0.1, z: -1 } },
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', position: { x: -4.2, y: 0.28, z: 0.5 } },
      { id: 'oled-display', type: 'oled', label: 'OLED', position: { x: 1.7, y: 0.25, z: -0.6 } }
    ]
  });

  assert.deepEqual(descriptors.breadboard.position, { x: 2, y: 0.1, z: -1 });
  assert.deepEqual(descriptors.arduino.position, { x: -4.2, y: 0.28, z: 0.5 });
  assert.deepEqual(descriptors.oled.position, { x: 1.7, y: 0.25, z: -0.6 });
});

test('stage fallback endpoints follow render plan positions for moved special meshes', () => {
  const endpoints = stageEndpointMap({
    parts: [
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', position: { x: -4.2, y: 0.28, z: 0.5 } },
      { id: 'oled-display', type: 'oled', label: 'OLED', position: { x: 1.7, y: 0.25, z: -0.6 } }
    ]
  });

  assert.deepEqual(roundedPoint(endpoints['arduino-uno:5V']), { x: -3.67, y: 0.61, z: -0.16 });
  assert.deepEqual(roundedPoint(endpoints['oled-display:SDA']), { x: 1.77, y: 0.52, z: -0.99 });
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

test('stage current animation binds wires by verified path endpoints instead of connection order', () => {
  const circuit = {
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'oled-module-current',
          kind: 'supply-current',
          from: 'arduino-uno:5V',
          through: ['oled-display'],
          to: 'oled-display:VCC',
          label: 'OLED supply current'
        }
      ]
    }
  };
  const wires = [
    {
      connectionId: 'oled-sda',
      fromKey: 'arduino-uno:A4/SDA',
      toKey: 'oled-display:SDA',
      color: '#2f7df6'
    },
    {
      connectionId: 'oled-scl',
      fromKey: 'arduino-uno:A5/SCL',
      toKey: 'oled-display:SCL',
      color: '#f6c44c'
    },
    {
      connectionId: 'oled-power',
      fromKey: 'arduino-uno:5V',
      toKey: 'oled-display:VCC',
      color: '#ff4d3d'
    },
    {
      connectionId: 'oled-ground',
      fromKey: 'arduino-uno:GND',
      toKey: 'oled-display:GND',
      color: '#20242a'
    }
  ];

  const animated = stageAnimatedWireDescriptors(circuit, wires);

  assert.deepEqual(animated.map((wire) => wire.connectionId), ['oled-power']);
  assert.equal(animated[0].pathDescriptor.id, 'oled-module-current');
  assert.equal(animated[0].pathDescriptor.style.color, CURRENT_PATH_STYLES['supply-current'].color);
});

test('stage current animation does not animate unrelated wires when a valid path is present', () => {
  const circuit = {
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'led-forward-current',
          kind: 'load-current',
          from: 'arduino-uno:D9',
          through: ['resistor-1', 'led-1'],
          to: 'arduino-uno:GND',
          label: 'LED forward current'
        }
      ]
    }
  };
  const wires = [
    {
      connectionId: 'buzzer-signal',
      fromKey: 'arduino-uno:D8',
      toKey: 'buzzer-1:SIG',
      color: '#2f7df6'
    },
    {
      connectionId: 'd9-to-resistor',
      fromKey: 'arduino-uno:D9',
      toKey: 'resistor-1:1',
      color: '#2f7df6'
    },
    {
      connectionId: 'resistor-to-led',
      fromKey: 'resistor-1:2',
      toKey: 'led-1:A',
      color: '#2f7df6'
    },
    {
      connectionId: 'led-to-ground',
      fromKey: 'led-1:K',
      toKey: 'arduino-uno:GND',
      color: '#20242a'
    }
  ];

  const animated = stageAnimatedWireDescriptors(circuit, wires);

  assert.deepEqual(
    animated.map((wire) => wire.connectionId),
    ['d9-to-resistor', 'resistor-to-led', 'led-to-ground']
  );
});

test('stage current animation stays off when no simulation plan is present', () => {
  const animated = stageAnimatedWireDescriptors({}, [
    {
      connectionId: 'legacy-wire',
      fromKey: 'arduino-uno:D9',
      toKey: 'led-1:A',
      color: '#2f7df6'
    }
  ]);

  assert.deepEqual(animated, []);
});

test('stage current animation deduplicates duplicate parallel wires for one verified path edge', () => {
  const circuit = {
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'led-forward-current',
          kind: 'load-current',
          from: 'arduino-uno:D9',
          through: ['led-1'],
          to: 'arduino-uno:GND',
          connectionIds: ['parallel-b'],
          segments: [{
            connectionId: 'parallel-b',
            from: 'led-1:A',
            to: 'arduino-uno:D9'
          }],
          label: 'LED forward current'
        }
      ]
    }
  };
  const wires = [
    {
      connectionId: 'parallel-a',
      fromKey: 'arduino-uno:D9',
      toKey: 'led-1:A',
      color: '#2f7df6'
    },
    {
      connectionId: 'parallel-b',
      fromKey: 'led-1:A',
      toKey: 'arduino-uno:D9',
      color: '#84a9ff'
    }
  ];

  const animated = stageAnimatedWireDescriptors(circuit, wires);

  assert.deepEqual(animated.map((wire) => wire.connectionId), ['parallel-b']);
});

test('stage current animation ignores ambiguous plain breadboard through nodes', () => {
  const circuit = {
    simulationPlan: {
      status: 'valid',
      currentPaths: [
        {
          id: 'breadboard-ambiguous-path',
          kind: 'load-current',
          from: 'arduino-uno:5V',
          through: ['breadboard'],
          to: 'led-1:A',
          label: 'Ambiguous breadboard path'
        }
      ]
    }
  };
  const wires = [
    {
      connectionId: 'power-to-positive-rail',
      fromKey: 'arduino-uno:5V',
      toKey: 'breadboard:+ rail',
      color: '#ff4d3d'
    },
    {
      connectionId: 'negative-rail-to-led',
      fromKey: 'breadboard:- rail',
      toKey: 'led-1:A',
      color: '#20242a'
    }
  ];

  assert.deepEqual(stageAnimatedWireDescriptors(circuit, wires), []);
});
