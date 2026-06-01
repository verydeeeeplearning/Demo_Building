import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import {
  loadContextIndex,
  readContextDoc,
  resolveContextSourceId,
  searchPartCapabilities,
  type ContextEntry,
  type ContextIndex
} from '../context/contextLayer.ts';
import {
  applyCandidatePartGate,
  applyContextCoverageGate,
  buildNetlist,
  compileRenderPlan,
  compileRequirementMarkdown,
  compileSimulationPlan,
  detectFaults,
  estimateCurrentPaths,
  validateCircuitSpec
} from './circuitTools.ts';
import {
  CircuitSpecSchema,
  NetlistSchema,
  ValidationReportSchema,
  type CircuitSpec,
  type ContextCoverageReport,
  type PartCapability,
  type ValidationReport
} from './schemas.ts';

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const SpecInputSchema = z.object({
  spec: CircuitSpecSchema
});

const NetlistInputSchema = z.object({
  spec: CircuitSpecSchema,
  netlist: NetlistSchema.optional(),
  validationReport: ValidationReportSchema.optional()
});

const SearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).default(8)
});

type HeduwareAgentToolOptions = {
  contextCoverage?: ContextCoverageReport;
  candidateParts?: PartCapability[];
  allowedContextSourceIds?: string[];
};

