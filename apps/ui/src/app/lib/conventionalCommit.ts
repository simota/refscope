/**
 * Parse a Conventional Commits subject line into its constituent parts.
 *
 * Mirrors the regex used by `apps/api/src/gitService.js` for prefix-grouping
 * (`/^([a-z][a-z0-9-]*)(?:\([^)]*\))?:\s/`), but additionally captures the
 * scope and remainder so the UI can render a colored type badge, a faint
 * scope subscript, and a clean subject — instead of forcing the eye to
 * parse `feat(api):` out of the subject every row.
 *
 * Returns `null` for non-conventional subjects so callers can short-circuit
 * to the original subject without any badge styling.
 */
export type ConventionalCommit = {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
};

const CONVENTIONAL_COMMIT_PATTERN =
  /^([a-z][a-z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.*)$/;

export function parseConventionalCommit(subject: string): ConventionalCommit | null {
  if (!subject) return null;
  const match = CONVENTIONAL_COMMIT_PATTERN.exec(subject);
  if (!match) return null;
  const [, type, scope, breaking, description] = match;
  return {
    type,
    scope: scope ?? null,
    breaking: Boolean(breaking),
    description,
  };
}
