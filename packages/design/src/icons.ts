/**
 * Central icon name map (Ionicons).
 *
 * Screens reference semantic keys (e.g. "recordLesson") instead of raw icon
 * names, so the icon set can be tuned in one place and stays consistent. The
 * mobile Icon component resolves these to Ionicons glyphs. For tabs, the
 * component appends "" (filled) for the active tab and "-outline" for inactive.
 */
export const ICONS = {
  // Home + capture
  home: "home",
  takePhoto: "camera",
  uploadSource: "cloud-upload",
  recordLesson: "mic",

  // Primary sections
  courses: "book",
  notes: "document-text",
  settings: "settings",

  // Study tools
  summary: "reader",
  concepts: "bulb",
  explanations: "sparkles",
  flashcards: "albums",
  quiz: "help-circle",
  podcast: "headset",
  chat: "chatbubbles",

  // Notes
  newNote: "create",
  voiceNote: "mic-circle",

  // Generic / controls
  add: "add",
  next: "chevron-forward",
  previous: "chevron-back",
  play: "play",
  pause: "pause",
  correct: "checkmark-circle",
  incorrect: "close-circle",
  external: "globe",
  sources: "library",
  chevron: "chevron-forward",
} as const;

export type IconKey = keyof typeof ICONS;
