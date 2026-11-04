// FSTS Governed Product Conformance Kit — deterministic report assembly.
//
// A conformance report is evidence that a product's governed integration
// satisfies the integration contract. It is NEVER a compliance verdict and
// NEVER a certification. `result: 'CONFORMANT'` means exactly that: conformant
// to the governed integration contract at a specific manifest hash.

import { CONFORMANCE_SUITE_VERSION } from '@fsts/governed-product-client';
import type { GovernedProductManifest } from '@fsts/governed-product-client';
import { runAreas } from './areas.js';
import type { AreaContext, AreaResult } from './areas.js';
import { manifestHash } from './harness.js';

export type ConformanceResult = 'CONFORMANT' | 'NON_CONFORMANT';

export interface ConformanceSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
}

export interface ConformanceReport {
  readonly suiteVersion: string;
  readonly productId: string;
  readonly integrationVersion: string;
  readonly manifestHash: string;
  readonly areas: readonly AreaResult[];
  readonly summary: ConformanceSummary;
  readonly result: ConformanceResult;
  /** Explicit, non-negotiable: this report is not a compliance verdict. */
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
  readonly generatedAt: string;
}

export interface RunConformanceInput {
  readonly manifest: GovernedProductManifest;
  readonly environment: AreaContext['environment'];
  readonly tenantId: string;
  readonly credentialReference: string;
  readonly generatedAt?: string;
}

/**
 * Execute all conformance areas against the subject manifest and assemble a
 * deterministic report. Area order is the canonical CONFORMANCE_AREAS order and
 * is never sorted.
 */
export async function runConformance(input: RunConformanceInput): Promise<ConformanceReport> {
  const areas = await runAreas({
    manifest: input.manifest,
    environment: input.environment,
    tenantId: input.tenantId,
    credentialReference: input.credentialReference,
  });

  const passed = areas.filter((a) => a.status === 'PASS').length;
  const failed = areas.length - passed;

  return Object.freeze({
    suiteVersion: CONFORMANCE_SUITE_VERSION,
    productId: input.manifest.productId,
    integrationVersion: input.manifest.integrationVersion,
    manifestHash: manifestHash(input.manifest),
    areas,
    summary: { total: areas.length, passed, failed },
    result: failed === 0 ? 'CONFORMANT' : 'NON_CONFORMANT',
    complianceClaim: 'NONE',
    certificationClaim: 'NONE',
    generatedAt: input.generatedAt ?? '1970-01-01T00:00:00.000Z',
  });
}

/** Render a report as a stable, human-reviewable text block. */
export function formatReport(report: ConformanceReport): string {
  const lines: string[] = [];
  lines.push(`FSTS Governed Product Conformance Report`);
  lines.push(`suiteVersion: ${report.suiteVersion}`);
  lines.push(`productId: ${report.productId}`);
  lines.push(`integrationVersion: ${report.integrationVersion}`);
  lines.push(`manifestHash: ${report.manifestHash}`);
  lines.push(`result: ${report.result}`);
  lines.push(`complianceClaim: ${report.complianceClaim}  (a PASS is never COMPLIANT)`);
  lines.push(`certificationClaim: ${report.certificationClaim}`);
  lines.push('');
  for (const area of report.areas) {
    lines.push(`${area.status.padEnd(4)} ${area.id.padEnd(4)} ${area.name} — ${area.evidence}`);
  }
  lines.push('');
  lines.push(
    `summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`,
  );
  return lines.join('\n');
}
