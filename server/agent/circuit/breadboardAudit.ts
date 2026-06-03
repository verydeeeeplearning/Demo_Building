// breadboardAudit.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import { loadBreadboardGrid } from '../../context/contextLayer.ts';
import { type RenderPlan } from '../schemas.ts';
import {
  RenderWarning,
  nearestGridValue,
  renderEndpointKey,
  requiresStrictBreadboardGridAudit
} from './shared.ts';

export function auditBreadboardPinTopology(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const minRowSeparation = 0.12;

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !requiresStrictBreadboardGridAudit(footprint)
    ) {
      continue;
    }

    const pinRows = Object.values(footprint.pinAnchors).map((anchor) => part.position.z + anchor.z);
    if (pinRows.length < 2) {
      continue;
    }

    const minRow = Math.min(...pinRows);
    const maxRow = Math.max(...pinRows);
    if (maxRow - minRow < minRowSeparation) {
      warnings.push({
        code: 'BREADBOARD_PIN_ROW_COLLAPSE',
        componentId: part.id,
        message: `${part.label} has multiple terminals on the same breadboard row; separate pins across distinct rows before trusting the physical layout.`
      });
    }
  }

  return warnings;
}

export function auditBreadboardGridSnap(
  renderParts: RenderPlan['parts'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !requiresStrictBreadboardGridAudit(footprint)
    ) {
      continue;
    }

    for (const [pinName, anchor] of Object.entries(footprint.pinAnchors)) {
      const endpoint = {
        x: part.position.x + anchor.x,
        y: part.position.y + anchor.y,
        z: part.position.z + anchor.z
      };

      if (!pointSnapsToSignalGrid(endpoint, grid)) {
        warnings.push({
          code: 'BREADBOARD_PIN_GRID_MISALIGNMENT',
          componentId: part.id,
          message: `${part.label} pin ${pinName} is not aligned to the breadboard hole grid, so the physical placement cannot be trusted.`
        });
        break;
      }
    }
  }

  return warnings;
}

export function auditBreadboardPhysicalNodeConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByNode = new Map<string, Array<{ key: string; partId: string; pin: string }>>();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !requiresStrictBreadboardGridAudit(footprint)
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const nodeId = physicalSignalNodeId(
        {
          x: part.position.x + anchor.x,
          z: part.position.z + anchor.z
        },
        grid
      );
      if (!nodeId) {
        continue;
      }
      const entries = endpointsByNode.get(nodeId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin });
      endpointsByNode.set(nodeId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [nodeId, endpoints] of endpointsByNode.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_PHYSICAL_NODE_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same physical breadboard node (${nodeId}) without a logical connection.`
    });
  }

  return warnings;
}

export function auditBreadboardContinuityConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByContinuityGroup = new Map<
    string,
    Array<{
      key: string;
      partId: string;
      pin: string;
      holeId: string;
    }>
  >();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !requiresStrictBreadboardGridAudit(footprint)
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const point = {
        x: part.position.x + anchor.x,
        z: part.position.z + anchor.z
      };
      const continuityId = physicalSignalContinuityId(point, grid);
      const holeId = physicalSignalNodeId(point, grid);
      if (!continuityId || !holeId) {
        continue;
      }
      const entries = endpointsByContinuityGroup.get(continuityId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin, holeId });
      endpointsByContinuityGroup.set(continuityId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [continuityId, endpoints] of endpointsByContinuityGroup.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedContinuityPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_CONTINUITY_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same breadboard continuity group (${continuityId}) without a logical connection.`
    });
  }

  return warnings;
}

