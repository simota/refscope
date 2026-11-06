import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, Copy, Download, Link2, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { describeFilters, shortRefName, type SavedView } from "../../lib/timelineViews";

/**
 * Views — saved timeline filter sets for this repository, plus sharing and
 * exporting what the timeline currently lists.
 *
 * A view stores the ref, search (mode + text), author, path, date window and
 * history shape. Applying one restores all of them at once; saving under an
 * existing name updates it. Views live in this browser only.
 */
export function SavedViewsMenu({
  views,
  activeViewId,
  onApply,
  onSave,
  onDelete,
  onCopyLink,
  onCopyMarkdown,
  onDownload,
  commitCount,
  hasMore,
  disabled = false,
}: {
  views: SavedView[];
  /** The saved view whose filters match the current ones, if any. */
  activeViewId: string | null;
  onApply: (view: SavedView) => void;
  /** Returns the feedback line to announce. */
  onSave: (name: string) => string;
  onDelete: (view: SavedView) => void;
  onCopyLink: () => Promise<string>;
  onCopyMarkdown: () => Promise<string>;
  onDownload: (format: "markdown" | "csv") => string;
  /** Commits the timeline lists right now (what an export contains). */
  commitCount: number;
  hasMore: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const statusTimerRef = useRef<number | null>(null);
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const trimmed = name.trim();
  const overwrites = trimmed
    ? views.some((view) => view.name.toLowerCase() === trimmed.replace(/\s+/g, " ").toLowerCase())
    : false;

  useEffect(
    () => () => {
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    },
    [],
  );

  function flash(message: string) {
    setStatus(message);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      setStatus("");
    }, 2500);
  }

  function save() {
    if (!trimmed) return;
    flash(onSave(trimmed));
    setName("");
  }

  const sectionTitle = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.6px",
    textTransform: "uppercase" as const,
    color: "var(--rs-text-secondary)",
    margin: "0 0 6px",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rs-compact-button shrink-0"
          disabled={disabled}
          aria-label={activeView ? `Views (current: ${activeView.name})` : "Views"}
          title="Saved views, share link and export"
          style={
            activeView
              ? {
                  color: "var(--rs-text-primary)",
                  borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                  background: "var(--rs-bg-elevated)",
                }
              : undefined
          }
        >
          <Bookmark size={11} aria-hidden style={{ marginRight: 4 }} />
          <span
            style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {activeView ? activeView.name : "Views"}
          </span>
          <ChevronDown size={11} aria-hidden style={{ marginLeft: 4 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80"
        style={{
          background: "var(--rs-bg-elevated)",
          color: "var(--rs-text-primary)",
          border: "1px solid var(--rs-border)",
          fontFamily: "var(--rs-sans)",
          maxHeight: "min(70vh, 560px)",
          overflowY: "auto",
        }}
      >
        <h2 style={sectionTitle}>Saved views</h2>
        {views.length === 0 ? (
          <p style={{ fontSize: 11, color: "var(--rs-text-muted)", margin: "0 0 10px" }}>
            Save the current ref, search, author, path, dates and history shape under a name to
            come back to it in one click.
          </p>
        ) : (
          <ul aria-label="Saved views" style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
            {views.map((view) => {
              const chips = describeFilters(view.filters);
              const summary = [shortRefName(view.filters.ref), ...chips].join(" · ");
              const isActive = view.id === activeViewId;
              return (
                <li key={view.id} style={{ display: "flex", alignItems: "stretch", gap: 4, marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(view);
                      setOpen(false);
                    }}
                    aria-current={isActive ? "true" : undefined}
                    title={summary}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      padding: "5px 8px",
                      borderRadius: "var(--rs-radius-sm)",
                      border: "1px solid transparent",
                      background: isActive
                        ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 14%)"
                        : "transparent",
                      color: "var(--rs-text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                      {isActive ? <Check size={11} aria-hidden style={{ color: "var(--rs-accent)" }} /> : null}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {view.name}
                      </span>
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        fontFamily: "var(--rs-mono)",
                        color: "var(--rs-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {summary}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(view);
                      flash(`Deleted “${view.name}”`);
                    }}
                    aria-label={`Delete view ${view.name}`}
                    title="Delete view"
                    className="rs-compact-button"
                    style={{ alignSelf: "center", padding: "0 6px" }}
                  >
                    <Trash2 size={11} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          style={{ display: "flex", gap: 6, marginBottom: 12 }}
        >
          <label htmlFor="saved-view-name" className="sr-only">
            View name
          </label>
          <input
            id="saved-view-name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder={activeView ? `Name (current: ${activeView.name})` : "Name this view…"}
            className="min-w-0 flex-1 outline-none"
            style={{
              height: 28,
              padding: "0 8px",
              fontSize: 12,
              color: "var(--rs-text-primary)",
              background: "var(--rs-bg-canvas)",
              border: "1px solid var(--rs-border)",
              borderRadius: "var(--rs-radius-sm)",
            }}
          />
          <button type="submit" className="rs-compact-button" disabled={!trimmed}>
            {overwrites ? "Update" : "Save"}
          </button>
        </form>

        <h2 style={sectionTitle}>Share &amp; export</h2>
        <p style={{ fontSize: 10, color: "var(--rs-text-muted)", margin: "0 0 6px" }}>
          {commitCount} commit{commitCount === 1 ? "" : "s"} listed
          {hasMore ? " — older commits are not loaded yet; “Load older” adds them to the export." : "."}
        </p>
        <div style={{ display: "grid", gap: 4 }}>
          <button
            type="button"
            className="rs-compact-button"
            style={{ justifyContent: "flex-start" }}
            onClick={async () => flash(await onCopyLink())}
          >
            <Link2 size={11} aria-hidden style={{ marginRight: 6 }} />
            Copy link to this view
          </button>
          <button
            type="button"
            className="rs-compact-button"
            style={{ justifyContent: "flex-start" }}
            onClick={async () => flash(await onCopyMarkdown())}
          >
            <Copy size={11} aria-hidden style={{ marginRight: 6 }} />
            Copy commit list as Markdown
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="rs-compact-button"
              style={{ flex: 1, justifyContent: "flex-start" }}
              onClick={() => flash(onDownload("markdown"))}
            >
              <Download size={11} aria-hidden style={{ marginRight: 6 }} />
              Download .md
            </button>
            <button
              type="button"
              className="rs-compact-button"
              style={{ flex: 1, justifyContent: "flex-start" }}
              onClick={() => flash(onDownload("csv"))}
            >
              <Download size={11} aria-hidden style={{ marginRight: 6 }} />
              Download .csv
            </button>
          </div>
        </div>
        <div
          role="status"
          aria-live="polite"
          style={{ minHeight: 16, marginTop: 8, fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          {status}
        </div>
      </PopoverContent>
    </Popover>
  );
}
