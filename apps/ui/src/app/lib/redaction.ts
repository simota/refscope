// Redact mode — a display-layer mask for screen sharing and screenshots.
//
// Redaction is applied at the API response boundary (`getJson` in api.ts)
// rather than in each component, so every lens, panel, dialog, copied
// report and Markdown export sees the same masked values — a new component
// cannot forget to redact. Git itself is never touched: toggling the mode
// off re-reads the original facts from the API.
//
// What is masked:
// - identity fields (`author`, `committer`, `actor`, `*Name` / `*Email`
//   variants, `{ name, email }` objects under those keys, `authors: string[]`,
//   and author-grouped summary keys) → a stable pseudonym or `[redacted]`;
// - free text (`subject`, `body`, `message`, `summary`, `sampleSubjects`)
//   → e-mail addresses become `[email]` and attribution trailers such as
//   `Signed-off-by:` / `Reviewed-by:` keep their key but lose their value.
//
// What is not masked: commit hashes (they address every API call), file
// paths, file contents, diffs and code-search hits. The UI says so next to
// the toggle.

/** Keys whose string value is a person's display name. */
const NAME_KEYS = new Set([
  "author",
  "authorName",
  "committer",
  "committerName",
  "actor",
  "actorName",
  "tagger",
  "taggerName",
]);

/** Keys whose value is free text that may carry e-mails or trailers. */
const TEXT_KEYS = new Set(["subject", "body", "message", "summary"]);

/** Keys holding an array of free-text strings. */
const TEXT_ARRAY_KEYS = new Set(["sampleSubjects"]);

/** Keys holding an array of display names. */
const NAME_ARRAY_KEYS = new Set(["authors", "committers", "authorAliases"]);

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TRAILER_PATTERN =
  /^([ \t]*)(Signed-off-by|Co-authored-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Suggested-by|Helped-by|Reviewed-on|Approved-by|Cc)([ \t]*:)[^\n]*$/gim;

export const REDACTED_EMAIL = "[redacted]";

/** FNV-1a 32-bit, hex. Deterministic so the same person keeps one pseudonym. */
function hashHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A stable, non-identifying label for a display name: up to two ASCII
 * initials plus a short hash so two people sharing initials stay distinct
 * (lenses group and colour by author). Non-Latin names get no initials —
 * a single kanji or hangul syllable can identify someone on its own.
 */
export function pseudonymizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (isPseudonym(trimmed)) return trimmed;
  const initials = trimmed
    .split(/[\s._-]+/)
    .map((part) => part.charAt(0))
    .filter((char) => /[A-Za-z]/.test(char))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return `${initials || "Author"}·${hashHex(trimmed.toLowerCase()).slice(0, 4)}`;
}

const PSEUDONYM_PATTERN = /^(?:[A-Z]{1,2}|Author)·[0-9a-f]{4}$/;

export function isPseudonym(value: string): boolean {
  return PSEUDONYM_PATTERN.test(value);
}

/** Mask e-mail addresses and attribution-trailer values inside free text. */
export function redactText(text: string): string {
  if (!text) return text;
  return text
    .replace(TRAILER_PATTERN, (_match, indent: string, key: string, colon: string) => `${indent}${key}${colon} [redacted]`)
    .replace(EMAIL_PATTERN, "[email]");
}

export type Redactor = {
  /** Deep-copies `value` with identities and free text masked. */
  redact<T>(value: T): T;
  /**
   * Maps a pseudonym produced by this redactor back to the real name it
   * replaced, so clicking a masked author (Digest lens, heatmap) still
   * filters the timeline. Unknown input is returned unchanged.
   */
  resolveName(value: string): string;
};

export function createRedactor(): Redactor {
  // In-memory only: the reverse map is never persisted or sent anywhere.
  const realNames = new Map<string, string>();

  const name = (value: string) => {
    const pseudonym = pseudonymizeName(value);
    if (pseudonym !== value) realNames.set(pseudonym, value);
    return pseudonym;
  };

  const visit = (value: unknown, key: string | null, parentIsIdentity: boolean): unknown => {
    if (typeof value === "string") {
      if (key === null) return value;
      if (/email$/i.test(key)) return value ? REDACTED_EMAIL : value;
      if (NAME_KEYS.has(key) || (parentIsIdentity && key === "name")) return name(value);
      if (TEXT_KEYS.has(key)) return redactText(value);
      return value;
    }
    if (Array.isArray(value)) {
      if (key !== null && NAME_ARRAY_KEYS.has(key)) {
        return value.map((item) => (typeof item === "string" ? name(item) : visit(item, null, false)));
      }
      if (key !== null && TEXT_ARRAY_KEYS.has(key)) {
        return value.map((item) => (typeof item === "string" ? redactText(item) : visit(item, null, false)));
      }
      return value.map((item) => visit(item, null, false));
    }
    if (value && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const identity = key !== null && NAME_KEYS.has(key);
      const out: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(source)) {
        out[childKey] = visit(childValue, childKey, identity);
      }
      // Author-grouped summaries carry the name in `key` (Digest lens).
      if (source.kind === "author" && typeof source.key === "string") {
        out.key = name(source.key);
      }
      return out;
    }
    return value;
  };

  return {
    redact<T>(value: T): T {
      return visit(value, null, false) as T;
    },
    resolveName(value: string): string {
      return realNames.get(value.trim()) ?? value;
    },
  };
}
