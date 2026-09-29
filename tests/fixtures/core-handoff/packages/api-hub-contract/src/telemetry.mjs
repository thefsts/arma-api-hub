// FSTS Compliance Core — Phase 6
// API Hub Contract — API usage / cost telemetry handoff.
// ---------------------------------------------------------------------------
// Split of ownership (locked): the API Hub owns vendor/API usage/cost TRANSPORT
// (metering vendor calls, cost aggregation, billing connectors). Compliance
// Core owns the COMPLIANCE-side telemetry metadata: which governed action was
// performed, for which tenant/product, under which contract version, and the
// correlation linkage. The handoff record is metadata only — never vendor
// secrets, never raw evidence.
// ---------------------------------------------------------------------------

import { TELEMETRY_UNITS, COST_CURRENCIES } from './constants.mjs';
import { sha256Of } from './hash.mjs';

/** Build a usage/cost telemetry handoff record (metadata only, deterministic). */
export function buildTelemetryRecord(input) {
  const record = {
    telemetryId: input.telemetryId,
    correlationId: input.correlationId,
    requestId: input.requestId ?? null,
    tenantId: input.tenantId,
    productId: input.productId,
    serviceIdentityId: input.serviceIdentityId,
    action: input.action,
    apiVersion: input.apiVersion,
    direction: input.direction ?? 'INBOUND',
    units: Array.isArray(input.units) ? input.units : [],
    costUnits: typeof input.costUnits === 'number' ? input.costUnits : 0,
    currency: COST_CURRENCIES.includes(input.currency) ? input.currency : 'USD',
    vendorRef: input.vendorRef ?? null, // reference only — never a vendor secret
    occurredAt: input.occurredAt,
    recordStatus: input.recordStatus ?? 'EXAMPLE',
  };
  record.integrityHash = sha256Of(record);
  return record;
}

/** Validate a telemetry record's unit vocabulary + integrity. */
export function validateTelemetryRecord(record) {
  if (record === null || typeof record !== 'object') {
    return { ok: false, code: 'VALIDATION_MALFORMED' };
  }
  for (const u of record.units ?? []) {
    if (!TELEMETRY_UNITS.includes(u.unit)) {
      return { ok: false, code: 'VALIDATION_MALFORMED', field: 'units' };
    }
  }
  const clone = {};
  for (const k of Object.keys(record)) {
    if (k === 'integrityHash') continue;
    clone[k] = record[k];
  }
  if (sha256Of(clone) !== record.integrityHash) {
    return { ok: false, code: 'INTEGRITY_MISMATCH', field: 'integrityHash' };
  }
  return { ok: true, code: null };
}

/** Aggregate a deterministic usage/cost summary over telemetry records. */
export function summarizeTelemetry(records) {
  const list = Array.isArray(records) ? records : [];
  const byAction = {};
  let costUnits = 0;
  for (const r of list) {
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    costUnits += typeof r.costUnits === 'number' ? r.costUnits : 0;
  }
  return {
    recordCount: list.length,
    byAction,
    costUnits,
    currency: 'USD',
  };
}
