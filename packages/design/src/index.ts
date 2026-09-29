/**
 * RojAnda design tokens.
 *
 * BRAND-COLOR PROVENANCE (important):
 * The palette below is adapted DIRECTLY from the shipped RojLearn web app
 * (frontend/styles.css of RojLearn v1) so the mobile app keeps RojLearn's
 * clean, calm visual language.
 *
 * The official "Roj Collective" brand palette could NOT be verified from any
 * asset in this repository (there is no brand/style-guide file). The accent
 * values here are therefore treated as TEMPORARY and are marked as such below.
 * Replace `colors.accent` / `colors.accent2` (and any brand-specific values)
 * once the official Roj Collective colors are provided. Do not guess brand
 * colors elsewhere — always reference these tokens.
 */

export const colors = {
  // Verified from RojLearn v1 (frontend/styles.css) — reused as-is.
  bg: "#0f1115",
  surface: "#181b22",
  surface2: "#20242e",
  border: "#2c313c",
  text: "#e7e9ee",
  muted: "#9aa3b2",
  good: "#46c993",
  danger: "#ff6b6b",

  // TEMPORARY brand accents — from RojLearn UI, NOT confirmed Roj Collective
  // brand colors. Replace when official brand palette is provided.
  accent: "#5b8cff", // TEMP
  accent2: "#7c5cff", // TEMP

  // Convenience on-accent text color (from RojLearn .primary button).
  onAccent: "#0b0e14",
} as const;

/** True when a color is a placeholder pending official brand confirmation. */
export const TEMPORARY_BRAND_COLORS = ["accent", "accent2"] as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 32,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "600",
  bold: "700",
} as const;

/** Minimum accessible touch target (points). */
export const TOUCH_TARGET = 44;

export const theme = {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  touchTarget: TOUCH_TARGET,
} as const;

export type Theme = typeof theme;
