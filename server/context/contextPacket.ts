import {
  getPartRegistry,
  detectVisualLibraryPartMentions,
  loadContextIndex,
  loadContextRoutingMap,
  loadRenderFootprints,
  loadSimulationPrimitives,
  matchCapabilities,
  resolveContextSourceId,
  searchPartCapabilities
} from './contextLayer.ts';
import {
  ContextPacketSchema,
  ContextRouteSchema,
  IntentSpecV2Schema,
  RetrievalPlanSchema,
  type AgentMessageRequest,
  type AgentConversationContext,
  type CapabilityGraphEntry,
  type ContextCoverageReport,
  type ContextPacket,
  type ContextRoute,
  type ContextTraceEntry,
  type IntentSpecV2,
  type PartCapability,
  type RenderFootprintEntry,
  type RetrievalPlan,
  type SimulationPrimitive
} from '../agent/schemas.ts';
import type { ContextIndex, ContextRoutingMap, ContextRoutingRoute, VisualLibraryPartMention } from './contextLayer.ts';

type BuildContextPacketInput = Pick<AgentMessageRequest, 'message' | 'locale' | 'conversationContext'>;

const BASE_CONTEXT_IDS = [
  'agent-operating-memory',
  'safety-policy',
  'board-topology',
  'protocol-rules',
  'validation-rules',
  'simulation-recipes',
  'rendering-footprints',
  'simulation-truthfulness-policy'
];

const HARDWARE_KEYWORDS = [
  {
    partId: 'oled-i2c-096',
    output: 'display',
    protocol: 'i2c',
    terms: ['oled', 'display', 'screen', 'text display', '화면', '디스플레이', '표시', '글자', '문자']
  },
  {
    partId: 'led-5mm',
    output: 'light',
    protocol: 'gpio',
    terms: ['led', 'light', 'lamp', 'blink', '불', '조명', '깜빡', '켜']
  },
  {
    partId: 'button-tactile',
    input: 'button',
    protocol: 'gpio',
    terms: ['button', 'pushbutton', 'switch', 'press', '버튼', '스위치', '누르']
  },
  {
    partId: 'piezo-buzzer',
    output: 'sound',
    protocol: 'gpio',
    terms: ['buzzer', 'beep', 'sound', 'alarm', 'tone', '부저', '소리', '알람', '삐']
  },
  {
    partId: 'micro-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: ['servo', 'servo arm', 'move', 'sweep', 'actuator', '서보', '움직', '회전']
  }
];

const ACTIVE_HARDWARE_KEYWORDS = [
  {
    partId: 'oled-i2c-096',
    output: 'display',
    protocol: 'i2c',
    terms: ['oled', 'display', 'screen', 'text display', '화면', '디스플레이', '표시', '글자', '문자']
  },
  {
    partId: 'led-5mm',
    output: 'light',
    protocol: 'gpio',
    terms: ['led', 'light', 'lamp', 'blink', '불빛', '조명', '깜빡', '켜']
  },
  {
    partId: 'button-tactile',
    input: 'button',
    protocol: 'gpio',
    terms: ['button', 'pushbutton', 'switch', 'press', '버튼', '스위치', '누르']
  },
  {
    partId: 'piezo-buzzer',
    output: 'sound',
    protocol: 'gpio',
    terms: ['buzzer', 'beep', 'sound', 'alarm', 'tone', '부저', '소리', '알람', '삐']
  },
  {
    partId: 'micro-servo',
    output: 'motion',
    protocol: 'pwm',
    terms: ['servo', 'servo arm', 'move', 'sweep', 'actuator', '서보', '서보모터', '움직', '회전']
  }
];

const UNSAFE_PATTERNS = [
  { pattern: /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b/i, signal: 'high-voltage mains power' },
  { pattern: /drone|autopilot|gps navigation|bluetooth drone|autonomous robot/i, signal: 'unsupported autonomous wireless project' },
  { pattern: /wi[-\s]?fi door lock|wifi door lock|smart lock|unlock my house|phone door lock/i, signal: 'unsupported home security actuator' },
  { pattern: /radio tracker|gps tracker|track(?:ing)? device/i, signal: 'unsupported tracking or radio project' },
  { pattern: /콘센트|가정용\s*전원|교류|220볼트|110볼트/i, signal: 'high-voltage mains power' },
  { pattern: /heater|히터|열선|납땜|폭발|폭죽|fire/i, signal: 'unsafe thermal or hazardous load' }
];

const ACTIVE_UNSAFE_PATTERNS = [
  { pattern: /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|ac\b/i, signal: 'high-voltage mains power' },
  { pattern: /drone|autopilot|gps navigation|bluetooth drone|autonomous robot|무인\s*드론|자율\s*주행|gps\s*경로/i, signal: 'unsupported autonomous wireless project' },
  { pattern: /wi[-\s]?fi door lock|wifi door lock|smart lock|unlock my house|phone door lock|와이파이\s*도어락|스마트\s*도어락|현관문\s*잠금/i, signal: 'unsupported home security actuator' },
  { pattern: /radio tracker|gps tracker|track(?:ing)? device|위치\s*추적|무선\s*추적/i, signal: 'unsupported tracking or radio project' },
  { pattern: /콘센트|가정용\s*전원|교류|220볼트|110볼트/i, signal: 'high-voltage mains power' },
  { pattern: /heater|히터|난방|발열|가열|fire|화재/i, signal: 'unsafe thermal or hazardous load' }
];

