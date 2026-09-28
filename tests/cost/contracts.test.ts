// Cost & Usage Guard — contract and boundary tests.
//
// Verifies the normalized cost-event contracts, the AI Hub handoff contract,
// and the REGIVANTA export contract, and enforces the locked cost-ownership
// boundaries. Fixtures are sanitized and contain no production vendors.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COST_CONTRACT_CATALOG,
  COST_EVENT_SCHEMAS,
  aiExecutionCostReferenceSchema,
  costExportEnvelopeSchema,
  validate,
} from '@arma/contracts';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../contracts/cost/${name}`, import.meta.url)), 'utf8'),
  );

const FORBIDDEN_AI_KEYS = [
  'modelId',
  'model',
  'modelName',
  'provider',
  'prompt',
  'prompts',
  'systemPrompt',
  'temperature',
  'maxTokens',
  'agentReasoning',
  'reasoning',
  'ragContent',
  'embedding',
  'conversation',
];

const FORBIDDEN_PROFITABILITY_KEYS = [
  'netProfit',
  'grossMargin',
  'contributionMargin',
  'profit',
  'profitability',
  'margin',
  'mrr',
  'arr',
  'operatingCost',
  'companyOperatingCost',
  'allocatedInfrastructureCost',
];

function shapeKeys(schema: { shape?: Record<string, unknown> }): string[] {
  return schema.shape ? Object.keys(schema.shape) : [];
}

describe('normalized cost-event contracts', () => {
  it('declares all 11 normalized cost events', () => {
    expect(Object.keys(COST_EVENT_SCHEMAS)).toHaveLength(11);
  });

  it('validates every sanitized cost-event fixture against its schema', () => {
    const fixtures: Array<[string, keyof typeof COST_EVENT_SCHEMAS]> = [
      ['apiHub.apiUsageRecorded.example.json', 'apiHub.apiUsageRecorded'],
      ['apiHub.apiCostRecorded.example.json', 'apiHub.apiCostRecorded'],
      ['apiHub.retryWasteRecorded.example.json', 'apiHub.retryWasteRecorded'],
      ['apiHub.cacheSavingsRecorded.example.json', 'apiHub.cacheSavingsRecorded'],
      ['apiHub.batchSavingsRecorded.example.json', 'apiHub.batchSavingsRecorded'],
      ['apiHub.quotaThresholdReached.example.json', 'apiHub.quotaThresholdReached'],
      ['apiHub.budgetThresholdReached.example.json', 'apiHub.budgetThresholdReached'],
      ['apiHub.costAnomalyDetected.example.json', 'apiHub.costAnomalyDetected'],
      ['apiHub.connectorSpendBlocked.example.json', 'apiHub.connectorSpendBlocked'],
      ['apiHub.vendorShutdownActivated.example.json', 'apiHub.vendorShutdownActivated'],
      ['apiHub.costExported.example.json', 'apiHub.costExported'],
    ];
    for (const [file, eventType] of fixtures) {
      const result = validate(COST_EVENT_SCHEMAS[eventType], fixture(file));
      expect(result.ok, `${file} should validate`).toBe(true);
    }
  });

  it('SCENARIO 19: every cost event requires correlation and causation identifiers', () => {
    for (const schema of Object.values(COST_EVENT_SCHEMAS)) {
      const keys = shapeKeys(schema as unknown as { shape?: Record<string, unknown> });
      expect(keys).toContain('correlationId');
      expect(keys).toContain('causationId');
      expect(keys).toContain('idempotencyKey');
      expect(keys).toContain('costEventId');
    }
  });

  it('SCENARIO 5: monetary fields are integer minor units, never floats', () => {
    const result = validate(COST_EVENT_SCHEMAS['apiHub.apiCostRecorded'], {
      ...(fixture('apiHub.apiCostRecorded.example.json') as Record<string, unknown>),
      amountMinor: 12.5,
    });
    expect(result.ok).toBe(false);
  });

  it('SCENARIO 17: cost contracts never carry AI-model selection or prompt fields', () => {
    for (const schema of Object.values(COST_EVENT_SCHEMAS)) {
      const keys = shapeKeys(schema as unknown as { shape?: Record<string, unknown> });
      for (const forbidden of FORBIDDEN_AI_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});

describe('AI Hub handoff contract', () => {
  it('SCENARIO 15: references an authoritative API Hub cost event without a monetary amount', () => {
    const keys = shapeKeys(aiExecutionCostReferenceSchema);
    expect(keys).toContain('apiHubCostEventId');
    // No monetary fields: AI Hub references, it does not re-emit a charge.
    expect(keys).not.toContain('amountMinor');
    expect(keys).not.toContain('currency');
    expect(keys).not.toContain('pricingVersionId');
  });

  it('SCENARIO 18: AI Hub contract cannot recreate API billing fields', () => {
    const keys = shapeKeys(aiExecutionCostReferenceSchema);
    for (const forbidden of ['amountMinor', 'unitPriceMinor', 'quantity', 'unitType', 'vendorId']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('SCENARIO 17: AI Hub contract carries no prompts or model reasoning', () => {
    const keys = shapeKeys(aiExecutionCostReferenceSchema);
    for (const forbidden of FORBIDDEN_AI_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('validates the sanitized AI Hub reference fixture', () => {
    const result = validate(
      aiExecutionCostReferenceSchema,
      fixture('apiHub.aiExecutionCostReference.example.json'),
    );
    expect(result.ok).toBe(true);
  });
});

describe('REGIVANTA export contract', () => {
  it('SCENARIO 16: export carries no profitability, margin, or company-wide cost fields', () => {
    const keys = shapeKeys(costExportEnvelopeSchema);
    for (const forbidden of FORBIDDEN_PROFITABILITY_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
    const recordKeys = shapeKeys(
      costExportEnvelopeSchema.shape.records.element as unknown as {
        shape?: Record<string, unknown>;
      },
    );
    for (const forbidden of FORBIDDEN_PROFITABILITY_KEYS) {
      expect(recordKeys).not.toContain(forbidden);
    }
  });

  it('validates the sanitized REGIVANTA export fixture', () => {
    const result = validate(costExportEnvelopeSchema, fixture('apiHub.costExport.example.json'));
    expect(result.ok).toBe(true);
  });
});

describe('cost contract catalog', () => {
  it('registers all 11 cost events plus the two handoff contracts', () => {
    expect(COST_CONTRACT_CATALOG).toHaveLength(13);
    const names = COST_CONTRACT_CATALOG.map((entry) => entry.name);
    expect(names).toContain('apiHub.aiExecutionCostReference');
    expect(names).toContain('apiHub.costExport');
  });
});
