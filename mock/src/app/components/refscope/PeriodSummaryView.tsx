import { useEffect, useMemo, useState } from "react";
import { fetchCommitsSummary, type CommitsSummary, type CommitsSummaryGroup } from "../../api";

type PeriodPreset = "today" | "this-week" | "last-30-days" | "custom";
type GroupBy = "prefix" | "path" | "author";

type DrilldownContext = { kind: GroupBy; key: string };

const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "this-week", label: "This week" },
  { value: "last-30-days", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "prefix", label: "Prefix" },
  { value: "path", label: "Path" },
  { value: "author", label: "Author" },
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Mirror apps/api/src/validation.js parsePathQuery: top segment must not start
// with `-` or `/`, must not contain `.` / `..` components, and is bounded.
const SAFE_PATH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;

export function PeriodSummaryView({
  repoId,
  refName,
  onDrilldown,
  isQuiet,
}: {
  repoId: string;
  refName: string;
  onDrilldown: (commitHashes: string[], context: DrilldownContext) => void;
  isQuiet?: boolean;
}) {
  const [period, setPeriod] = useState<PeriodPreset>("this-week");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("prefix");
  const [data, setData] = useState<CommitsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const range = useMemo(() => computeRange(period, customSince, customUntil), [
    period,
    customSince,
    customUntil,
  ]);

  useEffect(() => {
    if (!repoId || !range) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchCommitsSummary(
      repoId,
      { since: range.since, until: range.until, groupBy, ref: refName || undefined },
      controller.signal,
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load summary");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, refName, groupBy, range?.since, range?.until]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = data?.observed;
  const showCustomError =
    period === "custom" && (!ISO_DATE_PATTERN.test(customSince) || !ISO_DATE_PATTERN.test(customUntil));

  return (
    <section
      aria-label="Period summary"
      className="mx-4 mt-3 flex flex-col gap-3"
      data-quiet={isQuiet ? "true" : undefined}
    >
      {/* Header card: period + groupBy controls. */}
      <div
        className="rounded-md px-3 py-2 flex flex-col gap-2"
        style={{ background: "var(--rs-bg-panel)", border: "1px solid var(--rs-border)" }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2
            id="period-summary-heading"
            style={{ fontSize: 13, fontWeight: 650, color: "var(--rs-text-primary)" }}
          >
            Period summary
          </h2>
          <span
            aria-live="polite"
            style={{ fontSize: 11, color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)" }}
          >
            {loading ? "Loading summary…" : range ? `${range.since} → ${range.until} (UTC)` : ""}
          </span>
        </div>
        <div role="radiogroup" aria-label="Period preset" className="flex flex-wrap gap-1">
          {PERIOD_OPTIONS.map((option) => {
            const active = option.value === period;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`Period: ${option.label}`}
                onClick={() => setPeriod(option.value)}
                className="rs-compact-button"
                style={
                  active
                    ? {
                        color: "var(--rs-text-primary)",
                        borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                        background: "var(--rs-bg-elevated)",
                      }
                    : undefined
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {period === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            <CustomDateInput
              label="Since"
              value={customSince}
              onChange={setCustomSince}
              placeholder="YYYY-MM-DD"
            />
            <CustomDateInput
              label="Until"
              value={customUntil}
              onChange={setCustomUntil}
              placeholder="YYYY-MM-DD"
            />
            {showCustomError ? (
              <span style={{ fontSize: 11, color: "var(--rs-warning)" }}>
                Enter ISO dates (YYYY-MM-DD).
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <ErrorCard message={error} /> : null}

      {/* "Observed" zone — values are computed directly from observed git
          data. No interpretation; matches Spark §4.2.3 transparency line. */}
      <ObservedZone totals={totals} truncated={data?.truncated ?? false} loading={loading} />

      {/* "Derived" zone — rule-based grouping. Distinct warning border so the
          observed/derived boundary is visible at a glance. */}
      <DerivedZone
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        groups={data?.groups ?? []}
        uncategorized={data?.uncategorized ?? null}
        loading={loading}
        empty={!loading && !error && (totals?.totalCommits ?? 0) === 0}
        onDrilldown={onDrilldown}
      />
    </section>
  );
}

function ObservedZone({
  totals,
  truncated,
  loading,
}: {
  totals: CommitsSummary["observed"] | undefined;
  truncated: boolean;
  loading: boolean;
}) {
  return (
    <div
      role="region"
      aria-labelledby="period-summary-observed"
      className="rounded-md px-3 py-2 flex flex-col gap-2"
      style={{ background: "var(--rs-bg-panel)", border: "1px solid var(--rs-border)" }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3
          id="period-summary-observed"
          className="flex items-center gap-1.5"
          style={{ fontSize: 12, fontWeight: 650, color: "var(--rs-text-primary)" }}
        >
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              padding: "1px 4px",
              border: "1px solid var(--rs-border)",
              borderRadius: 3,
              color: "var(--rs-text-muted)",
            }}
          >
            OBS
          </span>
          Observed (no interpretation)
        </h3>
        {truncated ? (
          <span
            role="status"
            aria-label="Result truncated"
            className="rounded"
            style={{
              padding: "2px 8px",
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              color: "var(--rs-warning)",
              background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 14%)",
              border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%)",
            }}
          >
            Showing first 200 commits — older history truncated
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4">
        <ObservedMetric label="Commits" value={totals ? String(totals.totalCommits) : "—"} loading={loading} />
        <ObservedMetric
          label="Added"
          value={totals ? `+${totals.totalAdded}` : "—"}
          tone="added"
          loading={loading}
        />
        <ObservedMetric
          label="Deleted"
          value={totals ? `-${totals.totalDeleted}` : "—"}
          tone="deleted"
          loading={loading}
        />
        <ObservedMetric
          label="Authors"
          value={totals ? String(totals.authorsCount) : "—"}
          loading={loading}
        />
      </div>
    </div>
  );
}

function ObservedMetric({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone?: "added" | "deleted";
  loading: boolean;
}) {
  const color =
    tone === "added"
      ? "var(--rs-git-added)"
      : tone === "deleted"
      ? "var(--rs-git-deleted)"
      : "var(--rs-text-primary)";
  return (
    <div className="flex flex-col" aria-label={`${label}: ${value}`}>
      <span style={{ color, fontFamily: "var(--rs-mono)", fontSize: 16, fontWeight: 700 }}>
        {loading ? "…" : value}
      </span>
      <span style={{ color: "var(--rs-text-muted)", fontSize: 10 }}>{label}</span>
    </div>
  );
}

function DerivedZone({
  groupBy,
  onGroupByChange,
  groups,
  uncategorized,
  loading,
  empty,
  onDrilldown,
}: {
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  groups: CommitsSummaryGroup[];
  uncategorized: CommitsSummary["uncategorized"];
  loading: boolean;
  empty: boolean;
  onDrilldown: (commitHashes: string[], context: DrilldownContext) => void;
}) {
  // Reuse the "warning" token (already used by rewrite alerts) so the derived
  // boundary is visually consistent with existing observed/derived UI patterns.
  const derivedBorder = "color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%)";
  const visibleGroups = groups.filter((group) => group.kind === groupBy);
  return (
    <div
      role="region"
      aria-labelledby="period-summary-derived"
      className="rounded-md px-3 py-2 flex flex-col gap-2"
      style={{
        background: "var(--rs-bg-panel)",
        border: `1px solid ${derivedBorder}`,
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3
          id="period-summary-derived"
          className="flex items-center gap-1.5"
          style={{ fontSize: 12, fontWeight: 650, color: "var(--rs-warning)" }}
        >
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              padding: "1px 4px",
              border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
              borderRadius: 3,
              color: "var(--rs-warning)",
            }}
          >
            DRV
          </span>
          Derived (rule-based grouping, no AI)
        </h3>
        <div role="tablist" aria-label="Group by" className="flex gap-1">
          {GROUP_BY_OPTIONS.map((option) => {
            const active = option.value === groupBy;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Group by ${option.label}`}
                onClick={() => onGroupByChange(option.value)}
                className="rs-compact-button"
                style={
                  active
                    ? {
                        color: "var(--rs-text-primary)",
                        borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
                        background: "var(--rs-bg-elevated)",
                      }
                    : undefined
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>Loading summary…</p>
      ) : empty ? (
        <p style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>No commits in this period.</p>
      ) : visibleGroups.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
          No groups produced by this rule for the selected period.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {visibleGroups.map((group) => (
            <GroupRow key={`${group.kind}:${group.key}`} group={group} onDrilldown={onDrilldown} />
          ))}
        </ul>
      )}

      {groupBy === "prefix" && uncategorized && uncategorized.commitCount > 0 ? (
        <UncategorizedCard
          uncategorized={uncategorized}
          onDrilldown={onDrilldown}
        />
      ) : null}
    </div>
  );
}

function GroupRow({
  group,
  onDrilldown,
}: {
  group: CommitsSummaryGroup;
  onDrilldown: (commitHashes: string[], context: DrilldownContext) => void;
}) {
  const headingId = `period-summary-group-${group.kind}-${slug(group.key)}`;
  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="rounded-md px-3 py-2 flex flex-col gap-1.5"
        style={{ background: "var(--rs-bg-elevated)", border: "1px solid var(--rs-border)" }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h4
            id={headingId}
            style={{
              fontSize: 12,
              fontWeight: 650,
              color: "var(--rs-text-primary)",
              fontFamily: "var(--rs-mono)",
            }}
          >
            {group.key}
          </h4>
          <span style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}>
            {group.commitCount} commits
          </span>
          <span
            style={{ fontSize: 11, color: "var(--rs-git-added)", fontFamily: "var(--rs-mono)" }}
          >
            +{group.added}
          </span>
          <span
            style={{ fontSize: 11, color: "var(--rs-git-deleted)", fontFamily: "var(--rs-mono)" }}
          >
            -{group.deleted}
          </span>
          <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>
            {group.authors.length} author{group.authors.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="rs-compact-button"
            onClick={() =>
              onDrilldown(group.commitHashes, { kind: group.kind, key: group.key })
            }
            aria-label={`Show ${group.commitCount} commits for ${group.kind} ${group.key}`}
            style={{ marginLeft: "auto" }}
          >
            Show {group.commitCount} commits →
          </button>
        </div>
        {group.sampleSubjects.length ? (
          <ul
            role="list"
            className="flex flex-col gap-0.5"
            style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
          >
            {group.sampleSubjects.slice(0, 10).map((subject, index) => (
              <li
                key={`${subject}-${index}`}
                className="truncate"
                style={{ fontFamily: "var(--rs-mono)" }}
                title={subject}
              >
                • {subject}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </li>
  );
}

function UncategorizedCard({
  uncategorized,
  onDrilldown,
}: {
  uncategorized: NonNullable<CommitsSummary["uncategorized"]>;
  onDrilldown: (commitHashes: string[], context: DrilldownContext) => void;
}) {
  return (
    <article
      aria-labelledby="period-summary-uncategorized"
      className="rounded-md px-3 py-2 flex items-center gap-3 flex-wrap"
      style={{ background: "var(--rs-bg-elevated)", border: "1px dashed var(--rs-border)" }}
    >
      <h4
        id="period-summary-uncategorized"
        style={{ fontSize: 12, fontWeight: 650, color: "var(--rs-text-primary)" }}
      >
        No conventional-commit prefix detected (kept separate, not guessed)
      </h4>
      <span style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}>
        {uncategorized.commitCount} commits
      </span>
      <button
        type="button"
        className="rs-compact-button"
        onClick={() =>
          onDrilldown(uncategorized.commitHashes, { kind: "prefix", key: "uncategorized" })
        }
        aria-label={`Show ${uncategorized.commitCount} uncategorized commits`}
        style={{ marginLeft: "auto" }}
      >
        Show {uncategorized.commitCount} commits →
      </button>
    </article>
  );
}

function CustomDateInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label
      className="flex items-center gap-2"
      style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
    >
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder={placeholder}
        inputMode="numeric"
        pattern="\d{4}-\d{2}-\d{2}"
        aria-label={`Custom ${label.toLowerCase()} date (YYYY-MM-DD)`}
        className="rs-compact-button"
        style={{
          fontFamily: "var(--rs-mono)",
          color: "var(--rs-text-primary)",
          background: "var(--rs-bg-canvas)",
          width: 120,
          padding: "0 8px",
        }}
      />
    </label>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md px-3 py-2"
      style={{
        background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 10%)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 55%)",
        color: "var(--rs-text-secondary)",
        fontSize: 12,
      }}
    >
      <div style={{ color: "var(--rs-warning)", fontWeight: 600 }}>Could not load summary</div>
      <div style={{ marginTop: 4, fontFamily: "var(--rs-mono)", fontSize: 11 }}>{message}</div>
    </div>
  );
}

function computeRange(
  period: PeriodPreset,
  customSince: string,
  customUntil: string,
): { since: string; until: string } | null {
  if (period === "custom") {
    if (!ISO_DATE_PATTERN.test(customSince) || !ISO_DATE_PATTERN.test(customUntil)) return null;
    return { since: customSince, until: customUntil };
  }
  const now = new Date();
  const untilIso = isoDateTimeUtc(now);
  if (period === "today") {
    return { since: isoDateOnly(now), until: untilIso };
  }
  if (period === "this-week") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    // Monday-start week boundary; getUTCDay() returns 0 for Sunday.
    const dayOfWeek = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - dayOfWeek);
    return { since: isoDateOnly(start), until: untilIso };
  }
  // last-30-days
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30),
  );
  return { since: isoDateOnly(start), until: untilIso };
}

function isoDateOnly(date: Date) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoDateTimeUtc(date: Date) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
}

function slug(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}

// Used by App.tsx to gate path drilldown values that the API would 400 on.
export function isSafeTopSegmentForPathFilter(value: string) {
  return value.length > 0 && value.length <= 200 && SAFE_PATH_PATTERN.test(value);
}