export async function buildContextPacket(input: BuildContextPacketInput): Promise<ContextPacket> {
  const locale = input.locale ?? 'ko';
  const message = input.message;
  const conversationContext = input.conversationContext;
  const contextualMessage = buildContextualRoutingMessage(input);
  const [index, capabilityMatches, routingMap, visualLibraryMentions] = await Promise.all([
    loadContextIndex(),
    matchCapabilities(contextualMessage),
    loadContextRoutingMap(),
    detectVisualLibraryPartMentions(contextualMessage)
  ]);

  const intentHints = inferIntentHints(contextualMessage, capabilityMatches);
  const unsupportedSignals = detectUnsupportedSignals(contextualMessage);
  const supportGaps = unique([
    ...buildSupportGaps(capabilityMatches),
    ...buildVisualLibrarySupportGaps(visualLibraryMentions)
  ]);
  const contextRoute = selectContextRoute({
    routingMap,
    intentHints,
    capabilityMatches,
    unsupportedSignals,
    supportGaps
  });
  const retrievalPlan = buildRetrievalPlan({
    contextRoute,
    routingMap,
    index
  });
  const shouldLoadRegistry = includesSource(retrievalPlan, 'registry:part-capabilities');
  const shouldLoadSimulationPrimitives = includesSource(retrievalPlan, 'simulation:primitives');
  const shouldLoadRenderFootprints = includesSource(retrievalPlan, 'rendering:render-footprints');
  const [registry, searchedParts, allSimulationPrimitives, allRenderFootprints] = await Promise.all([
    shouldLoadRegistry ? getPartRegistry() : Promise.resolve([] as PartCapability[]),
    shouldLoadRegistry ? searchPartCapabilities(expandSearchQuery(contextualMessage)) : Promise.resolve([] as PartCapability[]),
    shouldLoadSimulationPrimitives ? loadSimulationPrimitives() : Promise.resolve([] as SimulationPrimitive[]),
    shouldLoadRenderFootprints ? loadRenderFootprints() : Promise.resolve({} as Record<string, RenderFootprintEntry>)
  ]);
  const intentSpec = extractIntentSignals({
    message,
    locale,
    intentHints,
    capabilityMatches,
    unsupportedSignals,
    supportGaps
  });
  const candidateParts = selectCandidateParts(registry, searchedParts, intentHints, unsupportedSignals, capabilityMatches);
  const simulationPrimitives = selectSimulationPrimitives(allSimulationPrimitives, capabilityMatches, candidateParts);
  const renderFootprints = selectRenderFootprints(allRenderFootprints, capabilityMatches, candidateParts);
  const requiredContextIds = retrievalPlan.sourceIds;

  const contextTrace = buildContextTrace({
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps,
    visualLibraryMentions,
    indexVersion: index.version,
    contextRoute,
    retrievalPlan,
    index,
    conversationContext
  });
  const contextCoverage = buildContextCoverage({
    contextTrace,
    capabilityMatches,
    candidateParts,
    renderFootprints,
    unsupportedSignals,
    supportGaps,
    ambiguity: intentHints.ambiguity,
    requiredSourceTypes: sourceTypesForPlan(retrievalPlan, index),
    retrievalWarnings: retrievalPlan.warnings
  });
  const promptBlock = renderPromptBlock({
    locale,
    message,
    intentSpec,
    intentHints,
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps,
    visualLibraryMentions,
    contextRoute,
    retrievalPlan,
    contextTrace,
    contextCoverage,
    conversationContext
  });

  return ContextPacketSchema.parse({
    locale,
    studentMessage: message,
    intentSpec,
    intentHints,
    capabilityMatches,
    candidateParts,
    simulationPrimitives,
    renderFootprints,
    requiredContextIds,
    unsupportedSignals,
    supportGaps,
    contextRoute,
    retrievalPlan,
    contextTrace,
    contextCoverage,
    promptBlock
  });
}

