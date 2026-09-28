// ARMA API Hub — docs app.
//
// The docs app renders the repository's `docs/` directory into a static site.
// The build script lives in scripts/build-docs.mjs.

export const DOCS_SECTIONS = [
  'architecture',
  'decisions',
  'onboarding',
  'planning',
  'runbooks',
  'security',
] as const;

export type DocsSection = (typeof DOCS_SECTIONS)[number];
