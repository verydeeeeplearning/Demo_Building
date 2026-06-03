// netlist.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import { getPartRegistry } from '../../context/contextLayer.ts';
import {
  type CircuitSpec,
  type Netlist,
  NetlistSchema,
  type PartCapability,
  type ValidationReport,
  ValidationReportSchema
} from '../schemas.ts';
import { isGroundRole, isPowerRole, roleFor } from './shared.ts';
import { validateCircuitSpec } from './validation.ts';

export async function buildNetlist(spec: CircuitSpec): Promise<Netlist> {
  const parts = await getPartRegistry();
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const nets = spec.connections.map((connection) => {
    const endpoints = [
      `${connection.from.componentId}:${connection.from.pin}`,
      `${connection.to.componentId}:${connection.to.pin}`
    ];
    return {
      id: connection.id,
      kind: netKind(connection, componentsById, partsById),
      endpoints
    };
  });

  return NetlistSchema.parse({ nets });
}

export async function detectFaults(spec: CircuitSpec, netlist: Netlist): Promise<ValidationReport> {
  const report = await validateCircuitSpec(spec);
  if (report.status !== 'valid') {
    return report;
  }

  const mixedNets = netlist.nets.filter((net) => net.kind === 'mixed');
  if (mixedNets.length > 0) {
    return ValidationReportSchema.parse({
      status: 'invalid',
      errors: mixedNets.map((net) => `DIRECT_POWER_SHORT: ${net.id} mixes power and ground.`),
      warnings: report.warnings,
      validatedCurrentPathIds: []
    });
  }

  return report;
}

export function netKind(
  connection: CircuitSpec['connections'][number],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const roles = [
    roleFor(connection.from, componentsById, partsById),
    roleFor(connection.to, componentsById, partsById)
  ];
  if (roles.some(isPowerRole) && roles.some(isGroundRole)) return 'mixed';
  if (roles.every(isGroundRole)) return 'ground';
  if (roles.some(isPowerRole)) return 'power';
  if (roles.some((role) => role.includes('output'))) return 'power';
  return 'signal';
}