function buildContextualRoutingMessage(input: BuildContextPacketInput) {
  const context = input.conversationContext;
  if (!context) {
    return input.message;
  }

  const currentArtifact = context.currentArtifact;
  const lines = [
    input.message,
    context.lastSupportedGoal ? `Last supported goal: ${context.lastSupportedGoal}` : '',
    currentArtifact?.title ? `Current artifact: ${currentArtifact.title}` : '',
    currentArtifact?.circuitSpec?.intent?.primaryGoal ? `Current artifact goal: ${currentArtifact.circuitSpec.intent.primaryGoal}` : '',
    currentArtifact?.circuitSpec?.intent?.input ? `Current artifact input: ${currentArtifact.circuitSpec.intent.input}` : '',
    currentArtifact?.circuitSpec?.intent?.output ? `Current artifact output: ${currentArtifact.circuitSpec.intent.output}` : '',
    currentArtifact?.circuitSpec?.components?.length
      ? `Current artifact parts: ${currentArtifact.circuitSpec.components.map((component) => component.partId).join(', ')}`
      : '',
    context.awaitingBuildConfirmation ? 'The student may be confirming the current draft.' : '',
    context.recentTurns?.length
      ? `Recent conversation: ${context.recentTurns.map((turn) => `${turn.role}: ${turn.text}`).join(' | ')}`
      : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function selectContextRoute({
  routingMap,
  intentHints,
  capabilityMatches,
  unsupportedSignals,
  supportGaps
}: {
  routingMap: ContextRoutingMap;
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  unsupportedSignals: string[];
  supportGaps: string[];
}): ContextRoute {
  const capabilityIds = capabilityMatches.map((capability) => capability.id);
  const intentSignals = unique([
    ...intentHints.inputModalities,
    ...intentHints.outputModalities,
    ...intentHints.protocols,
    ...intentHints.safetyConcerns,
    ...unsupportedSignals
  ]);
  const route = [...routingMap.routes]
    .sort((a, b) => a.priority - b.priority)
    .find((candidate) => routeMatches(candidate, {
      capabilityMatches,
      intentSignals,
      ambiguity: intentHints.ambiguity.length > 0,
      unsafe: unsupportedSignals.length > 0,
      supportGaps
    })) ?? routingMap.routes.find((candidate) => candidate.routeId === 'supported-hardware-general') ?? routingMap.routes[0];

  const confidence = route.routeId === 'ambiguous-minimal'
    ? 0.35
    : route.routeId === 'unsupported-safety'
      ? 0.9
      : supportGaps.length > 0
        ? 0.65
        : capabilityMatches.length > 0
          ? 0.85
          : 0.5;

  return ContextRouteSchema.parse({
    routeId: route.routeId,
    intentSignals,
    capabilityIds,
    sourceIds: routeSourceIds(route),
    confidence,
    reason: route.reason
  });
}

function routeMatches(route: ContextRoutingRoute, input: {
  capabilityMatches: CapabilityGraphEntry[];
  intentSignals: string[];
  ambiguity: boolean;
  unsafe: boolean;
  supportGaps: string[];
}) {
  const { when } = route;
  if (when.ambiguity && (!input.ambiguity || input.capabilityMatches.length > 0)) {
    return false;
  }
  if (when.unsafe && !input.unsafe && !input.capabilityMatches.some((capability) => capability.supportLevel === 'unsupported')) {
    return false;
  }
  if (when.supportLevels.length > 0 && !input.capabilityMatches.some((capability) => when.supportLevels.includes(capability.supportLevel))) {
    return false;
  }
  if (when.capabilityIds.length > 0 && !input.capabilityMatches.some((capability) => when.capabilityIds.includes(capability.id))) {
    return false;
  }
  if (when.modalities.length > 0 && !when.modalities.every((modality) => input.intentSignals.includes(modality))) {
    return false;
  }
  return true;
}

function buildRetrievalPlan({
  contextRoute,
  routingMap,
  index
}: {
  contextRoute: ContextRoute;
  routingMap: ContextRoutingMap;
  index: ContextIndex;
}): RetrievalPlan {
  const routeSourceIds = contextRoute.sourceIds;
  const sourceIds: string[] = [];
  const warnings: string[] = [];

  for (const sourceId of routeSourceIds) {
    const resolved = resolveContextSourceId(sourceId, index);
    if (!resolved) {
      warnings.push(`Missing context source id referenced by route ${contextRoute.routeId}: ${sourceId}`);
      continue;
    }
    sourceIds.push(resolved.sourceId);
  }

  const selected = new Set(sourceIds);
  const omittedSourceIds = routingMap.heavySourceIds
    .map((sourceId) => resolveContextSourceId(sourceId, index)?.sourceId ?? sourceId)
    .filter((sourceId) => !selected.has(sourceId));
  const route = routingMap.routes.find((candidate) => candidate.routeId === contextRoute.routeId);
  const budget = route?.budget ?? 'summary';

  return RetrievalPlanSchema.parse({
    sourceIds: unique(sourceIds),
    omittedSourceIds: unique(omittedSourceIds),
    budget,
    maxPromptChars: routingMap.maxPromptCharsByBudget[budget],
    warnings
  });
}

function routeSourceIds(route: ContextRoutingRoute) {
  return unique(Object.values(route.load).flat());
}

function includesSource(plan: RetrievalPlan, sourceId: string) {
  return plan.sourceIds.includes(sourceId);
}

function sourceTypesForPlan(plan: RetrievalPlan, index: ContextIndex): ContextTraceEntry['sourceType'][] {
  return unique(plan.sourceIds
    .map((sourceId) => resolveContextSourceId(sourceId, index)?.sourceType)
    .filter((sourceType): sourceType is ContextTraceEntry['sourceType'] => Boolean(sourceType)));
}

function expandSearchQuery(message: string) {
  const matchedTerms = ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => matchesHardwareKeyword(entry, message))
    .flatMap((entry) => [entry.partId, entry.output, entry.input, entry.protocol, ...entry.terms])
    .filter(Boolean);
  return unique([message, 'arduino', 'breadboard', ...matchedTerms]).join(' ');
}

function inferIntentHints(message: string, capabilityMatches: CapabilityGraphEntry[] = []) {
  const outputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.outputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => entry.output && matchesHardwareKeyword(entry, message))
    .map((entry) => entry.output as string)
  ]);
  const inputModalities = unique([
    ...capabilityMatches.flatMap((capability) => capability.inputModalities),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => entry.input && matchesHardwareKeyword(entry, message))
    .map((entry) => entry.input as string)
  ]);
  const protocols = unique([
    ...capabilityMatches.flatMap((capability) => capability.protocols),
    ...ACTIVE_HARDWARE_KEYWORDS
    .filter((entry) => matchesHardwareKeyword(entry, message) || message.toLowerCase().includes(entry.protocol))
    .map((entry) => entry.protocol)
  ]);
  const safetyConcerns = detectUnsupportedSignals(message);

  return {
    outputModalities,
    inputModalities,
    protocols,
    powerAssumptions: safetyConcerns.length > 0
      ? []
      : ['beginner-safe Arduino 5V low-voltage classroom circuit'],
    safetyConcerns,
    ambiguity: capabilityMatches.length === 0 && outputModalities.length === 0 && inputModalities.length === 0 && safetyConcerns.length === 0
      ? ['No concrete input or output hardware was identified yet.']
      : []
  };
}

