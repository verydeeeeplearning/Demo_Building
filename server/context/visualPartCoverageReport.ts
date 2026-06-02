import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  auditVisualLibraryExpansion,
  type VisualLibraryContextPart,
  type VisualLibraryExpansionAudit
} from './contextLayer.ts';

export type VisualPartTargetState = 'simulation-ready' | 'unsafe-blocked';

export type CoverageWorkPackage = {
  id: string;
  title: string;
  topologyFamilies: string[];
};

export type VisualPartCoverageEntry = {
  visualPartId: string;
  visualPartName: string;
  visualCategory: string;
  family: string;
  riskLevel: VisualLibraryContextPart['riskLevel'];
  currentSupportTier: VisualLibraryContextPart['supportTier'];
  currentStatus: VisualLibraryContextPart['status'];
  targetState: VisualPartTargetState;
  workPackageId: string | null;
  workPackageTitle: string | null;
  achieved: boolean;
  remainingReason: string;
};

export type PackageProgress = {
  packageId: string;
  title: string;
  totalParts: number;
  achievedParts: number;
  remainingParts: number;
  targetSimulationReadyParts: number;
  targetUnsafeBlockedParts: number;
  percentComplete: number;
  families: string[];
  remainingPartIds: string[];
};

export type VisualPartCoverageReport = {
  version: string;
  generatedAt: string;
  totalVisualParts: number;
  explicitTargetStateCount: number;
  missingTargetStateIds: string[];
  missingWorkPackageIds: string[];
  achievedTargetCount: number;
  remainingTargetCount: number;
  visualOnlyCompatibilityCount: number;
  simulationReadyCount: number;
  unsafeBlockedCount: number;
  targetStateCounts: Record<VisualPartTargetState, number>;
  packageProgress: PackageProgress[];
  entries: VisualPartCoverageEntry[];
};

const GENERATED_AT = '2026-06-01';

export const COVERAGE_WORK_PACKAGES: CoverageWorkPackage[] = [
  {
    id: 'WP-01',
    title: 'Analog Sensor Display Generalization',
    topologyFamilies: ['sensor-analog', 'sensor-analog-digital']
  },
  {
    id: 'WP-02',
    title: 'Digital Sensor and Switch Generalization',
    topologyFamilies: ['human-input-digital', 'sensor-digital']
  },
  {
    id: 'WP-03',
    title: 'Matrix and Multi-Input',
    topologyFamilies: ['human-input-analog', 'matrix-or-multi-input']
  },
  {
    id: 'WP-04',
    title: 'Display Expansion',
    topologyFamilies: ['display', 'display-i2c', 'display-led-array', 'display-spi']
  },
  {
    id: 'WP-05',
    title: 'Light and Sound Outputs',
    topologyFamilies: ['light-output', 'sound-output']
  },
  {
    id: 'WP-06',
    title: 'Servo, Motor, Driver, Relay, High-Current',
    topologyFamilies: ['actuator-output', 'discrete-switch-ic', 'driver-ic', 'motor-or-inductive-output', 'relay-output', 'servo-output']
  },
  {
    id: 'WP-07',
    title: 'Power, Regulation, Protection, Passive Components',
    topologyFamilies: [
      'adjustable-passive',
      'capacitive-passive',
      'frequency-or-inductive-passive',
      'power-regulation-ic',
      'power-source-or-connector',
      'protection-passive',
      'resistive-passive'
    ]
  },
  {
    id: 'WP-08',
    title: 'Controller Board Expansion',
    topologyFamilies: ['controller-board']
  },
  {
    id: 'WP-09',
    title: 'Prototyping and Connector Surfaces',
    topologyFamilies: ['connector-wiring', 'prototyping-surface']
  },
  {
    id: 'WP-10',
    title: 'Sensor Protocol Modules',
    topologyFamilies: ['sensor', 'sensor-i2c-or-spi', 'sensor-serial']
  },
  {
    id: 'WP-11',
    title: 'Communication Modules',
    topologyFamilies: ['wired-communication', 'wireless-communication']
  },
  {
    id: 'WP-12',
    title: 'Logic, Interface, and IC Expansion',
    topologyFamilies: ['analog-interface-ic', 'level-shifter-interface', 'logic-or-interface-ic']
  }
];

