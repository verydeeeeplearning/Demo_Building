import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Category taxonomy for interactive slot-fill (data-driven; curated content lives in
// agent-context/data/slot-policy.json per CLAUDE.md). Options are derived from the WHOLE supported
// capability set via this taxonomy — never a hand-picked subset. The coverage test (slotPolicy.test.ts)
// guarantees every supported capability is assigned exactly once, so nothing is silently dropped.
//
// Flow: propose the output CATEGORIES → student taps one → propose the capabilities in it → student taps
// one. Selection resumes by `capabilityId` (structured), so no per-capability routing phrase is authored.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');
const SLOT_POLICY_PATH = 'data/slot-policy.json';

const LocalizedTextSchema = z.object({ ko: z.string().min(1), en: z.string().min(1) });

const CategoryOptionSchema = z.object({
  capabilityId: z.string().min(1),
  label: LocalizedTextSchema
});

const CategorySchema = z.object({
  id: z.string().min(1),
  label: LocalizedTextSchema,
  options: z.array(CategoryOptionSchema).min(1)
});

const SlotPolicySchema = z.object({
  schemaVersion: z.literal(2),
  description: z.string().optional(),
  categories: z.array(CategorySchema).min(1),
  contextCapabilities: z.array(z.string().min(1)).default([])
});

export type SlotPolicy = z.infer<typeof SlotPolicySchema>;
export type Locale = 'ko' | 'en';

// A grounded, student-facing choice. Top level = a category; drill-down = a capability.
export type SlotOption = {
  id: string;
  label: string;
  capabilityId?: string;
};

let cachedPolicy: SlotPolicy | null = null;

export async function loadSlotPolicy(root = DEFAULT_CONTEXT_ROOT): Promise<SlotPolicy> {
  if (cachedPolicy && root === DEFAULT_CONTEXT_ROOT) {
    return cachedPolicy;
  }
  const raw = await readFile(path.join(root, SLOT_POLICY_PATH), 'utf8');
  const policy = SlotPolicySchema.parse(JSON.parse(raw));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedPolicy = policy;
  }
  return policy;
}

// Top-level "output" slot options: the build categories.
export async function outputCategories(locale: Locale, root = DEFAULT_CONTEXT_ROOT): Promise<SlotOption[]> {
  const policy = await loadSlotPolicy(root);
  return policy.categories.map((category) => ({ id: category.id, label: category.label[locale] }));
}

// Drill-down: the supported capabilities within a category, as selectable options (carry capabilityId).
export async function capabilityOptions(categoryId: string, locale: Locale, root = DEFAULT_CONTEXT_ROOT): Promise<SlotOption[]> {
  const policy = await loadSlotPolicy(root);
  const category = policy.categories.find((candidate) => candidate.id === categoryId);
  if (!category) {
    throw new Error(`Unknown slot category: ${categoryId}`);
  }
  return category.options.map((option) => ({
    id: option.capabilityId,
    label: option.label[locale],
    capabilityId: option.capabilityId
  }));
}

export async function categoryOfCapability(capabilityId: string, root = DEFAULT_CONTEXT_ROOT): Promise<string | null> {
  const policy = await loadSlotPolicy(root);
  const match = policy.categories.find((category) =>
    category.options.some((option) => option.capabilityId === capabilityId)
  );
  return match?.id ?? null;
}

// Every capabilityId the taxonomy accounts for (build categories + context), for coverage checks.
export async function assignedCapabilityIds(root = DEFAULT_CONTEXT_ROOT): Promise<{ build: string[]; context: string[] }> {
  const policy = await loadSlotPolicy(root);
  return {
    build: policy.categories.flatMap((category) => category.options.map((option) => option.capabilityId)),
    context: [...policy.contextCapabilities]
  };
}
