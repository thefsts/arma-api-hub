// Shared audit-event writer.
//
// Used by the audit module and by privileged cost-control operations so that
// every warning, throttle, block, approval, and shutdown produces an audit
// record within the same transaction. Metadata is redaction-safe.

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { redactMetadata } from './redaction';

export interface AuditInput {
  readonly actor: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  readonly correlationId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Insert a redaction-safe audit event. Returns the new audit row id. */
export async function writeAuditEvent(
  ctx: MutationCtx,
  input: AuditInput,
): Promise<Id<'auditEvents'>> {
  const safe = redactMetadata(input.metadata ?? {});
  return await ctx.db.insert('auditEvents', {
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome: input.outcome,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(Object.keys(safe).length > 0 ? { metadata: safe } : {}),
    createdAt: Date.now(),
  });
}