const WORK_PACKAGES_BY_ID = new Map(COVERAGE_WORK_PACKAGES.map((pkg) => [pkg.id, pkg]));
const WORK_PACKAGE_BY_FAMILY = new Map(COVERAGE_WORK_PACKAGES.flatMap((pkg) =>
  pkg.topologyFamilies.map((family) => [family, pkg.id] as const)
));

export async function buildVisualPartCoverageReport(): Promise<VisualPartCoverageReport> {
  const audit = await auditVisualLibraryExpansion();
  const entries = audit.contextPartSummaries.map((part) => buildCoverageEntry(part));
  const packageProgress = buildPackageProgress(entries);
  const missingTargetStateIds = entries
    .filter((entry) => !entry.targetState)
    .map((entry) => entry.visualPartId)
    .sort();
  const missingWorkPackageIds = entries
    .filter((entry) => !entry.workPackageId)
    .map((entry) => entry.visualPartId)
    .sort();

  return {
    version: audit.version,
    generatedAt: GENERATED_AT,
    totalVisualParts: audit.totalVisualParts,
    explicitTargetStateCount: entries.length - missingTargetStateIds.length,
    missingTargetStateIds,
    missingWorkPackageIds,
    achievedTargetCount: entries.filter((entry) => entry.achieved).length,
    remainingTargetCount: entries.filter((entry) => !entry.achieved).length,
    visualOnlyCompatibilityCount: audit.visualOnlyPartIds.length,
    simulationReadyCount: audit.bySupportTier['simulation-ready'],
    unsafeBlockedCount: audit.bySupportTier['unsafe-blocked'],
    targetStateCounts: countTargetStates(entries),
    packageProgress,
    entries
  };
}

export async function writeVisualPartCoverageMarkdown(outputPath: string): Promise<VisualPartCoverageReport> {
  const report = await buildVisualPartCoverageReport();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderVisualPartCoverageMarkdown(report), 'utf8');
  return report;
}

export function assertVisualPartCoverageTargets(report: VisualPartCoverageReport): void {
  const problems = [
    ...report.missingTargetStateIds.map((id) => `missing target state: ${id}`),
    ...report.missingWorkPackageIds.map((id) => `missing work package: ${id}`)
  ];

  if (problems.length > 0) {
    throw new Error(`Visual part coverage target audit failed:\n${problems.join('\n')}`);
  }
}

export function renderVisualPartCoverageMarkdown(report: VisualPartCoverageReport): string {
  const packageRows = report.packageProgress.map((pkg) =>
    `| ${pkg.packageId} | ${pkg.title} | ${pkg.achievedParts}/${pkg.totalParts} | ${pkg.remainingParts} | ${pkg.percentComplete}% | ${pkg.remainingPartIds.slice(0, 10).join(', ') || '-'} |`
  ).join('\n');
  const entryRows = report.entries.map((entry) =>
    `| ${entry.achieved ? 'x' : ' '} | ${entry.workPackageId ?? 'UNASSIGNED'} | ${entry.visualPartId} | ${entry.family} | ${entry.riskLevel} | ${entry.currentSupportTier} | ${entry.targetState} | ${entry.remainingReason} |`
  ).join('\n');

  return `# Visual Part Simulation Coverage Report

Generated: ${report.generatedAt}

This file is generated from the visual library, context crosswalk, and coverage target classifier. Update the source contracts, then regenerate this file rather than hand-editing rows.

## Snapshot

- Total visual parts: ${report.totalVisualParts}
- Explicit target states: ${report.explicitTargetStateCount}/${report.totalVisualParts}
- Current simulation-ready parts: ${report.simulationReadyCount}
- Current unsafe-blocked parts: ${report.unsafeBlockedCount}
- Target achieved parts: ${report.achievedTargetCount}
- Remaining target parts: ${report.remainingTargetCount}
- Legacy visual-only compatibility count: ${report.visualOnlyCompatibilityCount}
- Missing target state ids: ${report.missingTargetStateIds.join(', ') || 'none'}
- Missing work package ids: ${report.missingWorkPackageIds.join(', ') || 'none'}

## Target State Counts

| Target state | Count |
| --- | ---: |
| simulation-ready | ${report.targetStateCounts['simulation-ready']} |
| unsafe-blocked | ${report.targetStateCounts['unsafe-blocked']} |

## Package Progress

| Package | Title | Achieved | Remaining | Complete | Next remaining ids |
| --- | --- | ---: | ---: | ---: | --- |
${packageRows}

## Part Rows

| Done | Package | Visual part | Family | Risk | Current tier | Target | Remaining reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
${entryRows}
`;
}

