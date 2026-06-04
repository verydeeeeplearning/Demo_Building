import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';

import { narrowOptions } from './slotPolicy.ts';

import {
  loadContextBundleV2,
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
  buildRunnableReport,
  buildNetlist,
  buildSolverGateResult,
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
  type AgentConversationContext,
  type CircuitSpec,
  type ContextCoverageReport,
  type PartCapability,
  type SupportBundleEvidence,
  type ValidationReport
} from './schemas.ts';
import type { RequestScope } from './requestScope.ts';

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

export type ScopedHeduwareAgentToolOptions = {
  contextCoverage: ContextCoverageReport;
  candidateParts: PartCapability[];
  allowedContextSourceIds: string[];
  supportBundles: SupportBundleEvidence[];
  requestScope?: RequestScope;
  locale?: 'ko' | 'en';
  conversationContext?: AgentConversationContext;
};

type InternalToolOptions = ScopedHeduwareAgentToolOptions & {
  allowUnscopedContext: boolean;
};

export function createHeduwareAgentTools(options: ScopedHeduwareAgentToolOptions) {
  if (
    !options
    || !options.contextCoverage
    || !Array.isArray(options.candidateParts)
    || !Array.isArray(options.allowedContextSourceIds)
    || !Array.isArray(options.supportBundles)
  ) {
    throw new Error('SCOPED_TOOL_OPTIONS_REQUIRED: live H-eduware tools require contextCoverage, candidateParts, allowedContextSourceIds, and supportBundles.');
  }
  return createTools({ ...options, allowUnscopedContext: false });
}

export function createUnscopedHeduwareAgentToolsForTests() {
  return createTools({
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      sufficientFor: ['valid_circuit_synthesis'],
      synthesisEligibility: {
        status: 'eligible',
        reason: 'Explicit test-only unscoped tool construction.'
      },
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: []
    },
    candidateParts: [],
    allowedContextSourceIds: [],
    supportBundles: [],
    allowUnscopedContext: true
  });
}

