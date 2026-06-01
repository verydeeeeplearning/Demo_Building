import { z } from 'zod';

export const EndpointSchema = z.object({
  componentId: z.string().min(1),
  pin: z.string().min(1)
});

export const RenderEndpointSchema = z.object({
  partId: z.string().min(1),
  pin: z.string().min(1)
});

export const IntentSpecSchema = z.object({
  primaryGoal: z.string().min(1),
  output: z.string().min(1),
  controller: z.string().min(1),
  input: z.string().optional(),
  behavior: z.string().optional()
});

export const IntentBehaviorSchema = z.object({
  trigger: z.string().min(1),
  action: z.string().min(1),
  timing: z.enum(['steady-state', 'momentary', 'pwm', 'analog', 'event-driven', 'unknown']).default('unknown')
});

export const IntentSpecV2Schema = z.object({
  studentGoal: z.string().min(1),
  behaviors: z.array(IntentBehaviorSchema).default([]),
  inputModalities: z.array(z.string().min(1)).default([]),
  outputModalities: z.array(z.string().min(1)).default([]),
  controllerAssumptions: z.array(z.string().min(1)).default([]),
  powerAssumptions: z.array(z.string().min(1)).default([]),
  ambiguities: z.array(z.string().min(1)).default([]),
  safetySignals: z.array(z.string().min(1)).default([]),
  unsupportedSignals: z.array(z.string().min(1)).default([]),
  language: z.enum(['ko', 'en', 'mixed', 'unknown']).default('unknown'),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const PartCapabilitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['controller', 'board', 'output', 'input', 'passive', 'wiring', 'power']),
  label: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  pins: z.array(z.object({
    name: z.string().min(1),
    role: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([])
  })).min(1),
  electrical: z.object({
    voltageRange: z.object({
      min: z.number(),
      max: z.number(),
      nominal: z.number()
    }),
    maxCurrentMa: z.number().nonnegative(),
    requiresCurrentLimiting: z.boolean().default(false)
  }),
  protocols: z.array(z.string().min(1)),
  requiredPassives: z.array(z.object({
    partId: z.string().min(1),
    reason: z.string().min(1)
  })).default([]),
  renderFootprint: z.object({
    type: z.string().min(1),
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive()
  }),
  simulationModel: z.object({
    type: z.string().min(1),
    nominalCurrentMa: z.number().nonnegative().default(0)
  }),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']).default('supported'),
  capabilities: z.array(z.string().min(1)).default([]),
  compatibleSimulationPrimitives: z.array(z.string().min(1)).default([]),
  commonMistakes: z.array(z.string().min(1)).default([]),
  safeSubstitutes: z.array(z.string().min(1)).default([])
});

export const CapabilityGraphEntrySchema = z.object({
  id: z.string().min(1),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  positivePhrases: z.array(z.string().min(1)).min(1),
  requiredEvidence: z.array(z.string().min(1)).min(1),
  negativeEvidence: z.array(z.string().min(1)).default([]),
  minimumScore: z.number().positive().max(1),
  studentPhrases: z.array(z.string().min(1)).min(1),
  inputModalities: z.array(z.string().min(1)).default([]),
  outputModalities: z.array(z.string().min(1)).default([]),
  requiredRoles: z.array(z.string().min(1)).default([]),
  requiredParts: z.array(z.string().min(1)).default([]),
  optionalParts: z.array(z.string().min(1)).default([]),
  protocols: z.array(z.string().min(1)).default([]),
  simulationPrimitives: z.array(z.string().min(1)).default([]),
  renderFootprints: z.array(z.string().min(1)).default([]),
  validationRules: z.array(z.string().min(1)).default([]),
  commonMistakes: z.array(z.string().min(1)).default([]),
  safeAlternatives: z.array(z.string().min(1)).default([]),
  unsupportedReason: z.string().optional()
});

