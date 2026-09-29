/**
 * Reads real text from a picked source file when we can (plain text / markdown),
 * on-device, with no cloud call. Binary formats (images, PDF, office docs) can't
 * be decoded on-device here, so we return `undefined` and let the AnalysisBackend
 * decide how to extract (real OCR happens server-side; the LocalAnalysisBackend
 * returns a clearly-labeled placeholder rather than fabricating content).
 */
import { File } from "expo-file-system";

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".rtf"];
const TEXT_MIME_PREFIXES = ["text/"];

function looksLikeText(uri: string | undefined, mime: string | undefined): boolean {
  if (mime && TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  if (mime === "application/json") return true;
  const lower = (uri ?? "").toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Returns the file's text if it is a plain-text format we can decode locally,
 * otherwise `undefined`. Never throws for an unreadable file — callers treat a
 * missing result as "needs backend extraction".
 */
export async function readSourceText(
  uri: string | undefined,
  mime?: string
): Promise<string | undefined> {
  if (!uri || !looksLikeText(uri, mime)) return undefined;
  try {
    const text = await new File(uri).text();
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
