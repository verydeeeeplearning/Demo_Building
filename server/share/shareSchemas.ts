import { z } from 'zod';

const ISODateStringSchema = z.string().datetime({ offset: true });
const ShareIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const SafeShortTextSchema = z.string().min(1).max(80);
const SafeSummarySchema = z.string().min(1).max(280);
const ShareBuildRunnableReportSchema = z.object({
  status: z.enum(['runnable', 'blocked']),
  runnable: z.boolean(),
  reasons: z.array(z.string().max(500)).max(20),
  validationStatus: z.string().min(1).max(40),
  simulationStatus: z.string().min(1).max(40),
  renderWarningCount: z.number().int().nonnegative(),
  renderBlockingWarningCount: z.number().int().nonnegative(),
  renderPartCount: z.number().int().nonnegative(),
  currentPathCount: z.number().int().nonnegative(),
  expectedStateCount: z.number().int().nonnegative()
}).superRefine((report, context) => {
  if (report.status === 'runnable' && !report.runnable) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Runnable share reports must set runnable=true',
      path: ['runnable']
    });
  }
  if (report.status === 'blocked' && report.runnable) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Blocked share reports must set runnable=false',
      path: ['runnable']
    });
  }
  if (report.runnable && report.currentPathCount === 0 && report.expectedStateCount === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Runnable share reports require current-path or expected-state evidence',
      path: ['currentPathCount']
    });
  }
});

const ShareSnapshotBaseSchema = z.object({
  schemaVersion: z.literal(1),
  id: ShareIdSchema.optional(),
  createdAt: ISODateStringSchema,
  locale: z.enum(['ko', 'en']),
  title: SafeShortTextSchema,
  summary: SafeSummarySchema,
  status: z.enum(['valid', 'warning', 'invalid', 'draft']),
  source: z.enum(['agent', 'demo', 'imported']),
  studentPromptSummary: z.string().max(280).optional(),
  requirementMarkdown: z.string().max(12000),
  circuit: z.object({
    name: SafeShortTextSchema,
    description: z.string().max(500),
    components: z.array(z.object({
      id: z.string().min(1).max(120),
      type: z.string().min(1).max(80),
      name: z.string().min(1).max(120),
      role: z.string().max(160).optional()
    })).max(80),
    connections: z.array(z.object({
      from: z.string().min(1).max(160),
      to: z.string().min(1).max(160),
      label: z.string().max(160).optional()
    })).max(200)
  }),
  validation: z.object({
    status: z.enum(['valid', 'warning', 'invalid']),
    warnings: z.array(z.string().max(500)).max(30),
    unsupportedItems: z.array(z.string().max(500)).max(30)
  }),
  buildRunnableReport: ShareBuildRunnableReportSchema.optional(),
  solverGateResult: z.unknown().optional(),
  simulation: z.object({
    available: z.boolean(),
    runText: z.string().max(120).optional(),
    explanation: z.string().max(1000),
    currentPathCount: z.number().int().min(0).max(60)
  }),
  renderPlan: z.unknown().optional(),
  contextEvidence: z.object({
    coverageStatus: z.string().min(1).max(80),
    score: z.number().min(0).max(1).optional(),
    sourceTypes: z.array(z.string().min(1).max(80)).max(20),
    warnings: z.array(z.string().max(500)).max(20)
  }).optional()
});

function refineShareSnapshot(snapshot: z.infer<typeof ShareSnapshotBaseSchema>, context: z.RefinementCtx) {
  const requiresRunnableReport = snapshot.source !== 'demo'
    && (snapshot.status === 'valid' || snapshot.simulation.available === true);
  if (requiresRunnableReport && !snapshot.buildRunnableReport) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent/imported valid shares require buildRunnableReport evidence',
      path: ['buildRunnableReport']
    });
  }
  if (snapshot.status === 'valid' && snapshot.source !== 'demo' && snapshot.buildRunnableReport?.runnable !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Valid agent/imported shares require a runnable build report',
      path: ['buildRunnableReport', 'runnable']
    });
  }
  if (snapshot.simulation.available && snapshot.status !== 'valid') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Simulation can only be available on valid shares',
      path: ['simulation', 'available']
    });
  }
  if (snapshot.simulation.available && snapshot.source !== 'demo' && snapshot.buildRunnableReport?.runnable !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent/imported simulation availability requires a runnable build report',
      path: ['buildRunnableReport', 'runnable']
    });
  }
}

export const ShareSnapshotSchema = ShareSnapshotBaseSchema.superRefine(refineShareSnapshot);

export const ShareCreateRequestSchema = z.object({
  snapshot: ShareSnapshotBaseSchema.omit({ id: true }).superRefine(refineShareSnapshot)
});

export const ShareCreateResponseSchema = z.object({
  shareId: ShareIdSchema,
  shareUrl: z.string().url(),
  createdAt: ISODateStringSchema
});

export const ShareReadResponseSchema = z.object({
  snapshot: ShareSnapshotSchema
});

export const StoredShareSchema = z.object({
  shareId: ShareIdSchema,
  createdAt: ISODateStringSchema,
  snapshot: ShareSnapshotSchema
});

export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;
export type ShareCreateRequest = z.infer<typeof ShareCreateRequestSchema>;
export type ShareCreateResponse = z.infer<typeof ShareCreateResponseSchema>;
export type ShareReadResponse = z.infer<typeof ShareReadResponseSchema>;
export type StoredShare = z.infer<typeof StoredShareSchema>;