export const TopologyTemplateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  requiredRoles: z.array(z.string().min(1)).min(1),
  nets: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(['power', 'ground', 'signal', 'mixed'])
  })).min(1),
  connections: z.array(z.object({
    fromRole: z.string().min(1),
    toNet: z.string().min(1),
    signal: z.string().min(1)
  })).min(1),
  validationRules: z.array(z.string().min(1)).min(1),
  simulationPrimitiveHints: z.array(z.string().min(1)).default([])
});

const AnchorSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  role: z.string().min(1),
  label: z.string().optional()
});

const HoverTargetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  pin: z.string().min(1).optional(),
  explainableAs: z.array(z.string().min(1)).default([]),
  description: z.string().optional()
});

const CurrentPathKindSchema = z.enum([
  'load-current',
  'supply-current',
  'signal-activity',
  'bus-activity',
  'sensing-divider',
  'fault-current'
]);

const CurrentPathTemplateSchema = z.object({
  id: z.string().min(1),
  kind: CurrentPathKindSchema.default('load-current'),
  label: z.string().min(1),
  sourceEndpoint: z.enum(['controller-power', 'controller-signal']),
  returnEndpoint: z.enum(['controller-ground', 'target-signal']),
  through: z.array(z.enum(['required-passives', 'target'])).min(1),
  fallbackControllerPin: z.string().min(1).optional(),
  expectedCurrentMa: z.number().nonnegative().optional(),
  animation: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    speed: z.number().positive()
  })
});

export const SimulationPrimitiveSchema = z.object({
  id: z.string().min(1),
  inputs: z.array(z.string().min(1)),
  outputs: z.array(z.string().min(1)),
  requiresElectricalAnalysis: z.boolean(),
  explanationTemplate: z.string().min(1),
  requiredNetRoles: z.array(z.string().min(1)),
  requiredComponentCapabilities: z.array(z.string().min(1)).default([]),
  validationRules: z.array(z.string().min(1)).min(1),
  currentPathRecipe: z.object({
    type: z.string().min(1),
    requiredNetRoles: z.array(z.string().min(1)).default([]),
    description: z.string().min(1),
    pathTemplate: CurrentPathTemplateSchema.optional(),
    pathTemplates: z.array(CurrentPathTemplateSchema).optional()
  }),
  expectedStateRecipe: z.object({
    type: z.string().min(1),
    states: z.array(z.string().min(1)).default([]),
    description: z.string().min(1)
  }),
  uiControls: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string().min(1),
    affects: z.array(z.string().min(1)).default([])
  })).default([]),
  animationCues: z.array(z.string().min(1)).min(1),
  renderOverlays: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1)
});

export const RenderFootprintEntrySchema = z.object({
  type: z.string().min(1),
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive(),
  visualStyle: z.object({
    shape: z.string().min(1),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    material: z.string().min(1)
  }),
  pinAnchors: z.record(z.string(), AnchorSchema),
  labelAnchor: AnchorSchema.omit({ role: true }),
  placement: z.object({
    allowedSurfaces: z.array(z.string().min(1)).min(1),
    breadboardCompatible: z.boolean(),
    defaultOrientation: z.string().min(1),
    notes: z.array(z.string().min(1)).default([])
  }),
  simulationOverlayAnchors: z.array(z.object({
    id: z.string().min(1),
    anchor: z.string().min(1),
    role: z.string().min(1)
  })).min(1),
  hoverTargets: z.array(HoverTargetSchema).default([])
});

export const CircuitComponentSchema = z.object({
  id: z.string().min(1),
  partId: z.string().min(1),
  label: z.string().min(1),
  designator: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number()
  }).optional()
});

export const CircuitConnectionSchema = z.object({
  id: z.string().min(1),
  from: EndpointSchema,
  to: EndpointSchema,
  signal: z.string().min(1),
  color: z.string().optional(),
  education: z.object({
    label: z.string(),
    title: z.string(),
    what: z.string(),
    why: z.string(),
    missing: z.string()
  }).optional()
});