function extractIntentSignals({
  message,
  locale,
  intentHints,
  capabilityMatches,
  unsupportedSignals,
  supportGaps
}: {
  message: string;
  locale: 'ko' | 'en';
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  unsupportedSignals: string[];
  supportGaps: string[];
}): IntentSpecV2 {
  const inputModalities = unique(intentHints.inputModalities);
  const outputModalities = unique(intentHints.outputModalities);
  const protocols = new Set(intentHints.protocols);
  const behaviors = inferIntentBehaviors(message, inputModalities, outputModalities, protocols);
  const ambiguities = unique([
    ...intentHints.ambiguity,
    ...supportGaps.map((gap) => `Capability is planned, partial, or unsupported: ${gap}`)
  ]);
  const controllerAssumptions = /arduino|uno/i.test(message) || capabilityMatches.some((capability) => capability.requiredParts.includes('arduino-uno'))
    ? ['arduino-compatible']
    : ['arduino-compatible', 'controller not explicitly specified'];
  const confidence = capabilityMatches.length > 0
    ? supportGaps.length > 0 ? 0.62 : 0.82
    : ambiguities.length > 0 ? 0.35 : 0.5;

  return IntentSpecV2Schema.parse({
    studentGoal: message,
    behaviors,
    inputModalities,
    outputModalities,
    controllerAssumptions,
    powerAssumptions: intentHints.powerAssumptions,
    ambiguities,
    safetySignals: intentHints.safetyConcerns,
    unsupportedSignals,
    language: inferLanguage(locale, message),
    confidence
  });
}

function inferIntentBehaviors(
  message: string,
  inputModalities: string[],
  outputModalities: string[],
  protocols: Set<string>
) {
  const lower = message.toLowerCase();
  const action = outputModalities.includes('display')
    ? 'show display output'
    : outputModalities.includes('sound')
      ? 'drive sound output'
      : outputModalities.includes('motion')
        ? 'drive motion output'
        : outputModalities.includes('light')
          ? 'drive light output'
          : 'produce requested circuit behavior';
  const trigger = inputModalities.includes('button')
    ? 'button press'
    : inputModalities.includes('light-sensor') || lower.includes('dark')
      ? 'ambient light changes'
      : inputModalities.length > 0
        ? `${inputModalities[0]} input changes`
        : 'student runs the circuit';
  const timing = inputModalities.includes('analog') || inputModalities.includes('potentiometer') || inputModalities.includes('light-sensor')
    ? 'analog'
    : protocols.has('pwm')
      ? 'pwm'
      : inputModalities.includes('button')
        ? 'momentary'
        : 'steady-state';

  return [{
    trigger,
    action,
    timing
  }];
}

function inferLanguage(locale: 'ko' | 'en', message: string): IntentSpecV2['language'] {
  const hasHangul = /[\u3131-\uD79D]/.test(message);
  const hasLatin = /[a-z]/i.test(message);
  if (hasHangul && hasLatin) return 'mixed';
  if (hasHangul) return 'ko';
  if (hasLatin) return 'en';
  return locale;
}

function detectUnsupportedSignals(message: string) {
  return ACTIVE_UNSAFE_PATTERNS
    .filter((entry) => entry.pattern.test(message))
    .map((entry) => entry.signal);
}

function selectCandidateParts(
  registry: PartCapability[],
  searchedParts: PartCapability[],
  intentHints: ReturnType<typeof inferIntentHints>,
  unsupportedSignals: string[],
  capabilityMatches: CapabilityGraphEntry[]
) {
  const byId = new Map(registry.map((part) => [part.id, part]));
  const candidateIds = new Set<string>(['arduino-uno', 'breadboard-half']);

  for (const part of searchedParts) {
    candidateIds.add(part.id);
  }

  for (const entry of ACTIVE_HARDWARE_KEYWORDS) {
    if (
      intentHints.outputModalities.includes(entry.output ?? '') ||
      intentHints.inputModalities.includes(entry.input ?? '')
    ) {
      candidateIds.add(entry.partId);
    }
  }

  for (const capability of capabilityMatches) {
    for (const partId of [...capability.requiredParts, ...capability.optionalParts]) {
      candidateIds.add(partId);
    }
  }

  for (const id of [...candidateIds]) {
    const part = byId.get(id);
    for (const passive of part?.requiredPassives ?? []) {
      candidateIds.add(passive.partId);
    }
  }

  if (unsupportedSignals.length > 0) {
    return ['arduino-uno', 'breadboard-half']
      .map((id) => byId.get(id))
      .filter((part): part is PartCapability => Boolean(part));
  }

  return [...candidateIds]
    .map((id) => byId.get(id))
    .filter((part): part is PartCapability => Boolean(part));
}

function selectSimulationPrimitives(
  primitives: SimulationPrimitive[],
  capabilityMatches: CapabilityGraphEntry[],
  candidateParts: PartCapability[]
) {
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const primitiveIds = unique([
    ...capabilityMatches.flatMap((capability) => capability.simulationPrimitives),
    ...candidateParts.flatMap((part) => part.compatibleSimulationPrimitives)
  ]);

  return primitiveIds
    .map((id) => byId.get(id))
    .filter((primitive): primitive is SimulationPrimitive => Boolean(primitive));
}

