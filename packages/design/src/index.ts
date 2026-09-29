/**
 * RojAnda design tokens.
 *
 * THEME: modern LIGHT theme — a bright, calm surface suitable for students.
 * A soft warm off-white background separates from white cards; text is a dark
 * charcoal/navy; the RojAnda blue accent carries actions and selection state.
 * All screens consume these tokens (no hardcoded colors), so the theme is
 * defined here once and applies app-wide.
 *
 * BRAND-COLOR PROVENANCE (important):
 * The official "Roj Collective" brand palette could NOT be verified from any
 * asset in this repository (there is no brand/style-guide file). The accent
 * values here are therefore treated as TEMPORARY and are marked as such below.
 * Replace `colors.accent` / `colors.accent2` once the official Roj Collective
 * colors are provided. Do not guess brand colors elsewhere — always reference
 * these tokens.
 *
 * CONTRAST (WCAG AA, normal text needs >= 4.5:1):
 *  - text #1f2733 on bg #f6f7f9  ~= 13.5:1
 *  - text #1f2733 on surface #ffffff ~= 14.9:1
 *  - muted #5b6472 on surface #ffffff ~= 5.6:1
 *  - onAccent #ffffff on accent #2f6bf0 ~= 4.8:1
 * Full validation still requires manual testing with assistive technologies.
 */

export const colors = {
  // Soft, warm off-white background (not harsh pure white) with white cards.
  bg: "#f6f7f9",
  surface: "#ffffff",
  surface2: "#eef1f5", // subtle light surface for inputs / secondary buttons / chips
  border: "#dfe3ea", // subtle light-gray dividers/borders
  text: "#1f2733", // dark charcoal/navy primary text
  muted: "#5b6472", // medium gray secondary text (AA on white)
  good: "#1a9d6b", // darkened for contrast on light surfaces
  danger: "#d64545", // darkened for contrast on light surfaces

  // TEMPORARY brand accent — RojAnda blue, darkened slightly from the previous
  // #5b8cff so white text on it clears WCAG AA. NOT confirmed Roj Collective
  // brand color; replace when the official brand palette is provided.
  accent: "#2f6bf0", // TEMP (RojAnda blue)
  accent2: "#6d4be0", // TEMP

  // Text/glyph color placed on top of the accent (primary buttons, avatar).
  onAccent: "#ffffff",
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

export * from "./icons";
