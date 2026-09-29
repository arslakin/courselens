/**
 * RojAnda localization.
 *
 * Turkish-first: `tr` is the default and only complete locale today. The API
 * is localization-ready — add another locale by providing a resource object of
 * the same shape and registering it in `locales`. UI code must always read
 * strings through `getStrings(locale)`, never hardcode user-facing text.
 */
import { tr, type Strings } from "./tr";

export type { Strings } from "./tr";
export type Locale = "tr" | "en";

const locales: Partial<Record<Locale, Strings>> = {
  tr,
  // en: en,  // future — add an English resource of the same shape here.
};

export const DEFAULT_LOCALE: Locale = "tr";

/** Returns the string table for a locale, falling back to Turkish. */
export function getStrings(locale: Locale = DEFAULT_LOCALE): Strings {
  return locales[locale] ?? tr;
}

export { tr };