export const CircuitSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  intent: IntentSpecSchema,
  components: z.array(CircuitComponentSchema).min(1),
  connections: z.array(CircuitConnectionSchema),
  behavior: z.object({
    runText: z.string().min(1)
  }),
  assumptions: z.array(z.string()),
  unsupportedItems: z.array(z.string()),
  clarificationNeeds: z.array(z.string())
}).superRefine((spec, context) => {
  const componentIds = new Set(spec.components.map((component) => component.id));
  for (const connection of spec.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!componentIds.has(endpoint.componentId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Connection ${connection.id} references missing component ${endpoint.componentId}`,
          path: ['connections']
        });
      }
    }
  }
});

export const ValidationReportSchema = z.object({
  version: z.string().default('2026-05-31'),
  status: z.enum(['valid', 'invalid', 'valid_with_warnings', 'unsupported']),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  validatedCurrentPathIds: z.array(z.string()),
  sourceVersion: z.string().default('2026-05-31'),
  electricalAnalysis: z.record(z.string(), z.unknown()).optional(),
  simulationSupport: z.record(z.string(), z.unknown()).optional(),
  renderSupport: z.record(z.string(), z.unknown()).optional()
});

export const NetlistSchema = z.object({
  nets: z.array(z.object({
    id: z.string(),
    kind: z.enum(['power', 'ground', 'signal', 'mixed']),
    endpoints: z.array(z.string())
  }))
});

export const CurrentPathSchema = z.object({
  id: z.string().min(1),
  kind: CurrentPathKindSchema.default('load-current'),
  primitiveId: z.string().min(1).optional(),
  label: z.string().min(1),
  from: z.string().min(1),
  through: z.array(z.string().min(1)),
  to: z.string().min(1),
  expectedCurrentMa: z.number().nonnegative(),
  animation: z.object({
    color: z.string().min(1),
    speed: z.number().positive()
  })
});

export const RenderPlanSchema = z.object({
  title: z.string().min(1),
  runText: z.string().min(1),
  parts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    designator: z.string().optional(),
    description: z.string().default(''),
    pins: z.array(z.object({
      name: z.string(),
      role: z.string(),
      meaning: z.string().optional()
    })).default([]),
    position: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    }).default({ x: 0, y: 0, z: 0 }),
    footprint: RenderFootprintEntrySchema.optional(),
    libraryOnly: z.boolean().optional()
  })),
  connections: z.array(z.object({
    id: z.string(),
    from: RenderEndpointSchema,
    to: RenderEndpointSchema,
    signal: z.string(),
    color: z.string(),
    education: z.object({
      label: z.string(),
      title: z.string(),
      what: z.string(),
      why: z.string(),
      missing: z.string()
    })
  })),
  floatingCards: z.array(z.object({
    connectionId: z.string(),
    label: z.string(),
    title: z.string(),
    body: z.string()
  })),
  warnings: z.array(z.object({
    code: z.string().min(1),
    componentId: z.string().optional(),
    message: z.string().min(1)
  })).default([]),
  layout: z.object({
    endpoints: z.record(z.string(), z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    }))
  }).optional()
});

export const SimulationPlanSchema = z.object({
  status: z.enum(['valid', 'invalid', 'unsupported']),
  runText: z.string(),
  currentPaths: z.array(CurrentPathSchema),
  expectedStates: z.array(z.object({
    componentId: z.string(),
    state: z.string(),
    primitiveId: z.string().optional(),
    explanation: z.string().optional()
  })),
  warnings: z.array(z.string())
}).superRefine((plan, context) => {
  if (plan.status !== 'valid' && plan.currentPaths.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Current paths are only allowed for valid simulation plans',
      path: ['currentPaths']
    });
  }
});

export const AgentEventSchema = z.object({
  type: z.enum(['coordinator', 'subagent', 'tool', 'validation']),
  name: z.string(),
  status: z.enum(['started', 'completed', 'warning', 'error']),
  summary: z.string().optional()
});

export const ContextSourceTypeSchema = z.enum(['memory', 'skill', 'reference', 'data', 'registry', 'policy', 'validation', 'simulation', 'rendering']);

export const ContextRetrievalBudgetSchema = z.enum(['minimal', 'summary', 'data-only', 'full']);

export const ContextCoveragePurposeSchema = z.enum([
  'valid_circuit_synthesis',
  'clarification_response',
  'unsupported_response',
  'unsafe_refusal',
  'partial_visual_only'
]);

export const ContextTraceEntrySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: ContextSourceTypeSchema,
  reason: z.string().min(1),
  usedFields: z.array(z.string().min(1)).default([]),
  summary: z.string().optional()
});

export const ContextCoverageReportSchema = z.object({
  status: z.enum(['sufficient', 'insufficient']),
  score: z.number().min(0).max(1),
  sufficientFor: z.array(ContextCoveragePurposeSchema).default([]),
  synthesisEligibility: z.object({
    status: z.enum(['eligible', 'ineligible']),
    reason: z.string().min(1)
  }).default({
    status: 'ineligible',
    reason: 'Context coverage has not been classified for valid circuit synthesis.'
  }),
  requiredSourceTypes: z.array(ContextSourceTypeSchema).min(1),
  presentSourceTypes: z.array(ContextSourceTypeSchema),
  missingSourceTypes: z.array(ContextSourceTypeSchema),
  warnings: z.array(z.string())
});

export const ContextRouteSchema = z.object({
  routeId: z.string().min(1),
  intentSignals: z.array(z.string().min(1)).default([]),
  capabilityIds: z.array(z.string().min(1)).default([]),
  sourceIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1)
});

export const RetrievalPlanSchema = z.object({
  sourceIds: z.array(z.string().min(1)).default([]),
  omittedSourceIds: z.array(z.string().min(1)).default([]),
  budget: ContextRetrievalBudgetSchema,
  maxPromptChars: z.number().int().positive(),
  warnings: z.array(z.string().min(1)).default([])
});

export const ContextPacketSchema = z.object({
  locale: z.enum(['ko', 'en']),
  studentMessage: z.string().min(1),
  intentSpec: IntentSpecV2Schema,
  intentHints: z.object({
    outputModalities: z.array(z.string()),
    inputModalities: z.array(z.string()),
    protocols: z.array(z.string()),
    powerAssumptions: z.array(z.string()),
    safetyConcerns: z.array(z.string()),
    ambiguity: z.array(z.string())
  }),
  capabilityMatches: z.array(CapabilityGraphEntrySchema).default([]),
  candidateParts: z.array(PartCapabilitySchema),
  simulationPrimitives: z.array(SimulationPrimitiveSchema).default([]),
  renderFootprints: z.array(RenderFootprintEntrySchema).default([]),
  requiredContextIds: z.array(z.string()),
  unsupportedSignals: z.array(z.string()),
  supportGaps: z.array(z.string()).default([]),
  contextRoute: ContextRouteSchema,
  retrievalPlan: RetrievalPlanSchema,
  contextTrace: z.array(ContextTraceEntrySchema).min(1),
  contextCoverage: ContextCoverageReportSchema,
  promptBlock: z.string().min(1)
});

export const AgentRunResultSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.literal('live'),
  assistantMessages: z.array(z.string()),
  agentEvents: z.array(AgentEventSchema),
  clarification: z.string().nullable(),
  contextTrace: z.array(ContextTraceEntrySchema).min(1),
  contextCoverage: ContextCoverageReportSchema,
  requirementMarkdown: z.string(),
  circuitSpec: CircuitSpecSchema,
  validationReport: ValidationReportSchema,
  renderPlan: RenderPlanSchema,
  simulationPlan: SimulationPlanSchema
});

export const ConversationTurnSchema = z.object({
  role: z.enum(['student', 'assistant']),
  text: z.string().min(1).max(2000)
});

export const AgentArtifactSnapshotSchema = z.object({
  source: z.enum(['draft', 'built-project']),
  title: z.string().min(1),
  requirementMarkdown: z.string().max(12000).optional(),
  circuitSpec: CircuitSpecSchema.optional(),
  validationReport: ValidationReportSchema.optional(),
  renderPlan: RenderPlanSchema.optional(),
  simulationPlan: SimulationPlanSchema.optional()
});

export const AgentConversationContextSchema = z.object({
  recentTurns: z.array(ConversationTurnSchema).max(12).default([]),
  currentArtifact: AgentArtifactSnapshotSchema.optional(),
  lastSupportedGoal: z.string().max(500).optional(),
  awaitingBuildConfirmation: z.boolean().default(false)
});

export const AgentMessageRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
  confirmation: z.string().optional(),
  mode: z.literal('live').optional(),
  locale: z.enum(['ko', 'en']).default('ko'),
  conversationContext: AgentConversationContextSchema.optional()
});

export const TutorTargetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['circuit', 'connection', 'part']),
  label: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  detail: z.string().optional(),
  why: z.string().min(1),
  missing: z.string().min(1),
  signal: z.string().optional(),
  connectionId: z.string().optional(),
  partId: z.string().optional(),
  endpoints: z.array(z.string()).optional(),
  questions: z.array(z.string()).default([])
});

export const TutorArtifactsSchema = z.object({
  circuitSpec: CircuitSpecSchema,
  validationReport: ValidationReportSchema,
  simulationPlan: SimulationPlanSchema,
  contextTrace: z.array(ContextTraceEntrySchema).default([])
});

export const TutorMessageRequestSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const request = value as Record<string, unknown>;
  if (!request.target && request.selectedTarget) {
    return {
      ...request,
      target: request.selectedTarget
    };
  }
  return value;
}, z.object({
  sessionId: z.string().optional(),
  locale: z.enum(['ko', 'en']).default('ko'),
  question: z.string().min(1),
  running: z.boolean().default(false),
  circuitTitle: z.string().optional(),
  selectedTarget: TutorTargetSchema.optional(),
  target: TutorTargetSchema,
  artifacts: TutorArtifactsSchema
}));

export const TutorMessageResponseSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.enum(['local', 'live']),
  message: z.string().min(1),
  grounding: z.array(z.string()),
  suggestedQuestions: z.array(z.string())
});

export type AgentMessageRequest = z.infer<typeof AgentMessageRequestSchema>;
export type AgentConversationContext = z.infer<typeof AgentConversationContextSchema>;
export type AgentArtifactSnapshot = z.infer<typeof AgentArtifactSnapshotSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
export type CapabilityGraphEntry = z.infer<typeof CapabilityGraphEntrySchema>;
export type ContextPacket = z.infer<typeof ContextPacketSchema>;
export type ContextCoverageReport = z.infer<typeof ContextCoverageReportSchema>;
export type ContextRoute = z.infer<typeof ContextRouteSchema>;
export type ContextRetrievalBudget = z.infer<typeof ContextRetrievalBudgetSchema>;
export type ContextTraceEntry = z.infer<typeof ContextTraceEntrySchema>;
export type RetrievalPlan = z.infer<typeof RetrievalPlanSchema>;
export type CircuitSpec = z.infer<typeof CircuitSpecSchema>;
export type CurrentPath = z.infer<typeof CurrentPathSchema>;
export type IntentSpecV2 = z.infer<typeof IntentSpecV2Schema>;
export type Netlist = z.infer<typeof NetlistSchema>;
export type PartCapability = z.infer<typeof PartCapabilitySchema>;
export type RenderFootprintEntry = z.infer<typeof RenderFootprintEntrySchema>;
export type RenderPlan = z.infer<typeof RenderPlanSchema>;
export type SimulationPlan = z.infer<typeof SimulationPlanSchema>;
export type SimulationPrimitive = z.infer<typeof SimulationPrimitiveSchema>;
export type TopologyTemplate = z.infer<typeof TopologyTemplateSchema>;
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
export type TutorMessageRequest = z.infer<typeof TutorMessageRequestSchema>;
export type TutorMessageResponse = z.infer<typeof TutorMessageResponseSchema>;
export type TutorTarget = z.infer<typeof TutorTargetSchema>;