function selectRenderFootprints(
  footprints: Record<string, RenderFootprintEntry>,
  capabilityMatches: CapabilityGraphEntry[],
  candidateParts: PartCapability[]
) {
  const footprintTypes = unique([
    ...capabilityMatches.flatMap((capability) => capability.renderFootprints),
    ...candidateParts.map((part) => part.renderFootprint.type)
  ]);

  return footprintTypes
    .map((type) => footprints[type])
    .filter((footprint): footprint is RenderFootprintEntry => Boolean(footprint));
}

function buildContextTrace({
  capabilityMatches,
  candidateParts,
  simulationPrimitives,
  renderFootprints,
  requiredContextIds,
  unsupportedSignals,
  supportGaps,
  visualLibraryMentions,
  indexVersion,
  contextRoute,
  retrievalPlan,
  index,
  conversationContext
}: {
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  simulationPrimitives: SimulationPrimitive[];
  renderFootprints: RenderFootprintEntry[];
  requiredContextIds: string[];
  unsupportedSignals: string[];
  supportGaps: string[];
  visualLibraryMentions: VisualLibraryPartMention[];
  indexVersion: string;
  contextRoute: ContextRoute;
  retrievalPlan: RetrievalPlan;
  index: ContextIndex;
  conversationContext?: AgentConversationContext;
}): ContextTraceEntry[] {
  const trace: ContextTraceEntry[] = [
    {
      sourceId: 'memory:agent-operating-memory',
      sourceType: 'memory',
      reason: 'Loaded always-on agent operating rules before synthesis.',
      usedFields: ['safety rules', 'validation-before-simulation'],
      summary: `context-index ${indexVersion}`
    }
  ];

  if (conversationContext?.currentArtifact || conversationContext?.lastSupportedGoal) {
    trace.push({
      sourceId: 'conversation:current-artifact',
      sourceType: 'memory',
      reason: 'Used the active draft/project artifact to interpret the student follow-up without discarding the raw message.',
      usedFields: [
        conversationContext.currentArtifact ? 'currentArtifact' : '',
        conversationContext.lastSupportedGoal ? 'lastSupportedGoal' : '',
        conversationContext.awaitingBuildConfirmation ? 'awaitingBuildConfirmation' : ''
      ].filter(Boolean),
      summary: [
        conversationContext.currentArtifact?.title,
        conversationContext.lastSupportedGoal
      ].filter(Boolean).join(' | ')
    });
  }

  for (const sourceId of retrievalPlan.sourceIds) {
    const entry = resolveContextSourceId(sourceId, index);
    if (!entry) {
      continue;
    }
    trace.push({
      sourceId: entry.sourceId,
      sourceType: entry.sourceType,
      reason: `Selected by context route ${contextRoute.routeId}: ${entry.description}`,
      usedFields: ['sourceId', 'level', 'provides', ...entry.provides],
      summary: `${entry.level} ${entry.budget}`
    });
  }

  for (const capability of capabilityMatches) {
    trace.push({
      sourceId: `data:capability-graph:${capability.id}`,
      sourceType: 'data',
      reason: `Matched student request to ${capability.supportLevel} capability: ${capability.id}.`,
      usedFields: ['supportLevel', 'positivePhrases', 'requiredEvidence', 'negativeEvidence', 'minimumScore', 'requiredParts', 'protocols', 'simulationPrimitives', 'renderFootprints', 'validationRules'],
      summary: supportGaps.some((gap) => gap.includes(capability.id)) ? capability.unsupportedReason : undefined
    });
  }

  for (const mention of visualLibraryMentions) {
    trace.push({
      sourceId: `registry:visual-library:${mention.visualPartId}`,
      sourceType: 'registry',
      reason: mention.status === 'agent-ready'
        ? `Matched visual library part ${mention.visualPartId} to canonical agent part ${mention.agentPartId}.`
        : `Detected visual-only library part ${mention.visualPartId}; it is not eligible for validated synthesis until promoted to canonical context.`,
      usedFields: ['visualPartId', 'visualPartName', 'visualCategory', 'status', 'agentPartId', 'reason'],
      summary: mention.reason
    });
  }

  for (const primitive of simulationPrimitives) {
    trace.push({
      sourceId: `data:simulation-primitives:${primitive.id}`,
      sourceType: 'data',
      reason: `Loaded simulation primitive contract: ${primitive.id}.`,
      usedFields: ['requiredNetRoles', 'validationRules', 'currentPathRecipe', 'expectedStateRecipe', 'uiControls', 'animationCues', 'renderOverlays', 'limitations'],
      summary: primitive.explanationTemplate
    });
  }

  for (const footprint of renderFootprints) {
    trace.push({
      sourceId: `rendering:render-footprint:${footprint.type}`,
      sourceType: 'rendering',
      reason: `Loaded render footprint anchors and placement constraints: ${footprint.type}.`,
      usedFields: ['dimensions', 'pinAnchors', 'labelAnchor', 'placement', 'simulationOverlayAnchors']
    });
  }

  for (const part of candidateParts) {
    trace.push({
      sourceId: `registry:part-capabilities:${part.id}`,
      sourceType: 'registry',
      reason: `Matched candidate hardware capability: ${part.label}.`,
      usedFields: ['supportLevel', 'capabilities', 'aliases', 'pins', 'electrical', 'protocols', 'requiredPassives', 'renderFootprint', 'simulationModel', 'compatibleSimulationPrimitives']
    });
  }

  return dedupeTrace(trace);
}

