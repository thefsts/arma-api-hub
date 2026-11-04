// FSTS Governed Product Client — the transport seam.
//
// The ONLY egress a governed product client has is the injected HubTransport.
// There is no `fetchCore`, no Convex client, no database handle. A product can
// reach the Compliance Core ONLY through the ARMA API Hub. This module defines
// the seam and a deterministic in-memory double for tests and conformance.

import type { GovernedRequest } from '@arma/compliance-core-client';

/** A bounded Hub response. `ok:false` carries exactly one bounded denial code. */
export type HubResponse =
  | { readonly ok: true; readonly body: string; readonly correlationId: string }
  | {
      readonly ok: false;
      readonly code: string;
      readonly correlationId: string;
      readonly retryable?: boolean;
    };

/** The single egress seam. Implementations MUST speak only to the API Hub. */
export interface HubTransport {
  send(signed: GovernedRequest, governedBody: string): Promise<HubResponse>;
  /** Observational health of the Hub connection. Never a compliance verdict. */
  health(): Promise<{ readonly available: boolean; readonly killSwitchEngaged: boolean }>;
}

/** Deterministic scripted transport for tests / conformance. No network. */
export function createFakeHubTransport(
  script: (req: GovernedRequest, body: string) => HubResponse | Promise<HubResponse>,
): HubTransport & { readonly sent: GovernedRequest[] } {
  const sent: GovernedRequest[] = [];
  return {
    sent,
    async send(req: GovernedRequest, body: string): Promise<HubResponse> {
      sent.push(req);
      return script(req, body);
    },
    async health(): Promise<{ available: boolean; killSwitchEngaged: boolean }> {
      return { available: true, killSwitchEngaged: false };
    },
  };
}
