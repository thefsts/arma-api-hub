// ARMA API Hub — management console shell.
//
// Phase 0 renders a static shell that documents the console's intended
// surfaces. The console NEVER holds privileged API Hub credentials in the
// browser; it calls a server-side console backend that holds scoped identity.

import { colors, spacing, typography } from '@arma/ui';

export interface ConsoleSection {
  readonly title: string;
  readonly description: string;
}

export const CONSOLE_SECTIONS: readonly ConsoleSection[] = [
  { title: 'Service Registry', description: 'Registered services, lifecycle, and ownership.' },
  { title: 'Connections', description: 'Inbound/outbound connections and allow lists.' },
  { title: 'Contracts', description: 'Published contract versions and deprecation.' },
  { title: 'Webhooks', description: 'Delivery attempts, retries, and dead letters.' },
  { title: 'Connector Health', description: 'Per-connector readiness and incidents.' },
  { title: 'Kill Switches', description: 'Engage/disengage delivery per connector.' },
  { title: 'Audit', description: 'Integration audit trail (metadata only).' },
];

/** Render the console shell as a self-contained HTML document. */
export function renderConsoleShell(): string {
  const cards = CONSOLE_SECTIONS.map(
    (s) => `      <section class="card"><h2>${s.title}</h2><p>${s.description}</p></section>`,
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ARMA API Hub — Console</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: ${colors.background}; color: ${colors.text};
    font-family: ${typography.fontFamily}; }
  header { padding: ${spacing.lg}; border-bottom: 1px solid ${colors.border}; }
  h1 { margin: 0; font-size: ${typography.sizes.xl}; }
  .sub { color: ${colors.textMuted}; margin-top: ${spacing.xs}; }
  main { display: grid; gap: ${spacing.md}; padding: ${spacing.lg};
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .card { background: ${colors.surface}; border: 1px solid ${colors.border};
    border-radius: 8px; padding: ${spacing.md}; }
  .card h2 { margin: 0 0 ${spacing.xs}; font-size: ${typography.sizes.lg}; }
  .card p { margin: 0; color: ${colors.textMuted}; font-size: ${typography.sizes.md}; }
  footer { padding: ${spacing.lg}; color: ${colors.textMuted}; font-size: ${typography.sizes.sm}; }
</style>
</head>
<body>
  <header>
    <h1>ARMA API Hub</h1>
    <div class="sub">Integration control plane — management console (Phase 0 shell)</div>
  </header>
  <main>
${cards}
  </main>
  <footer>No privileged credentials are held in the browser. Console actions are proxied through a scoped server-side identity.</footer>
</body>
</html>
`;
}
