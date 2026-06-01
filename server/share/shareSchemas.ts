import { z } from 'zod';

const ISODateStringSchema = z.string().datetime({ offset: true });
const ShareIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const SafeShortTextSchema = z.string().min(1).max(80);
const SafeSummarySchema = z.string().min(1).max(280);

export const ShareSnapshotSchema = z.object({
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

export const ShareCreateRequestSchema = z.object({
  snapshot: ShareSnapshotSchema.omit({ id: true })
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