export function auditBreadboardRailConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByRail = new Map<
    string,
    Array<{
      key: string;
      partId: string;
      pin: string;
      holeId: string;
    }>
  >();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !requiresStrictBreadboardGridAudit(footprint)
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const point = {
        x: part.position.x + anchor.x,
        z: part.position.z + anchor.z
      };
      const continuityId = physicalRailContinuityId(point, grid);
      const holeId = physicalRailNodeId(point, grid);
      if (!continuityId || !holeId) {
        continue;
      }
      const entries = endpointsByRail.get(continuityId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin, holeId });
      endpointsByRail.set(continuityId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [railId, endpoints] of endpointsByRail.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedContinuityPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_RAIL_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same breadboard rail (${railId}) without a logical connection.`
    });
  }

  return warnings;
}

export function pointSnapsToSignalGrid(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(
    point.x,
    grid.signalArea.xStart,
    grid.signalArea.xEnd,
    grid.signalArea.xPitch
  );
  const nearestRow = nearestSignalRow(point.z, grid);

  return (
    Math.abs(point.x - nearestX) <= grid.signalArea.snapTolerance.x &&
    Math.abs(point.z - nearestRow.z) <= grid.signalArea.snapTolerance.z
  );
}

export function physicalSignalNodeId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(
    point.x,
    grid.signalArea.xStart,
    grid.signalArea.xEnd,
    grid.signalArea.xPitch
  );
  const nearestRow = nearestSignalRow(point.z, grid);
  if (
    Math.abs(point.x - nearestX) > grid.signalArea.snapTolerance.x ||
    Math.abs(point.z - nearestRow.z) > grid.signalArea.snapTolerance.z
  ) {
    return null;
  }

  return `signal:${nearestX.toFixed(2)}:${nearestRow.id}`;
}

export function physicalSignalContinuityId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(
    point.x,
    grid.signalArea.xStart,
    grid.signalArea.xEnd,
    grid.signalArea.xPitch
  );
  const nearestRow = nearestSignalRow(point.z, grid);
  if (
    Math.abs(point.x - nearestX) > grid.signalArea.snapTolerance.x ||
    Math.abs(point.z - nearestRow.z) > grid.signalArea.snapTolerance.z
  ) {
    return null;
  }

  return `signal-continuity:${signalBankForRow(nearestRow.id)}:${nearestX.toFixed(2)}`;
}

export function signalBankForRow(rowId: string) {
  if (rowId.startsWith('upper')) {
    return 'upper-bank';
  }
  if (rowId.startsWith('lower')) {
    return 'lower-bank';
  }
  return rowId;
}

export function physicalRailNodeId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearest = nearestRailHole(point, grid);
  if (!nearest) {
    return null;
  }

  return `rail:${nearest.x.toFixed(2)}:${nearest.id}`;
}

export function physicalRailContinuityId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearest = nearestRailHole(point, grid);
  if (!nearest) {
    return null;
  }

  return `rail-continuity:${nearest.id}`;
}

export function nearestRailHole(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestRail = grid.rails
    .map((rail) => ({ rail, distance: Math.abs(point.z - rail.z) }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearestRail) {
    return null;
  }

  const nearestX = nearestGridValue(
    point.x,
    nearestRail.rail.xStart,
    nearestRail.rail.xEnd,
    nearestRail.rail.xPitch
  );
  if (
    Math.abs(point.x - nearestX) > nearestRail.rail.snapTolerance.x ||
    Math.abs(point.z - nearestRail.rail.z) > nearestRail.rail.snapTolerance.z
  ) {
    return null;
  }

  return {
    id: nearestRail.rail.id,
    role: nearestRail.rail.role,
    x: nearestX,
    z: nearestRail.rail.z
  };
}

export function nearestSignalRow(z: number, grid: Awaited<ReturnType<typeof loadBreadboardGrid>>) {
  type SignalRowMatch = {
    distance: number;
    z: number;
    id: string;
    continuityGroup: string;
  };

  return grid.signalArea.rows.reduce<SignalRowMatch>(
    (best, row) => {
      const distance = Math.abs(z - row.z);
      return distance < best.distance
        ? { distance, z: row.z, id: row.id, continuityGroup: row.continuityGroup }
        : best;
    },
    { distance: Number.POSITIVE_INFINITY, z: 0, id: 'unknown', continuityGroup: 'unknown' }
  );
}

export function buildLogicalConnectionGraph(connections: RenderPlan['connections']) {
  const graph = new Map<string, Set<string>>();
  for (const connection of connections) {
    const fromKey = renderEndpointKey(connection.from);
    const toKey = renderEndpointKey(connection.to);
    addGraphEdge(graph, fromKey, toKey);
    addGraphEdge(graph, toKey, fromKey);
  }
  return graph;
}

export function addGraphEdge(graph: Map<string, Set<string>>, from: string, to: string) {
  const edges = graph.get(from) ?? new Set<string>();
  edges.add(to);
  graph.set(from, edges);
}

export function firstUnconnectedPair(
  endpoints: Array<{ key: string; partId: string; pin: string }>,
  graph: Map<string, Set<string>>
) {
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (!logicalEndpointsConnected(endpoints[i].key, endpoints[j].key, graph)) {
        return { left: endpoints[i], right: endpoints[j] };
      }
    }
  }
  return null;
}

export function firstUnconnectedContinuityPair(
  endpoints: Array<{ key: string; partId: string; pin: string; holeId: string }>,
  graph: Map<string, Set<string>>
) {
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (endpoints[i].holeId === endpoints[j].holeId) {
        continue;
      }
      if (!logicalEndpointsConnected(endpoints[i].key, endpoints[j].key, graph)) {
        return { left: endpoints[i], right: endpoints[j] };
      }
    }
  }
  return null;
}

export function logicalEndpointsConnected(
  left: string,
  right: string,
  graph: Map<string, Set<string>>
) {
  if (left === right) {
    return true;
  }

  const visited = new Set<string>([left]);
  const queue = [left];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }
    for (const next of graph.get(key) ?? []) {
      if (next === right) {
        return true;
      }
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return false;
}
