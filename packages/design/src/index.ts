/**
 * RojAnda design tokens.
 *
 * THEME: modern LIGHT theme built on the OFFICIAL Roj Collective brand palette,
 * tuned for students. A soft, warm brand-tinted off-white background with white
 * content cards keeps reading comfortable; dark charcoal text keeps strong
 * contrast; the Roj woven-kilim colors (red / olive / tan) carry actions,
 * selection, progress, and subtle background accents. All screens consume these
 * tokens — no hardcoded colors — so the brand is defined here once.
 *
 * BRAND-COLOR PROVENANCE (now authoritative):
 * The palette below is extracted DIRECTLY from the official Roj woven-kilim mark
 * shipped in this repo (`apps/mobile/assets/roj-mark.png`). The three brand
 * colors were sampled from the mark's own pixels:
 *   Roj Red   #cc1d2a
 *   Roj Olive #b2ae4b
 *   Roj Tan   #d7b17c
 * This REPLACES the earlier temporary blue placeholder. Do not guess brand
 * colors elsewhere — always reference these tokens.
 *
 * CONTRAST (WCAG AA, normal text needs >= 4.5:1; measured):
 *  - text #1f2733 on bg #faf7f2       ~= 14.1:1
 *  - text #1f2733 on surface #ffffff  ~= 15.0:1
 *  - text #1f2733 on brand tints      ~= 13.4–13.7:1
 *  - muted #5b6472 on white           ~= 6.0:1
 *  - onAccent #ffffff on primary #cc1d2a ~= 5.56:1
 *  - good #1a7f4b / danger #c0392b white text on solid ~= 5.0:1+
 * Olive #b2ae4b is used ONLY as a background/accent/progress fill (too light for
 * text on white, 2.3:1); olive TEXT uses the darkened #5c5a1e (7.2:1).
 * Full validation still requires manual testing with assistive technologies.
 */

// --- Official Roj Collective brand hues (sampled from the mark) ------------
export const brand = {
  red: "#cc1d2a", // Roj Red — primary action / active brand
  redDark: "#b3121f", // deeper red for pressed / stronger contrast (white text 6.95:1)
  olive: "#b2ae4b", // Roj Olive — secondary accent / progress
  oliveText: "#5c5a1e", // darkened olive usable as text/icon on white
  tan: "#d7b17c", // Roj Tan/wheat — warm accent
} as const;

export const colors = {
  // Warm, brand-tinted off-white background (not harsh white) + white cards.
  bg: "#faf7f2",
  surface: "#ffffff",
  surface2: "#f2ede4", // subtle warm surface for inputs / secondary buttons / chips
  border: "#e6ddd0", // soft warm border/divider
  text: "#1f2733", // dark charcoal — strong contrast everywhere
  muted: "#5b6472", // medium gray secondary text (AA on white)
  good: "#1a7f4b", // green tuned for white-text contrast on solid
  danger: "#c0392b", // red-leaning danger, distinct from brand red, AA on white

  // Primary action / active brand = Roj Red. onAccent is white (5.56:1).
  accent: brand.red,
  accentPressed: brand.redDark,
  accent2: brand.olive, // secondary brand accent (olive)
  onAccent: "#ffffff",

  // Subtle brand-colored BACKGROUND tints (content stays dark-on-light, AA):
  brandTintRed: "#fdeef0", // faint red wash for hero/section backgrounds
  brandTintOlive: "#f4f4e6", // faint olive wash
  brandTintTan: "#fbf3e8", // faint tan wash
  // Selected course/lesson state: warm tan-tinted surface + red edge (below).
  selectedBg: "#fbf3e8",
  selectedBorder: brand.red,
  // Progress indicator track + fill.
  progressTrack: "#efe7da",
  progressFill: brand.olive,
} as const;

/** Brand gradient stops (header/hero/splash washes). Kept subtle. */
export const brandGradient = {
  // Warm woven wash: tan -> olive -> red, low saturation for backgrounds.
  hero: ["#fbf3e8", "#f4f4e6", "#fdeef0"] as const,
  // Stronger brand band (splash / onboarding) using the real hues.
  splash: ["#d7b17c", "#b2ae4b", "#cc1d2a"] as const,
} as const;

/** No temporary brand colors remain — the palette is now the official Roj mark. */
export const TEMPORARY_BRAND_COLORS = [] as const;

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
  brand,
  brandGradient,
  spacing,
  radius,
  fontSize,
  fontWeight,
  touchTarget: TOUCH_TARGET,
} as const;

export type Theme = typeof theme;

export * from "./icons";
