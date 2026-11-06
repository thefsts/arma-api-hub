// ARMA API Hub — transport cost telemetry ownership boundary.
//
// PM-locked cost ownership (unchanged from the approved design):
//
//   ARMA API Hub          -> external API calls, connectors, webhooks,
//                            messaging/API usage, transport and storage overhead
//   AI Hub                -> model / token / agent costs
//   REGIVANTA Cost Guard  -> profitability / margin
//
// These responsibilities are NOT merged. The Hub emits transport cost
// references only. It must never carry a model/token field or a profitability
// field, and it must never become the system of record for margin.

export const COST_OWNER = 'API_HUB' as const;

/** The only cost categories the Hub may record. */
export const API_HUB_COST_CATEGORIES = [
  'EXTERNAL_API',
  'CONNECTOR',
  'WEBHOOK',
  'MESSAGING',
  'TRANSPORT',
  'STORAGE',
] as const;

export type ApiHubCostCategory = (typeof API_HUB_COST_CATEGORIES)[number];

/** Categories owned by another system. The Hub must reject these. */
export const FOREIGN_COST_CATEGORIES = [
  'MODEL_INFERENCE',
  'TOKEN_USAGE',
  'AGENT_EXECUTION',
  'PROFITABILITY',
  'MARGIN',
] as const;

/** Fields that belong to AI Hub or REGIVANTA and must never appear here. */
export const FORBIDDEN_COST_FIELDS = [
  'margin',
  'marginMinor',
  'profit',
  'profitMinor',
  'profitability',
  'markup',
  'markupPct',
  'tokenCount',
  'promptTokens',
  'completionTokens',
  'modelId',
  'modelProvider',
  'agentId',
] as const;

export interface TransportCostRecord {
  readonly costEventId: string;
  readonly traceId: string;
  readonly costOwner: typeof COST_OWNER;
  readonly costCategory: ApiHubCostCategory;
  /** Integer minor currency units. Never a float. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly vendorId?: string;
  readonly connectorId?: string;
  readonly billingPeriod: string;
  readonly recordedAt: number;
}

export type CostBoundaryViolation =
  | { readonly kind: 'FORBIDDEN_FIELD'; readonly field: string }
  | { readonly kind: 'FOREIGN_CATEGORY'; readonly category: string }
  | { readonly kind: 'NON_INTEGER_AMOUNT' }
  | { readonly kind: 'WRONG_OWNER'; readonly owner: string };

export type CostBoundaryResult =
  | { readonly ok: true; readonly record: TransportCostRecord }
  | { readonly ok: false; readonly violations: readonly CostBoundaryViolation[] };

/**
 * Validate a candidate transport cost record against the ownership boundary.
 * Fails closed on any foreign field, foreign category, non-integer amount, or
 * wrong owner.
 */
export function assertCostOwnershipBoundary(
  candidate: Record<string, unknown>,
): CostBoundaryResult {
  const violations: CostBoundaryViolation[] = [];

  for (const key of Object.keys(candidate)) {
    if ((FORBIDDEN_COST_FIELDS as readonly string[]).includes(key)) {
      violations.push({ kind: 'FORBIDDEN_FIELD', field: key });
    }
  }

  const category = candidate['costCategory'];
  if (
    typeof category === 'string' &&
    (FOREIGN_COST_CATEGORIES as readonly string[]).includes(category)
  ) {
    violations.push({ kind: 'FOREIGN_CATEGORY', category });
  }
  if (
    typeof category !== 'string' ||
    !(API_HUB_COST_CATEGORIES as readonly string[]).includes(category)
  ) {
    violations.push({ kind: 'FOREIGN_CATEGORY', category: String(category) });
  }

  const amount = candidate['amountMinor'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    violations.push({ kind: 'NON_INTEGER_AMOUNT' });
  }

  const owner = candidate['costOwner'];
  if (owner !== COST_OWNER) {
    violations.push({ kind: 'WRONG_OWNER', owner: String(owner) });
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, record: candidate as unknown as TransportCostRecord };
}
