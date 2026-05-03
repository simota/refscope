/**
 * AddRepoDialog — Dialog to add a Git repository to the fleet.
 *
 * Uses Radix Dialog (components/ui/dialog.tsx).
 * inline validation: id (non-empty, ^[A-Za-z0-9_-]+$) + path (non-empty, absolute).
 * Server-response errors are shown inline (text-destructive tone).
 *
 * Quiet / animation: Radix Dialog inherits data-quiet attribute; no extra impl needed.
 * No new --rs-* CSS variables. No new npm packages.
 * charter v2 §3: "Add repository" is explicitly permitted.
 */

import { useState, useId } from "react";
import { FolderPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddRepoInput = { id: string; path: string };
export type AddRepoResult = { ok: true } | { ok: false; error: string };

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Step 7: replaced with real API call. Step 6: parent passes mock `async () => ({ ok: true })`. */
  onSubmit: (input: AddRepoInput) => Promise<AddRepoResult>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const REPO_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateId(value: string): string | null {
  if (value.length === 0) return "Required";
  if (!REPO_ID_PATTERN.test(value)) return "Use letters, digits, hyphen, underscore";
  return null;
}

function validatePath(value: string): string | null {
  if (value.length === 0) return "Required";
  if (!value.startsWith("/")) return "Must be absolute path";
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddRepoDialog({ open, onOpenChange, onSubmit }: AddRepoDialogProps) {
  const titleId = useId();

  const [id, setId] = useState("");
  const [path, setPath] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [pathTouched, setPathTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const idError = validateId(id);
  const pathError = validatePath(path);
  const canSubmit = !idError && !pathError && !submitting;

  function resetForm() {
    setId("");
    setPath("");
    setIdTouched(false);
    setPathTouched(false);
    setSubmitting(false);
    setServerError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Touch both fields to surface validation errors on submit attempt.
    setIdTouched(true);
    setPathTouched(true);
    if (!canSubmit) return;

    setSubmitting(true);
    setServerError(null);

    try {
      const result = await onSubmit({ id: id.trim(), path: path.trim() });
      if (result.ok) {
        handleOpenChange(false);
      } else {
        setServerError(result.error);
        setSubmitting(false);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Unexpected error");
      setSubmitting(false);
    }
  }

  const showIdError = idTouched && idError;
  const showPathError = pathTouched && pathError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        aria-modal="true"
        className="bg-[var(--rs-bg-elevated)] border-[var(--rs-border)] text-[var(--rs-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,0.55)] [&>button]:text-[var(--rs-text-secondary)] [&>button]:hover:bg-[var(--rs-bg-canvas)] [&>button]:hover:text-[var(--rs-text-primary)] [&>button]:opacity-100 [&>button]:bg-transparent [&>button:focus-visible]:outline-[var(--rs-accent)]"
      >
        <DialogHeader>
          <DialogTitle
            id={titleId}
            className="text-[var(--rs-text-primary)]"
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <FolderPlus size={16} aria-hidden />
              Add repository
            </span>
          </DialogTitle>
          <DialogDescription className="text-[var(--rs-text-secondary)]">
            Add a Git repository to your fleet. Just you, your machine, your Git repos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
            {/* Repository ID field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                htmlFor={`${titleId}-id`}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--rs-text-primary)",
                }}
              >
                Repository ID
              </label>
              <input
                id={`${titleId}-id`}
                type="text"
                value={id}
                placeholder="my-service"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showIdError ? "true" : undefined}
                aria-describedby={showIdError ? `${titleId}-id-err` : undefined}
                onChange={(e) => {
                  setId(e.target.value);
                  setServerError(null);
                }}
                onBlur={() => setIdTouched(true)}
                style={{
                  height: 34,
                  padding: "0 10px",
                  fontSize: 13,
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-canvas)",
                  border: `1px solid ${showIdError ? "var(--rs-warning)" : "var(--rs-border)"}`,
                  borderRadius: "var(--rs-radius-sm)",
                  color: "var(--rs-text-primary)",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              {showIdError && (
                <span
                  id={`${titleId}-id-err`}
                  role="alert"
                  style={{ fontSize: 12, color: "var(--rs-warning)" }}
                >
                  {idError}
                </span>
              )}
            </div>

            {/* Path field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                htmlFor={`${titleId}-path`}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--rs-text-primary)",
                }}
              >
                Path (absolute)
              </label>
              <input
                id={`${titleId}-path`}
                type="text"
                value={path}
                placeholder="/Users/you/code/my-service"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showPathError ? "true" : undefined}
                aria-describedby={showPathError ? `${titleId}-path-err` : undefined}
                onChange={(e) => {
                  setPath(e.target.value);
                  setServerError(null);
                }}
                onBlur={() => setPathTouched(true)}
                style={{
                  height: 34,
                  padding: "0 10px",
                  fontSize: 13,
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-canvas)",
                  border: `1px solid ${showPathError ? "var(--rs-warning)" : "var(--rs-border)"}`,
                  borderRadius: "var(--rs-radius-sm)",
                  color: "var(--rs-text-primary)",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              {showPathError && (
                <span
                  id={`${titleId}-path-err`}
                  role="alert"
                  style={{ fontSize: 12, color: "var(--rs-warning)" }}
                >
                  {pathError}
                </span>
              )}
              {!showPathError && path.length > 0 && !path.startsWith("/") && (
                <span style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
                  Must be absolute path
                </span>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: "var(--rs-warning)",
                  padding: "6px 10px",
                  background: "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 10%)",
                  border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 40%)",
                  borderRadius: "var(--rs-radius-sm)",
                }}
              >
                {serverError}
              </div>
            )}
          </div>

          <DialogFooter style={{ marginTop: 20 }}>
            <button
              type="button"
              className="rs-compact-button"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rs-btn rs-btn--accent"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
              style={{ opacity: canSubmit ? 1 : 0.45 }}
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
