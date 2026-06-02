import type { PartCapability, TopologyTemplate } from '../agent/schemas.ts';

// L2 — Topology Composition (Layered Context Architecture, Phase 2a).
//
// PURE domain layer: no file I/O, no loaders. Given a role-based topology
// template (`requiredRoles` + `fromRole`/`toNet` connections) and a set of
// parts assigned to its slot roles, generate a concrete netlist — mapping each
// abstract `<slotRole>.<pinRole>` endpoint onto a real pin of the assigned
// part. This is what lets ANY legal combination of parts be wired without a
// pre-curated bundle.
//
// Gaps are never silent: an unfilled slot or an assigned part missing a
// required pin role is surfaced as an explicit `blockingConditions` entry, and
// the composition is marked `complete: false` (→ review-only downstream).

export type SlotAssignments = Map<string, PartCapability>;

export type ComposedEndpoint = {
  componentId: string;
  partId: string;
  pin: string;
  pinRole: string;
  slotRole: string;
};

export type ComposedNet = {
  id: string;
  kind: 'power' | 'ground' | 'signal' | 'mixed';
  endpoints: ComposedEndpoint[];
};

export type ComposedTopology = {
  topologyId: string;
  nets: ComposedNet[];
  blockingConditions: string[];
  complete: boolean;
};

// A topology slot role like "controller.power" splits into the part slot
// ("controller") and the pin role ("power"). The set of part slots a topology
// actually needs is DERIVED from its connections (the token before the dot),
// so requiredRoles never has to be hand-classified into part vs pin roles.
export function topologySlotRoles(template: TopologyTemplate): string[] {
  const slots = new Set<string>();
  for (const connection of template.connections) {
    slots.add(connection.fromRole.split('.')[0]);
  }
  return [...slots].sort();
}

function findPinForRole(part: PartCapability, pinRole: string) {
  return part.pins.find(
    (pin) => pin.role === pinRole || pin.aliases.includes(pinRole)
  );
}

export function composeTopology(
  template: TopologyTemplate,
  assignments: SlotAssignments
): ComposedTopology {
  const blocking = new Set<string>();
  const netsById = new Map<string, ComposedNet>(
    template.nets.map((net) => [net.id, { id: net.id, kind: net.kind, endpoints: [] }])
  );

  for (const connection of template.connections) {
    const [slotRole, pinRole] = connection.fromRole.split('.');
    const part = assignments.get(slotRole);
    if (!part) {
      blocking.add(`unresolved-slot-role:${slotRole}`);
      continue;
    }
    const pin = findPinForRole(part, pinRole);
    if (!pin) {
      blocking.add(`unresolved-pin-role:${slotRole}.${pinRole}`);
      continue;
    }
    const net = netsById.get(connection.toNet);
    if (!net) {
      blocking.add(`unknown-net:${connection.toNet}`);
      continue;
    }
    net.endpoints.push({
      componentId: slotRole,
      partId: part.id,
      pin: pin.name,
      pinRole,
      slotRole
    });
  }

  return {
    topologyId: template.id,
    nets: [...netsById.values()],
    blockingConditions: [...blocking].sort(),
    complete: blocking.size === 0
  };
}