function renderPromptBlock({
  locale,
  message,
  conversationContext,
  intentSpec,
  intentHints,
  capabilityMatches,
  candidateParts,
  simulationPrimitives,
  renderFootprints,
  requiredContextIds,
  unsupportedSignals,
  supportGaps,
  visualLibraryMentions,
  contextRoute,
  retrievalPlan,
  contextTrace,
  contextCoverage
}: {
  locale: 'ko' | 'en';
  message: string;
  conversationContext?: AgentConversationContext;
  intentSpec: IntentSpecV2;
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  simulationPrimitives: SimulationPrimitive[];
  renderFootprints: RenderFootprintEntry[];
  requiredContextIds: string[];
  unsupportedSignals: string[];
  supportGaps: string[];
  visualLibraryMentions: VisualLibraryPartMention[];
  contextRoute: ContextRoute;
  retrievalPlan: RetrievalPlan;
  contextTrace: ContextTraceEntry[];
  contextCoverage: ContextCoverageReport;
}) {
  const capabilities = capabilityMatches.map((capability) => ({
    id: capability.id,
    supportLevel: capability.supportLevel,
    inputModalities: capability.inputModalities,
    outputModalities: capability.outputModalities,
    requiredParts: capability.requiredParts,
    protocols: capability.protocols,
    simulationPrimitives: capability.simulationPrimitives,
    renderFootprints: capability.renderFootprints,
    validationRules: capability.validationRules,
    unsupportedReason: capability.unsupportedReason
  }));
  const parts = candidateParts.map((part) => ({
    id: part.id,
    kind: part.kind,
    supportLevel: part.supportLevel,
    capabilities: part.capabilities,
    pins: part.pins.map((pin) => `${pin.name}:${pin.role}`),
    protocols: part.protocols,
    requiredPassives: part.requiredPassives.map((passive) => passive.partId),
    simulationModel: part.simulationModel.type,
    compatibleSimulationPrimitives: part.compatibleSimulationPrimitives,
    renderFootprint: part.renderFootprint.type
  }));
  const primitiveContracts = simulationPrimitives.map((primitive) => ({
    id: primitive.id,
    requiredNetRoles: primitive.requiredNetRoles,
    validationRules: primitive.validationRules,
    currentPathRecipe: primitive.currentPathRecipe,
    expectedStateRecipe: primitive.expectedStateRecipe,
    uiControls: primitive.uiControls.map((control) => ({
      id: control.id,
      type: control.type,
      affects: control.affects
    })),
    animationCues: primitive.animationCues,
    renderOverlays: primitive.renderOverlays,
    limitations: primitive.limitations
  }));
  const footprintAnchors = renderFootprints.map((footprint) => ({
    type: footprint.type,
    pinAnchors: Object.fromEntries(
      Object.entries(footprint.pinAnchors).map(([pin, anchor]) => [pin, {
        role: anchor.role,
        label: anchor.label
      }])
    ),
    placement: {
      allowedSurfaces: footprint.placement.allowedSurfaces,
      breadboardCompatible: footprint.placement.breadboardCompatible,
      defaultOrientation: footprint.placement.defaultOrientation
    },
    simulationOverlayAnchors: footprint.simulationOverlayAnchors
  }));
  const visualMentions = visualLibraryMentions.map((mention) => ({
    visualPartId: mention.visualPartId,
    visualPartName: mention.visualPartName,
    visualCategory: mention.visualCategory,
    status: mention.status,
    agentPartId: mention.agentPartId,
    reason: mention.reason
  }));

  return [
    '## CONTEXT PACKET',
    `Locale: ${locale}`,
    `Student message: ${message}`,
    '',
    'Current artifact context:',
    renderConversationContextForPrompt(conversationContext),
    '',
    'Intent spec:',
    JSON.stringify(intentSpec, null, 2),
    '',
    'Intent hints:',
    JSON.stringify(intentHints, null, 2),
    '',
    'Context route:',
    JSON.stringify(contextRoute, null, 2),
    '',
    'Retrieval plan:',
    JSON.stringify(retrievalPlan, null, 2),
    '',
    unsupportedSignals.length > 0
      ? `Unsupported or unsafe signals detected before synthesis: ${unsupportedSignals.join(', ')}`
      : 'Unsupported or unsafe signals detected before synthesis: none',
    '',
    'Capability graph matches:',
    JSON.stringify(capabilities, null, 2),
    '',
    'Visual library hardware mentions:',
    JSON.stringify(visualMentions, null, 2),
    '',
    supportGaps.length > 0
      ? `Capability support gaps: ${supportGaps.join(' | ')}`
      : 'Capability support gaps: none',
    '',
    'Candidate canonical hardware capabilities:',
    JSON.stringify(parts, null, 2),
    '',
    'Simulation primitive contracts:',
    JSON.stringify(primitiveContracts, null, 2),
    '',
    'Render footprint anchors:',
    JSON.stringify(footprintAnchors, null, 2),
    '',
    `Required context documents: ${requiredContextIds.join(', ')}`,
    '',
    'Context trace evidence:',
    contextTrace.map((entry) => `- ${entry.sourceId}: ${entry.reason}`).join('\n'),
    '',
    'Context coverage:',
    renderContextCoverageForPrompt(contextCoverage),
    '',
    'Non-negotiable rule: produce CircuitSpec only from these candidate capabilities and context rules. If the request cannot be satisfied from this packet, mark unsupportedItems or clarificationNeeds. Never upgrade a planned or unsupported capability to supported.'
  ].join('\n');
}

