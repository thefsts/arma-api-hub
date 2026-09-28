// ARMA API Hub — console design tokens.
//
// Framework-agnostic design tokens shared by the management console. Kept
// dependency-free so the console can adopt any rendering framework.

export const colors = {
  background: '#0b0f14',
  surface: '#131a22',
  border: '#243040',
  text: '#e6edf3',
  textMuted: '#9aa7b4',
  accent: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
} as const;

export const typography = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  sizes: { sm: '12px', md: '14px', lg: '18px', xl: '24px' },
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
