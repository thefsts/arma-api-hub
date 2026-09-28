// Contract catalog: every named contract has a schema and a sanitized fixture
// that validates against it. Fixtures contain placeholder values only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_CATALOG,
  getCatalogEntry,
  signedReceiptSchema,
  validate,
  webhookDeliveryEnvelopeSchema,
} from '@arma/contracts';

const root = fileURLToPath(new URL('../../', import.meta.url));

const FIXTURES: Record<string, string> = {
  'apiHub.service.register': 'contracts/api/apiHub.service.register.json',
  'apiHub.service.rotateCredential': 'contracts/api/apiHub.service.rotateCredential.json',
  'apiHub.contract.publish': 'contracts/api/apiHub.contract.publish.json',
  'apiHub.event.publish': 'contracts/api/apiHub.event.publish.json',
  'apiHub.webhook.deliver': 'contracts/api/apiHub.webhook.deliver.json',
  'apiHub.receipt.verify': 'contracts/api/apiHub.receipt.verify.json',
  'apiHub.connector.health': 'contracts/events/apiHub.connector.health.json',
  'apiHub.connector.incident': 'contracts/events/apiHub.connector.incident.json',
  'apiHub.killSwitch.update': 'contracts/api/apiHub.killSwitch.update.json',
  'compliance.evaluate': 'contracts/api/compliance.evaluate.json',
  'compliance.decisionReceipt': 'contracts/events/compliance.decisionReceipt.json',
  'cannabis.regulatedActionRequested': 'contracts/events/cannabis.regulatedActionRequested.json',
  'cannabis.custodyStatusChanged': 'contracts/events/cannabis.custodyStatusChanged.json',
  'operon.posPanicTriggered': 'contracts/events/operon.posPanicTriggered.json',
  'operon.regulatedTransactionStatusChanged':
    'contracts/events/operon.regulatedTransactionStatusChanged.json',
};

function loadFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(`${root}${relativePath}`, 'utf8'));
}

describe('contract catalog', () => {
  it('defines exactly 15 named contracts', () => {
    expect(CONTRACT_CATALOG).toHaveLength(15);
    const names = CONTRACT_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(15);
  });

  it('has a sanitized fixture for every catalog entry', () => {
    for (const entry of CONTRACT_CATALOG) {
      expect(FIXTURES[entry.name], `missing fixture for ${entry.name}`).toBeDefined();
    }
  });

  it('validates every fixture against its contract schema', () => {
    for (const entry of CONTRACT_CATALOG) {
      const fixturePath = FIXTURES[entry.name];
      expect(fixturePath).toBeDefined();
      const fixture = loadFixture(fixturePath as string);
      const result = validate(entry.payload, fixture);
      expect(result.ok, `fixture for ${entry.name} failed validation`).toBe(true);
    }
  });

  it('rejects a fixture with an unknown field (strict schemas)', () => {
    const entry = getCatalogEntry('apiHub.connector.health');
    expect(entry).toBeDefined();
    const fixture = loadFixture('contracts/events/apiHub.connector.health.json') as Record<
      string,
      unknown
    >;
    const result = validate(entry!.payload, { ...fixture, unexpected: true });
    expect(result.ok).toBe(false);
  });

  it('validates the signed receipt and webhook delivery fixtures', () => {
    expect(
      validate(signedReceiptSchema, loadFixture('contracts/receipts/signed-receipt.example.json'))
        .ok,
    ).toBe(true);
    expect(
      validate(
        webhookDeliveryEnvelopeSchema,
        loadFixture('contracts/webhooks/webhook-delivery.example.json'),
      ).ok,
    ).toBe(true);
  });

  it('never contains secret-like material in fixtures', () => {
    for (const relativePath of Object.values(FIXTURES)) {
      const raw = readFileSync(`${root}${relativePath}`, 'utf8');
      expect(raw).not.toMatch(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
      expect(raw).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });
});