function buildCoverageEntry(part: VisualLibraryContextPart): VisualPartCoverageEntry {
  const targetState = targetStateForPart(part);
  const workPackageId = packageIdForPart(part);
  const workPackage = workPackageId ? WORK_PACKAGES_BY_ID.get(workPackageId) ?? null : null;
  const achieved = targetState === 'simulation-ready'
    ? part.supportTier === 'simulation-ready'
    : part.supportTier === 'unsafe-blocked';

  return {
    visualPartId: part.visualPartId,
    visualPartName: part.visualPartName,
    visualCategory: part.visualCategory,
    family: part.family,
    riskLevel: part.riskLevel,
    currentSupportTier: part.supportTier,
    currentStatus: part.status,
    targetState,
    workPackageId,
    workPackageTitle: workPackage?.title ?? null,
    achieved,
    remainingReason: achieved ? 'target achieved' : remainingReason(part, targetState)
  };
}

function buildPackageProgress(entries: VisualPartCoverageEntry[]): PackageProgress[] {
  return COVERAGE_WORK_PACKAGES.map((pkg) => {
    const packageEntries = entries.filter((entry) => entry.workPackageId === pkg.id);
    const achievedParts = packageEntries.filter((entry) => entry.achieved).length;
    const totalParts = packageEntries.length;
    return {
      packageId: pkg.id,
      title: pkg.title,
      totalParts,
      achievedParts,
      remainingParts: totalParts - achievedParts,
      targetSimulationReadyParts: packageEntries.filter((entry) => entry.targetState === 'simulation-ready').length,
      targetUnsafeBlockedParts: packageEntries.filter((entry) => entry.targetState === 'unsafe-blocked').length,
      percentComplete: totalParts === 0 ? 100 : Math.round((achievedParts / totalParts) * 100),
      families: [...new Set(packageEntries.map((entry) => entry.family))].sort(),
      remainingPartIds: packageEntries
        .filter((entry) => !entry.achieved)
        .map((entry) => entry.visualPartId)
        .sort()
    };
  });
}

function targetStateForPart(part: VisualLibraryContextPart): VisualPartTargetState {
  return part.riskLevel === 'mains-unsafe' ? 'unsafe-blocked' : 'simulation-ready';
}

function packageIdForPart(part: VisualLibraryContextPart): string | null {
  return WORK_PACKAGE_BY_FAMILY.get(part.family) ?? null;
}

function remainingReason(part: VisualLibraryContextPart, targetState: VisualPartTargetState): string {
  if (targetState === 'unsafe-blocked') {
    return `${part.visualPartName} needs deterministic unsafe refusal coverage.`;
  }
  return `${part.visualPartName} needs source claims, capability contract, footprint, topology, validator, and simulation path contracts.`;
}

function countTargetStates(entries: VisualPartCoverageEntry[]): Record<VisualPartTargetState, number> {
  return entries.reduce((counts, entry) => {
    counts[entry.targetState] += 1;
    return counts;
  }, {
    'simulation-ready': 0,
    'unsafe-blocked': 0
  });
}