function createTools(options: InternalToolOptions) {
  const validateWithContext = async (spec: CircuitSpec): Promise<ValidationReport> => {
    const validationReport = applyScopedCandidatePartGate(await validateCircuitSpec(spec), spec, options);
    return applyContextCoverageGate(validationReport, options.contextCoverage);
  };
  const buildEligible = options.requestScope?.buildEligible
    ?? options.contextCoverage.synthesisEligibility.status === 'eligible';

  return [
    tool(
      async ({ level }) => {
        if (buildEligible) {
          return asJson({
            error: 'CLARIFICATION_BLOCKED_BUILD_ELIGIBLE',
            route: options.requestScope?.route ?? 'synthesize_circuit',
            supportedCapabilities: options.requestScope?.supportedCapabilities ?? [],
            reason: 'The current request is already build-eligible. Build the scoped circuit instead of asking a generic narrowing question.'
          });
        }
        const narrowed = await narrowOptions(level ?? 'output', options.locale ?? 'ko');
        // LangGraph human-in-the-loop: pause the graph and surface grounded options. The resume value
        // (a category id or a capabilityId the student tapped) flows back as this tool's result.
        const selected = interrupt({
          kind: 'clarification',
          level: narrowed.level,
          question: contextualNarrowQuestion(narrowed.question, narrowed.level, options),
          options: narrowed.options
        });
        return asJson({ selected });
      },
      {
        name: 'ask_to_narrow',
        description: 'When the request is too vague to build (no clear output device, or a required sensor/detail is missing), ASK the student to choose instead of guessing or writing a free-text question. Pass level="output" to offer the build categories (light/sound/motor/display/sensor...), or a category id (e.g. "sensor-readout","motion") to offer the specific options inside it. The student taps one; the selection (a category id, then a capabilityId) is returned. Call again with the chosen category id to drill down. Only the options provided are buildable.',
        schema: z.object({ level: z.string().default('output') })
      }
    ),
    tool(
      async () => asJson(options.requestScope ?? { error: 'NO_REQUEST_SCOPE_IN_CONTEXT' }),
      {
        name: 'assess_request_scope',
        description: 'Authoritatively assess the CURRENT student request: its route (synthesize_circuit | clarify_requirements | unsupported_or_gap), whether it is build-eligible, unsupported, or unsafe, plus the candidate parts and supported capabilities in scope. Call this when unsure whether to build, recommend, ask a clarification, or answer conversationally, and respect the verdict.',
        schema: z.object({})
      }
    ),
    tool(
      async () => asJson(await loadContextIndexBounded(options)),
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
      async ({ capabilityId }) => asJson(loadSupportBundleEvidenceBounded(capabilityId, options)),
      {
        name: 'load_support_bundle_evidence',
        description: 'Load concise source-backed HardwareSupportBundle evidence for a capability selected in the current context packet. Returns an error for capabilities outside the current route.',
        schema: z.object({ capabilityId: z.string().min(1) })
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
        const report = applyScopedCandidatePartGate(
          await detectFaults(spec, await buildNetlist(spec)),
          spec,
          options
        );
        return asJson(applyContextCoverageGate(report, options.contextCoverage));
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
        return asJson(await compileRenderPlan(spec, validationReport, { locale: options.locale ?? 'ko' }));
      },
      {
        name: 'compile_render_plan',
        description: 'Compile a RenderPlan from a CircuitSpec using server validation. Clarification-only/meta requests may remain no-scene; unsupported hardware can return diagnostic context, missing exact footprints can use placeholder geometry, and unsafe requests can use safe-equivalent simulation without build-ready claims.',
        schema: SpecInputSchema
      }
    ),
    tool(
      async ({ spec }) => asJson(await compileSimulationArtifacts(spec, options).then((artifacts) => ({
        simulationPlan: artifacts.simulationPlan,
        buildRunnableReport: artifacts.buildRunnableReport,
        solverGateResult: artifacts.solverGateResult
      }))),
      {
        name: 'compile_simulation_plan',
        description: 'Compile a SimulationPlan from a CircuitSpec using validated netlist and current paths. Also returns the authoritative buildRunnableReport gate conclusion.',
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

export function contextualNarrowQuestion(
  question: string,
  level: string,
  options: Pick<ScopedHeduwareAgentToolOptions, 'conversationContext' | 'locale'>
) {
  if (level !== 'output') {
    return question;
  }

  const context = options.conversationContext;
  const hasDiagnosticAlternative = context?.currentArtifact?.source === 'diagnostic-draft'
    || Boolean(context?.pendingSupportedAlternative);
  if (!hasDiagnosticAlternative) {
    return question;
  }

  return options.locale === 'en'
    ? 'Let’s replace the unsupported fan or motor-style output with a supported output. Pick one below.'
    : '팬이나 모터처럼 아직 검증되지 않은 출력 대신, 지금 지원되는 출력으로 바꿔볼게요. 아래에서 하나를 골라주세요.';
}

function applyScopedCandidatePartGate(
  validationReport: ValidationReport,
  spec: CircuitSpec,
  options: InternalToolOptions
): ValidationReport {
  if (options.allowUnscopedContext) {
    return validationReport;
  }

  if (options.candidateParts.length === 0) {
    return ValidationReportSchema.parse({
      ...validationReport,
      status: 'invalid',
      errors: uniqueStrings([
        ...validationReport.errors,
        'CONTEXT_CANDIDATE_SCOPE_EMPTY: The current ContextPacket did not select any buildable candidate parts, so live agent tools cannot validate, netlist, render, or simulate this circuit draft.'
      ]),
      warnings: uniqueStrings([
        ...validationReport.warnings,
        'CONTEXT_CANDIDATE_PART_WARNING: Circuit drafts may only use parts selected by the current ContextPacket candidateParts.'
      ]),
      validatedCurrentPathIds: []
    });
  }

  return applyCandidatePartGate(validationReport, spec, options.candidateParts);
}

function loadSupportBundleEvidenceBounded(capabilityId: string, options: InternalToolOptions) {
  const supportBundles = options.supportBundles;
  const evidence = supportBundles.find((bundle) => bundle.capabilityId === capabilityId);
  if (!evidence) {
    return {
      error: 'SUPPORT_BUNDLE_NOT_IN_CONTEXT',
      requestedCapabilityId: capabilityId,
      allowedCapabilityIds: supportBundles.map((bundle) => bundle.capabilityId)
    };
  }

  return evidence;
}

async function loadContextIndexBounded(options: InternalToolOptions) {
  const index = await loadContextIndex();
  if (options.allowUnscopedContext) {
    return index;
  }

  const allowedEntries = options.allowedContextSourceIds
    .map((sourceId) => findContextEntry(index, sourceId))
    .filter((entry): entry is ContextEntry => Boolean(entry));
  const allowedKeys = new Set(allowedEntries.flatMap((entry) => entryKeys(entry)));
  const filterEntries = (entries: ContextEntry[]) => entries.filter((entry) =>
    entryKeys(entry).some((key) => allowedKeys.has(key))
  );

  return {
    ...index,
    memory: filterEntries(index.memory),
    skills: filterEntries(index.skills),
    references: filterEntries(index.references),
    data: filterEntries(index.data),
    routing: filterEntries(index.routing)
  };
}

async function readContextDocBounded(id: string, options: InternalToolOptions) {
  if (id.startsWith('bundle:')) {
    return readContextBundleDocBounded(id, options);
  }

  if (options.allowUnscopedContext) {
    return readContextDoc(id);
  }

  if (options.allowedContextSourceIds.length === 0) {
    return asJson({
      error: 'CONTEXT_SCOPE_EMPTY',
      requestedId: id,
      allowedSourceIds: []
    });
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

async function readContextBundleDocBounded(id: string, options: InternalToolOptions) {
  if (options.allowUnscopedContext) {
    const bundleId = id.slice('bundle:'.length);
    const bundle = await loadContextBundleV2(bundleId);
    return renderContextBundleDoc(bundle);
  }

  if (options.allowedContextSourceIds.length === 0) {
    return asJson({
      error: 'CONTEXT_SCOPE_EMPTY',
      requestedId: id,
      allowedSourceIds: []
    });
  }

  const allowed = options.allowedContextSourceIds.includes(id);
  if (!allowed) {
    return asJson({
      error: 'CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN',
      requestedId: id,
      allowedSourceIds: options.allowedContextSourceIds
    });
  }

  const bundleId = id.slice('bundle:'.length);
  const bundle = await loadContextBundleV2(bundleId);
  return renderContextBundleDoc(bundle);
}

function renderContextBundleDoc(bundle: Awaited<ReturnType<typeof loadContextBundleV2>>) {
  return [
    bundle.summary,
    '',
    `supportLevel=${bundle.manifest.supportLevel}`,
    `allowedParts=${bundle.manifest.allowedParts.join(', ')}`,
    `validationRules=${bundle.manifest.validationRules.join(', ')}`,
    `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ')}`
  ].join('\n');
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

async function searchContextBoundPartCapabilities(query: string, options: InternalToolOptions) {
  const matches = await searchPartCapabilities(query);
  if (options.allowUnscopedContext) {
    return matches;
  }

  if (options.candidateParts.length === 0) {
    return [];
  }

  const candidateIds = new Set(options.candidateParts.map((part) => part.id));
  const candidateById = new Map(options.candidateParts.map((part) => [part.id, part]));
  return matches
    .filter((part) => candidateIds.has(part.id))
    .map((part) => candidateById.get(part.id) ?? part);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function compileSimulationArtifacts(spec: CircuitSpec, options: InternalToolOptions) {
  const rawValidationReport: ValidationReport = applyScopedCandidatePartGate(
    await validateCircuitSpec(spec),
    spec,
    options
  );
  const validationReport = applyContextCoverageGate(rawValidationReport, options.contextCoverage);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport, { locale: options.locale ?? 'ko' });
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGateResult = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);
  const requirementMarkdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan, runnableReport);
  return { validationReport, netlist, currentPaths, renderPlan, simulationPlan, buildRunnableReport: runnableReport, solverGateResult, requirementMarkdown };
}