// L1 (first batch) — does a part fill a topology slot role? Reuses the existing
// capability vocabulary (see circuitTools modality predicates). Coverage is
// intentionally partial: uncovered slot roles resolve to no part and surface as
// `unresolved-slot-role`, to be expanded toward the Phase 2c golden target.
export function partFillsSlotRole(part: PartCapability, slotRole: string): boolean {
  const caps = new Set(part.capabilities);
  const protocols = new Set(part.protocols);
  const id = part.id;

  switch (slotRole) {
    case 'controller':
    case 'controller-board':
      return part.kind === 'controller';
    case 'power-source':
      return part.kind === 'power'
        || caps.has('power-source')
        || caps.has('5v-power-source')
        || caps.has('3v3-power-source');
    case 'power-rail':
    case 'ground-rail':
    case 'prototyping-surface':
      return part.kind === 'board';
    case 'i2c-module':
      return caps.has('i2c-peripheral') || caps.has('i2c-module');
    case 'spi-display':
      return caps.has('spi-display');
    case 'analog-sensor':
    case 'resistive-sensor':
      return caps.has('analog-sensor')
        || caps.has('resistive-sensor')
        || caps.has('light-sensor')
        || (part.kind === 'input' && protocols.has('analog-input') && caps.has('threshold-input'));
    case 'distance-sensor':
      return caps.has('distance-sensor') || id.includes('hc-sr04') || id.includes('ultrasonic');
    case 'series-current-limit':
    case 'base-resistor':
      return caps.has('current-limiting-passive') || caps.has('series-passive');
    case 'dc-load':
    case 'direct-low-current-load':
    case 'powered-light-output':
      return part.kind === 'output'
        && (caps.has('digital-output-load') || caps.has('visual-indicator') || caps.has('powered-light-module'));
    case 'switch-input':
    case 'digital-input-source':
      return id === 'button-tactile' || caps.has('digital-input-switch');
    // --- Phase 2c coverage expansion (capability strings verified against the
    // intended filler parts in each bundle's allowedParts) ---
    case 'communication-module':
      return caps.has('communication-module');
    case 'protocol-sensor':
      return caps.has('protocol-sensor');
    case 'single-wire-data-sensor':
      return caps.has('single-wire-data-sensor');
    case 'pulse-digital-sensor':
      return caps.has('pulse-digital-sensor') || caps.has('digital-sensor');
    case 'voltage-divider':
      return caps.has('voltage-divider') || caps.has('current-limiting-passive') || caps.has('series-passive');
    case 'voltage-divider-reference':
      return caps.has('current-limiting-passive') || caps.has('series-passive') || caps.has('voltage-divider');
    case 'voltage-regulator':
      return caps.has('voltage-regulator') || caps.has('regulated-power-output');
    case 'passive-context-part':
      return caps.has('passive-context-part');
    case 'timing-passive-context':
      return caps.has('timing-passive-context');
    case 'relay-contact-load':
      return caps.has('low-voltage-contact-load') || caps.has('relay-contact-load');
    case 'unipolar-stepper':
      return caps.has('unipolar-stepper');
    case 'bipolar-stepper':
      return caps.has('bipolar-stepper');
    case 'low-side-driver':
      return caps.has('low-side-switch-driver') || caps.has('mosfet-module-driver');
    case 'inductive-load':
      return caps.has('inductive-load') || caps.has('relay-module') || id.includes('solenoid');
    case 'dc-motor-load':
      return caps.has('dc-motor') || caps.has('dc-motor-load') || id.includes('dc-motor');
    case 'pwm-actuator':
      return caps.has('pwm-controlled-actuator') || caps.has('motion-output');
    case 'stepper-driver':
      return caps.has('stepper-driver');
    case 'hbridge-driver':
      return caps.has('hbridge-driver');
    case 'addressable-led-display':
      return caps.has('addressable-led-display');
    case 'bare-seven-segment-display':
      return caps.has('bare-seven-segment-display');
    case 'led-array-display':
      return caps.has('led-array-display');
    case 'multi-channel-light-output':
      return part.kind === 'output'
        && (caps.has('digital-output-load') || caps.has('visual-indicator') || caps.has('powered-light-module'));
    case 'joystick-input':
      return caps.has('joystick-input-source') || caps.has('joystick');
    case 'matrix-input':
      return caps.has('matrix-input') || id.includes('keypad');
    case 'rotary-encoder':
    case 'quadrature-input':
      return caps.has('rotary-encoder-source') || caps.has('quadrature-input-source') || caps.has('rotary-encoder');
    case 'relay-module':
      return caps.has('relay-module');
    case 'level-shifter':
      return caps.has('level-shifter');
    case 'logic-interface':
      return caps.has('logic-interface') || caps.has('shift-register');
    case 'connector-wiring':
      return part.kind === 'wiring' || caps.has('connector-wiring') || caps.has('electrical-connection');
    default:
      return false;
  }
}

// Best-effort, deterministic slot→part resolution from a candidate set. Picks
// the first (id-sorted) candidate that fills each derived slot role; unfilled
// slots are reported, not silently dropped.
export function resolveSlotAssignments(
  template: TopologyTemplate,
  candidateParts: PartCapability[]
): { assignments: SlotAssignments; unresolvedSlots: string[] } {
  const sorted = [...candidateParts].sort((a, b) => a.id.localeCompare(b.id));
  const assignments: SlotAssignments = new Map();
  const unresolvedSlots: string[] = [];

  for (const slotRole of topologySlotRoles(template)) {
    const part = sorted.find((candidate) => partFillsSlotRole(candidate, slotRole));
    if (part) {
      assignments.set(slotRole, part);
    } else {
      unresolvedSlots.push(slotRole);
    }
  }

  return { assignments, unresolvedSlots };
}
