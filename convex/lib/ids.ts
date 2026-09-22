// Opaque identifier generation for the ARMA API Hub control plane.
//
// Domain identifiers are opaque, prefixed strings. They are never derived from
// secrets and never encode tenant or customer data.

/** Generate an opaque, prefixed identifier using a cryptographically strong source. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${prefix}_${hex}`;
}

/** Generate an opaque nonce suitable for replay protection. */
export function newNonce(): string {
  return newId('nonce');
}