function renderContextCoverageForPrompt(contextCoverage: ContextCoverageReport) {
  return [
    `status=${contextCoverage.status}`,
    `score=${contextCoverage.score}`,
    `sufficientFor=${contextCoverage.sufficientFor.join(', ') || 'none'}`,
    `synthesisEligibility=${contextCoverage.synthesisEligibility.status}: ${contextCoverage.synthesisEligibility.reason}`,
    `missingSourceTypes=${contextCoverage.missingSourceTypes.join(', ') || 'none'}`,
    `warnings=${contextCoverage.warnings.join(' | ') || 'none'}`
  ].join('\n');
}

function renderConversationContextForPrompt(context?: AgentConversationContext) {
  if (!context) {
    return 'none';
  }

  const artifact = context.currentArtifact;
  return JSON.stringify({
    awaitingBuildConfirmation: context.awaitingBuildConfirmation,
    lastSupportedGoal: context.lastSupportedGoal ?? null,
    currentArtifact: artifact ? {
      source: artifact.source,
      title: artifact.title,
      intent: artifact.circuitSpec?.intent,
      validationStatus: artifact.validationReport?.status,
      simulationStatus: artifact.simulationPlan?.status,
      componentPartIds: artifact.circuitSpec?.components?.map((component) => component.partId) ?? []
    } : null,
    recentTurns: (context.recentTurns ?? []).slice(-4)
  }, null, 2);
}

function buildContextCoverage({
  contextTrace,
  capabilityMatches,
  candidateParts,
  renderFootprints,
  unsupportedSignals,
  supportGaps,
  ambiguity,
  requiredSourceTypes,
  retrievalWarnings
}: {
  contextTrace: ContextTraceEntry[];
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  renderFootprints: RenderFootprintEntry[];
  unsupportedSignals: string[];
  supportGaps: string[];
  ambiguity: string[];
  requiredSourceTypes: ContextTraceEntry['sourceType'][];
  retrievalWarnings: string[];
}): ContextCoverageReport {
  const normalizedRequiredSourceTypes = unique(requiredSourceTypes.length > 0 ? requiredSourceTypes : [
    'memory',
    'policy',
    'reference',
    capabilityMatches.length > 0 ? 'data' : null,
    candidateParts.length > 0 ? 'registry' : null,
    renderFootprints.length > 0 && unsupportedSignals.length === 0 ? 'rendering' : null
  ].filter((value): value is ContextTraceEntry['sourceType'] => Boolean(value)));
  const presentSourceTypes = unique(contextTrace.map((entry) => entry.sourceType));
  const present = new Set(presentSourceTypes);
  const missingSourceTypes = normalizedRequiredSourceTypes.filter((sourceType) => !present.has(sourceType));
  const warnings = [
    ...retrievalWarnings.map((warning) => `Context retrieval warning: ${warning}`),
    ...missingSourceTypes.map((sourceType) => `Missing required context source type: ${sourceType}.`),
    ...supportGaps.map((gap) => `Context support gap: ${gap}`),
    ...unsupportedSignals.map((signal) => `Unsupported or unsafe request signal: ${signal}.`),
    ...ambiguity.map((item) => `Ambiguous request context: ${item}`)
  ];
  const score = normalizedRequiredSourceTypes.length === 0
    ? 1
    : Number(((normalizedRequiredSourceTypes.length - missingSourceTypes.length) / normalizedRequiredSourceTypes.length).toFixed(3));
  const sufficientFor = classifyCoveragePurposes({
    missingSourceTypes,
    unsupportedSignals,
    supportGaps,
    ambiguity,
    capabilityMatches
  });
  const synthesisEligible = sufficientFor.includes('valid_circuit_synthesis');

  return {
    status: synthesisEligible ? 'sufficient' : 'insufficient',
    score,
    sufficientFor,
    synthesisEligibility: {
      status: synthesisEligible ? 'eligible' : 'ineligible',
      reason: synthesisEligible
        ? 'Canonical context coverage is sufficient for validated circuit synthesis.'
        : synthesisIneligibilityReason({ missingSourceTypes, unsupportedSignals, supportGaps, ambiguity })
    },
    requiredSourceTypes: normalizedRequiredSourceTypes,
    presentSourceTypes,
    missingSourceTypes,
    warnings
  };
}

function classifyCoveragePurposes({
  missingSourceTypes,
  unsupportedSignals,
  supportGaps,
  ambiguity,
  capabilityMatches
}: {
  missingSourceTypes: ContextTraceEntry['sourceType'][];
  unsupportedSignals: string[];
  supportGaps: string[];
  ambiguity: string[];
  capabilityMatches: CapabilityGraphEntry[];
}): ContextCoverageReport['sufficientFor'] {
  const purposes = new Set<ContextCoverageReport['sufficientFor'][number]>();
  const hasSupportGap = supportGaps.length > 0;
  const hasUnsupportedSignal = unsupportedSignals.length > 0;
  const hasUnsafeSignal = unsupportedSignals.some(signalRequiresUnsafeRefusal);
  const hasAmbiguity = ambiguity.length > 0;
  const hasMissingSources = missingSourceTypes.length > 0;
  const hasPartialCapability = capabilityMatches.some((capability) => capability.supportLevel === 'partial');
  const hasPlannedOrUnsupportedCapability = capabilityMatches.some((capability) =>
    capability.supportLevel === 'planned' || capability.supportLevel === 'unsupported'
  );

  if (!hasMissingSources && !hasSupportGap && !hasUnsafeSignal && !hasAmbiguity) {
    purposes.add('valid_circuit_synthesis');
  }

  if (hasAmbiguity || hasSupportGap || hasMissingSources) {
    purposes.add('clarification_response');
  }

  if (hasSupportGap || hasUnsupportedSignal || hasPlannedOrUnsupportedCapability) {
    purposes.add('unsupported_response');
  }

  if (hasUnsafeSignal) {
    purposes.add('unsafe_refusal');
  }

  if (hasPartialCapability) {
    purposes.add('partial_visual_only');
  }

  return [...purposes];
}