export function createHeduwareAgentTools(options: HeduwareAgentToolOptions = {}) {
  const validateWithContext = async (spec: CircuitSpec): Promise<ValidationReport> => {
    const validationReport = applyCandidatePartGate(await validateCircuitSpec(spec), spec, options.candidateParts);
    return options.contextCoverage
      ? applyContextCoverageGate(validationReport, options.contextCoverage)
      : validationReport;
  };

  return [
    tool(
      async () => asJson(await loadContextIndex()),
      {
        name: 'load_context_index',
        description: 'Load the H-eduware context-layer index. Use this before reading detailed context docs.',
        schema: z.object({})
      }
    ),
    tool(
      async ({ id }) => await readContextDocBounded(id, options),
      {
        name: 'read_context_doc',
        description: 'Read one context-layer document only when it is selected by the current retrieval plan, such as safety-policy, validation-rules, or simulation-recipes.',
        schema: z.object({ id: z.string().min(1) })
      }
    ),
    tool(
      async ({ query, limit }) => asJson((await searchContextBoundPartCapabilities(query, options)).slice(0, limit)),
      {
        name: 'search_part_capabilities',
        description: 'Search only the canonical part capabilities allowed by the current context packet. Use returned ids, pins, limits, protocols, and simulation models exactly.',
        schema: SearchInputSchema
      }
    ),
    tool(
      async ({ spec }) => asJson(await validateWithContext(spec)),
      {
        name: 'validate_circuit_spec',
        description: 'Authoritatively validate a CircuitSpec with the current context coverage gate. A circuit may be rendered or simulated only when this returns status valid.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec }) => {
        const validationReport = await validateWithContext(spec);
        if (validationReport.status !== 'valid') {
          return asJson({
            error: 'NETLIST_BLOCKED_BY_VALIDATION',
            validationReport,
            netlist: { nets: [] }
          });
        }
        return asJson(await buildNetlist(spec));
      },
      {
        name: 'build_netlist',
        description: 'Build a simple netlist only after authoritative server validation. Invalid, unsupported, or context-disallowed specs return NETLIST_BLOCKED_BY_VALIDATION with an empty netlist.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec, netlist }) => {
        const resolvedValidation = await validateWithContext(spec);
        const resolvedNetlist = netlist ?? await buildNetlist(spec);
        return asJson(await estimateCurrentPaths(spec, resolvedNetlist, resolvedValidation));
      },
      {
        name: 'estimate_current_paths',
        description: 'Estimate educational current paths from an authoritatively validated netlist. Caller-supplied validation reports are not trusted; returns no paths unless server validation is valid.',
        schema: NetlistInputSchema
      }
    ),
    tool(
      async ({ spec }) => {
        const report = applyCandidatePartGate(
          await detectFaults(spec, await buildNetlist(spec)),
          spec,
          options.candidateParts
        );
        return asJson(options.contextCoverage ? applyContextCoverageGate(report, options.contextCoverage) : report);
      },
      {
        name: 'detect_faults',
        description: 'Detect shorts, missing current limiting, missing grounds, and unsupported/simulation-blocking faults.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec }) => {
        const validationReport = await validateWithContext(spec);
        return asJson(await compileRenderPlan(spec, validationReport));
      },
      {
        name: 'compile_render_plan',
        description: 'Compile a RenderPlan from a valid CircuitSpec. Invalid or unsupported specs produce an empty render plan.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec }) => asJson(await compileSimulationArtifacts(spec, options).then((artifacts) => artifacts.simulationPlan)),
      {
        name: 'compile_simulation_plan',
        description: 'Compile a SimulationPlan from a CircuitSpec using validated netlist and current paths.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec }) => asJson(await compileSimulationArtifacts(spec, options).then((artifacts) => artifacts.requirementMarkdown)),
      {
        name: 'compile_requirement_markdown',
        description: 'Compile the student-readable Markdown requirement document from validated circuit artifacts.',
        schema: SpecInputSchema
      }
    )
  ];
}

async function readContextDocBounded(id: string, options: HeduwareAgentToolOptions) {
  if (!options.allowedContextSourceIds) {
    return readContextDoc(id);
  }

  const index = await loadContextIndex();
  const requestedEntry = findContextEntry(index, id);
  const allowedEntries = options.allowedContextSourceIds
    .map((sourceId) => findContextEntry(index, sourceId))
    .filter((entry): entry is ContextEntry => Boolean(entry));
  const allowedKeys = new Set(allowedEntries.flatMap((entry) => entryKeys(entry)));
  const requestedAllowed = requestedEntry
    ? entryKeys(requestedEntry).some((key) => allowedKeys.has(key))
    : options.allowedContextSourceIds.includes(id);

  if (!requestedAllowed || !requestedEntry) {
    return asJson({
      error: 'CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN',
      requestedId: id,
      allowedSourceIds: options.allowedContextSourceIds
    });
  }

  return readContextDoc(requestedEntry.id);
}

function findContextEntry(index: ContextIndex, id: string): ContextEntry | null {
  return allContextEntries(index).find((entry) => entry.id === id) ?? resolveContextSourceId(id, index);
}

function allContextEntries(index: ContextIndex): ContextEntry[] {
  return [...index.memory, ...index.skills, ...index.references, ...index.data, ...index.routing];
}

function entryKeys(entry: ContextEntry) {
  return [entry.id, entry.sourceId, ...entry.aliases];
}

async function searchContextBoundPartCapabilities(query: string, options: HeduwareAgentToolOptions) {
  const matches = await searchPartCapabilities(query);
  if (!options.candidateParts) {
    return matches;
  }

  const candidateIds = new Set(options.candidateParts.map((part) => part.id));
  const candidateById = new Map(options.candidateParts.map((part) => [part.id, part]));
  return matches
    .filter((part) => candidateIds.has(part.id))
    .map((part) => candidateById.get(part.id) ?? part);
}

async function compileSimulationArtifacts(spec: CircuitSpec, options: HeduwareAgentToolOptions = {}) {
  const rawValidationReport: ValidationReport = applyCandidatePartGate(
    await validateCircuitSpec(spec),
    spec,
    options.candidateParts
  );
  const validationReport = options.contextCoverage
    ? applyContextCoverageGate(rawValidationReport, options.contextCoverage)
    : rawValidationReport;
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const requirementMarkdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan);
  return { validationReport, netlist, currentPaths, renderPlan, simulationPlan, requirementMarkdown };
}
