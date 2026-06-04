import { createHash, randomUUID } from 'node:crypto';

import type { AgentMessageRequest } from './schemas.ts';

const CLIENT_ID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{8,120}$/;
const PENDING_INTERACTION_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_INTERACTIONS = 500;

type PendingAgentInteraction = {
  sessionId: string;
  taskId?: string;
  threadId: string;
  interactionId: string;
  frameworkInterruptId?: string;
  level: string;
  optionIds: string[];
  createdAtMs: number;
  expiresAtMs: number;
};

const activeThreadTurns = new Map<string, string>();
const activeTaskBySession = new Map<string, { taskId?: string; epoch: number }>();
const pendingInteractionsByThread = new Map<string, PendingAgentInteraction>();

export class AgentThreadBusyError extends Error {
  readonly errorCode = 'AGENT_THREAD_BUSY';
  readonly status = 409;

  constructor(readonly threadId: string) {
    super('Agent thread is already processing a turn.');
    this.name = 'AgentThreadBusyError';
  }
}

export class StaleAgentResumeError extends Error {
  readonly errorCode = 'STALE_AGENT_RESUME';
  readonly status = 409;

  constructor(message = 'Clarification resume is stale or no longer active.') {
    super(message);
    this.name = 'StaleAgentResumeError';
  }
}

export function effectiveAgentRequestKind(request: AgentMessageRequest) {
  if (request.resume) {
    return 'resume_clarification' as const;
  }
  return request.requestKind ?? 'initial_task';
}

export function resolveAgentThreadId(input: { sessionId: string; taskId?: string }) {
  const session = encodeThreadIdPart(input.sessionId);
  const task = input.taskId ? encodeThreadIdPart(input.taskId) : null;
  return task ? `session.${session}.task.${task}` : `session.${session}`;
}

export function normalizeClientTaskId(value: string | undefined) {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value) ? value : undefined;
}

export function beginAgentThreadTurn(input: {
  sessionId: string;
  taskId?: string;
  turnId?: string;
  threadId: string;
  requestKind: ReturnType<typeof effectiveAgentRequestKind>;
}) {
  pruneExpiredPendingInteractions();
  if (activeThreadTurns.has(input.threadId)) {
    throw new AgentThreadBusyError(input.threadId);
  }
  activeThreadTurns.set(input.threadId, input.turnId ?? randomUUID());

  const current = activeTaskBySession.get(input.sessionId);
  const nextEpoch = (current?.epoch ?? 0) + (
    input.requestKind === 'new_task' || input.requestKind === 'initial_task' ? 1 : 0
  );
  if (input.taskId || input.requestKind === 'new_task' || input.requestKind === 'initial_task') {
    activeTaskBySession.set(input.sessionId, { taskId: input.taskId, epoch: nextEpoch });
  }

  return {
    epoch: activeTaskBySession.get(input.sessionId)?.epoch ?? 0,
    release() {
      if (activeThreadTurns.get(input.threadId) === (input.turnId ?? activeThreadTurns.get(input.threadId))) {
        activeThreadTurns.delete(input.threadId);
      }
    }
  };
}

export function assertActiveTaskEpoch(input: { sessionId: string; taskId?: string; epoch: number }) {
  const current = activeTaskBySession.get(input.sessionId);
  if (!current) {
    return;
  }
  if (current.epoch !== input.epoch || current.taskId !== input.taskId) {
    throw new StaleAgentResumeError('The active task changed before the resume could be applied.');
  }
}

export function registerPendingAgentInteraction(input: {
  sessionId: string;
  taskId?: string;
  threadId: string;
  level: string;
  optionIds: string[];
  frameworkInterruptId?: string;
  nowMs?: number;
}) {
  pruneExpiredPendingInteractions(input.nowMs);
  const nowMs = input.nowMs ?? Date.now();
  const interaction: PendingAgentInteraction = {
    sessionId: input.sessionId,
    taskId: input.taskId,
    threadId: input.threadId,
    interactionId: `clarify-${randomUUID().replace(/-/g, '')}`,
    frameworkInterruptId: input.frameworkInterruptId,
    level: input.level,
    optionIds: input.optionIds,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PENDING_INTERACTION_TTL_MS
  };
  pendingInteractionsByThread.set(input.threadId, interaction);
  capPendingInteractions();
  return interaction;
}

export function validateAndConsumePendingAgentInteraction(input: {
  sessionId: string;
  taskId?: string;
  threadId: string;
  resumeInteractionId?: string;
  resumeValue?: string;
  nowMs?: number;
}) {
  pruneExpiredPendingInteractions(input.nowMs);
  const pending = pendingInteractionsByThread.get(input.threadId);
  if (!pending) {
    throw new StaleAgentResumeError();
  }
  if (pending.sessionId !== input.sessionId || pending.taskId !== input.taskId) {
    throw new StaleAgentResumeError('Clarification belongs to a different task.');
  }
  if (!input.resumeInteractionId || pending.interactionId !== input.resumeInteractionId) {
    throw new StaleAgentResumeError('Clarification interaction id is no longer current.');
  }
  if (input.resumeValue && !pending.optionIds.includes(input.resumeValue)) {
    throw new StaleAgentResumeError('Clarification option is no longer available.');
  }
  pendingInteractionsByThread.delete(input.threadId);
  return pending;
}

export function clearPendingAgentInteraction(threadId: string) {
  pendingInteractionsByThread.delete(threadId);
}

export function __resetAgentThreadSessionForTests() {
  activeThreadTurns.clear();
  activeTaskBySession.clear();
  pendingInteractionsByThread.clear();
}

function encodeThreadIdPart(value: string) {
  if (CLIENT_ID_PATTERN.test(value)) {
    return value;
  }
  return createHash('sha256').update(value).digest('base64url').slice(0, 32);
}

function pruneExpiredPendingInteractions(nowMs = Date.now()) {
  for (const [threadId, pending] of pendingInteractionsByThread.entries()) {
    if (pending.expiresAtMs <= nowMs) {
      pendingInteractionsByThread.delete(threadId);
    }
  }
}

function capPendingInteractions() {
  if (pendingInteractionsByThread.size <= MAX_PENDING_INTERACTIONS) {
    return;
  }
  const sorted = [...pendingInteractionsByThread.entries()]
    .sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
  for (const [threadId] of sorted.slice(0, pendingInteractionsByThread.size - MAX_PENDING_INTERACTIONS)) {
    pendingInteractionsByThread.delete(threadId);
  }
}