function signalRequiresUnsafeRefusal(signal: string) {
  return /high-voltage|mains|thermal|hazardous|heater|wall power/i.test(signal);
}

function synthesisIneligibilityReason({
  missingSourceTypes,
  unsupportedSignals,
  supportGaps,
  ambiguity
}: {
  missingSourceTypes: ContextTraceEntry['sourceType'][];
  unsupportedSignals: string[];
  supportGaps: string[];
  ambiguity: string[];
}) {
  const unsafeSignal = unsupportedSignals.find(signalRequiresUnsafeRefusal);
  if (unsafeSignal) {
    return `Unsafe signal detected: ${unsafeSignal}.`;
  }
  if (unsupportedSignals.length > 0) {
    return `Unsupported request signal detected: ${unsupportedSignals[0]}.`;
  }
  if (supportGaps.length > 0) {
    return `Capability support gap blocks validated synthesis: ${supportGaps[0]}.`;
  }
  if (missingSourceTypes.length > 0) {
    return `Missing canonical context source type for synthesis: ${missingSourceTypes.join(', ')}.`;
  }
  if (ambiguity.length > 0) {
    return `Clarification is required before synthesis: ${ambiguity[0]}.`;
  }
  return 'Context coverage is not sufficient for valid circuit synthesis.';
}

function buildSupportGaps(capabilityMatches: CapabilityGraphEntry[]) {
  return capabilityMatches
    .filter((capability) => capability.supportLevel === 'planned' || capability.supportLevel === 'unsupported' || capability.supportLevel === 'partial')
    .map((capability) => {
      const reason = capability.unsupportedReason ? ` ${capability.unsupportedReason}` : '';
      return `${capability.id} is ${capability.supportLevel}.${reason}`;
    });
}

function buildVisualLibrarySupportGaps(visualLibraryMentions: VisualLibraryPartMention[]) {
  return visualLibraryMentions
    .filter((mention) => mention.status === 'visual-only')
    .map((mention) =>
      `visual-only hardware ${mention.visualPartId} (${mention.visualPartName}) is visible in the parts library but lacks canonical agent context for validated wiring, rendering, and simulation.`
    );
}

function contextSourceType(id: string): ContextTraceEntry['sourceType'] {
  if (id.endsWith('policy')) return 'policy';
  if (id.includes('safety') || id.includes('unsupported')) return 'policy';
  if (id.includes('validation')) return 'reference';
  if (id.includes('simulation')) return 'reference';
  if (id.includes('rendering')) return 'reference';
  if (id.includes('agent-operating')) return 'memory';
  return 'reference';
}

function contextReason(id: string, unsupportedSignals: string[]) {
  const reasons: Record<string, string> = {
    'agent-operating-memory': 'Applied always-loaded agent safety and orchestration rules.',
    'safety-policy': 'Applied low-voltage classroom safety constraints before circuit synthesis.',
    'board-topology': 'Grounded Arduino and breadboard topology assumptions.',
    'protocol-rules': 'Restricted wiring to supported protocol and pin-role rules.',
    'validation-rules': 'Prepared deterministic validation failure modes and repair priorities.',
    'simulation-recipes': 'Prepared current-flow and behavior simulation recipes.',
    'rendering-footprints': 'Prepared supported render footprint constraints.',
    'simulation-truthfulness-policy': 'Prevented overclaiming beyond educational simulation support.',
    'unsupported-request-policy': 'Prepared explicit unsupported handling for request signals.',
    'electrical-limits': 'Applied voltage and current limits.'
  };
  if (id === 'safety-policy' && unsupportedSignals.length > 0) {
    return `Detected unsafe request signals: ${unsupportedSignals.join(', ')}.`;
  }
  return reasons[id] ?? `Loaded context rule ${id}.`;
}

function contextUsedFields(id: string) {
  const fields: Record<string, string[]> = {
    'safety-policy': ['unsafe keywords', 'low-voltage boundary'],
    'board-topology': ['breadboard rails', 'Arduino power pins', 'common ground'],
    'protocol-rules': ['GPIO', 'I2C', 'PWM'],
    'validation-rules': ['missing parts', 'pin errors', 'shorts', 'ground return'],
    'simulation-recipes': ['current paths', 'expected states', 'animation cues'],
    'rendering-footprints': ['footprint type', 'pin anchors', 'visual constraints'],
    'simulation-truthfulness-policy': ['supported approximations', 'limitations'],
    'unsupported-request-policy': ['unsupported items', 'safe alternatives'],
    'electrical-limits': ['voltage range', 'current range']
  };
  return fields[id] ?? ['summary'];
}

function hasAnyTerm(message: string, terms: string[]) {
  const normalized = message.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function matchesHardwareKeyword(entry: typeof ACTIVE_HARDWARE_KEYWORDS[number], message: string) {
  if (!hasAnyTerm(message, entry.terms)) {
    return false;
  }
  if (entry.partId !== 'oled-i2c-096' || !/\bscreen\b/i.test(message)) {
    return true;
  }
  return hasAnyTerm(message, ['oled', 'display', 'text display', 'show text', 'display message']);
}

function dedupeTrace(trace: ContextTraceEntry[]) {
  const seen = new Set<string>();
  return trace.filter((entry) => {
    if (seen.has(entry.sourceId)) {
      return false;
    }
    seen.add(entry.sourceId);
    return true;
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}
