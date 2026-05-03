# Fleet Charter v1

> **Status:** COMMITTED
> **Mutability:** IMMUTABLE — supersede only via `docs/fleet-charter-v2.md`. Never edit this file in place except for the non-substantive correction exception defined in §6.1.
> **Date:** 2026-05-03
> **Authority:** Magi D2 verdict (3-0 unanimous, Confidence 78/100, 2026-05-03), DA challenge passed with non-substantive exception + diff summary table + 6-month health review additions.
> **Source:** Extracted from `docs/spark-reo-fleet-observation-proposal.md` §7 (v1.2, Quill polish). Inline §7 in proposal は historical record として保存される (modify 禁止)。

> **⚠️ STATUS: SUPERSEDED by `docs/fleet-charter-v2.md` (2026-05-03)**
> This v1 charter is preserved as historical record. New PRs must comply with v2.
> Reason: User authority override of Magi D4 verdict — see `docs/adr/ADR-Fleet-002.md`.

---

## §1 Inviolable principles

The Fleet observation surface exists to satisfy a single user voice (Reo, on-call SRE, 12-20 repos). It is governed by 5 inviolable principles. A PR that crosses any of these principles cannot be merged as-is; **the path forward is to supersede this charter via `fleet-charter-v2.md`** (see §6 amendment) — no negotiation or case-by-case waiver is possible under this version.

> **Quill v1.2 polish note:** "rejected without negotiation; the path forward is supersede via fleet-charter-v2.md" (v1.1 draft) → rephrased above to lead with the constructive path ("the path forward is…") while preserving the absolute strictness ("cannot be merged as-is", "no negotiation or case-by-case waiver"). Semantic is unchanged: the rejection fact + supersede pathway + no-negotiate strictness are all present. The 5 principles themselves (numbers, order, scope) are untouched.

1. **Observed-only.** The Fleet surface displays only facts directly readable from the local Git working tree(s). Derived analysis (CI status, deployment status, release readiness, dependency graphs, AI summaries, ranking, severity, scoring, prediction) is forbidden — at the schema layer, the code layer, and the UI vocabulary layer.

2. **Localhost only.** The Fleet feature, like the rest of Refscope, runs on the user's single machine. No outbound network calls. No SaaS-shaped UI elements. Default `HOST=127.0.0.1`. Public bind requires explicit `RTGV_BIND_PUBLIC=1` opt-in with a printed warning.

3. **Single user.** Fleet is not a team feature. There is no concept of "you", "owner", "team", "organization", "workspace", "member", "presence", "shared link", or "@mention". The user is the only consumer of their own Fleet surface.

4. **Calm by default.** Fleet inherits Refscope's Quiet mode and CVD-safe theme. Animations are 0ms in Quiet. Aria-live announcements are coalesced to ≤ 1/min (default) or ≤ 0.3/min (Quiet). The dot lights up once per observed event and stays static.

5. **Cost transparency.** The estimated cost (subscribed repo count, git calls per minute, snapshot interval, in-flight EventSource count) is displayed literally in the Footer. No adjectives ("light", "heavy", "fast"). The user must be able to predict the load on their own machine.

## §2 Forbidden tokens (Layer 2 grep gate)

The following tokens are forbidden in `apps/api/src/fleet*.js`, `apps/ui/src/app/components/refscope/Fleet*.tsx`, `apps/api/schemas/fleet-*.schema.json`, and `apps/ui/src/app/api.ts` (the `fleet` block within). The grep gate (`scripts/ci/forbid-derived-words.sh`, run by `make verify`) MUST fail the CI build on any occurrence.

```
ci_status, deployment_status, release_ready, dependency_graph,
ai_summary, llm_, openai, anthropic,
score_, ranking_, severity_,
share_link, public_url,
signin, signup, login_, avatar, jwt, oauth, session_token
```

There is no escape hatch. If a developer believes a forbidden token is justified, the only path is to supersede this charter (v2), which requires multiple reviewers and a documented rationale.

## §3 Forbidden UI vocabulary

The following terms are forbidden in user-facing strings (i18n catalogs, ARIA labels, button labels, tooltip text) within the Fleet surface code:

```
trend, hot, stale, risky, healthy (as a label, not a status enum),
attention, ready, recommended,
score, rank, priority, severity,
summary, analysis, insight, prediction
```

Forbidden UI elements (do not introduce these into the Fleet surface):

```
login, sign in, sign up, avatar, profile pic, "you" label,
Share, Copy link, Send to..., @mention,
Assign to, Owner, Watcher, Comment, Approve, Merge, Activity feed,
Team, Organization, Workspace, Members, Invite, Role,
presence, live cursors, typing indicator,
pricing, billing, Free trial, Demo CTA,
email alert, SMS, browser push, webhook outbound,
sync to cloud, backup
```

## §4 Enforcement (3 layers)

1. **Schema (Layer 1):** `apps/api/schemas/fleet-response.schema.json` and `fleet-event.schema.json` are validated by `apps/api/test/fleet-schema.test.js` with `additionalProperties: false`. Any new field requires a charter supersede.

2. **Code (Layer 2):** `scripts/ci/forbid-derived-words.sh`, run by `make verify`, greps the fleet code surface for the forbidden tokens of §2. Any match fails the CI build.

3. **Documentation (Layer 3):** This charter is immutable. Any change requires a new file (`docs/fleet-charter-v2.md`) that explicitly supersedes this one, signed by multiple CODEOWNERS reviewers.

## §5 Schema versioning

The Fleet response schema carries a `version` integer field (start: `1`). Breaking changes (field removal, type narrowing, enum reduction) require a new endpoint path (`/api/fleet/v2/...`) and a 6-month deprecation window of the v1 endpoint. Backward-compatible additions (new optional fields) are allowed in v1 without bump.

## §6 Amendment

This charter is immutable. To amend, create a new file (`docs/fleet-charter-vN.md`) that explicitly supersedes the current latest. The supersede PR MUST:

1. Cite the original Reo demand (Plea synthetic round 5) and explain how the amendment preserves the 5 inviolable principles.
2. Be approved by ≥ 2 CODEOWNERS reviewers.
3. Be referenced from a new ADR file (`docs/adr/ADR-Fleet-NNN.md`).
4. Update `scripts/ci/forbid-derived-words.sh` if §2 token list changes.
5. **Include a previous-charter diff summary table** (Magi D2 採択前提条件 #2). The supersede PR MUST contain a markdown table that summarizes the semantic differences from the previous charter (added principles, removed principles, modified wording with semantic shift, token list changes). This is mandatory to track supersede chain ≥ 5 (governance bureaucracy mitigation).

### §6.1 Non-substantive correction exception (Magi D2 採択前提条件 #1)

The following 4 categories of in-place edits are **permitted** without supersede, provided the PR title carries the `[non-substantive]` prefix. Each category is defined with both an **OK** example and a **Not OK** example to allow a 30-second eligibility check.

#### Category 1 — Typo correction
Fix a misspelling or missing punctuation that does not change the meaning of any constraint.

- **OK:** `"invioleable"` → `"inviolable"` (spelling fix, meaning unchanged)
- **OK:** `"Any PR that violates any of these will be rejected"` → `"Any PR that violates any of these will be rejected."` (add trailing period)
- **Not OK:** `"MUST"` → `"must"` — RFC 2119 keyword case change alters normative force; this is a semantic change requiring supersede.
- **Not OK:** `"5 inviolable principles"` → `"5 core principles"` — synonym substitution that weakens the normative label.

#### Category 2 — Dead link repair
Update a URL that has relocated, without changing the anchor text or the resource it refers to.

- **OK:** `https://example.com/old-path` → `https://example.com/new-path` where both resolve to the same document
- **Not OK:** Replacing a link to the original Reo demand report with a link to a newer unrelated report — the resource identity changes.

#### Category 3 — Formatting
Normalize whitespace, fix markdown table column alignment, or fix heading level indentation where the rendered output is semantically identical.

- **OK:** Align `|` characters in a markdown table so columns line up visually
- **Not OK:** Reordering table rows — row order may carry implicit priority meaning; any reorder is substantive.

#### Category 4 — Wording clarity
Rephrase a sentence for readability where **the set of obligations and prohibitions it imposes is provably identical** before and after.

Evaluation rule (apply in order):
1. Identify every normative token in the old text: `MUST`, `SHALL`, `MUST NOT`, `SHALL NOT`, `forbidden`, `inviolable`, `exception`, `escape hatch`, `permitted`, `required`.
2. Confirm every such token and its direct object appear in the new text with the same normative force.
3. Confirm no new obligation or permission is introduced.
4. If all 3 checks pass → wording clarity OK. If any check fails → substantive, requires supersede.

- **OK:** `"No outbound network calls."` → `"The feature makes no outbound network calls."` (same prohibition, fuller subject)
- **OK (synonym within same semantic field):** `"rephrasing for clarity"` → `"rewriting for readability"` — both describe wording improvement without normative weight
- **Not OK:** `"Derived analysis … is forbidden"` → `"Derived analysis … is discouraged"` — normative force drops from absolute prohibition to recommendation; supersede required.
- **Not OK:** Reordering clauses within a principle sentence — reorder changes the emphasis weight readers assign; treat as substantive.

#### `[non-substantive]` PR title and process

PRs claiming this exception MUST:
1. Use the exact prefix `[non-substantive]` (square brackets, lowercase) in the PR title.
2. State the category (1–4) and the rationale for eligibility in the PR description body.
3. Pass the **Layer 2 grep gate semantic-diff check** described below.

Any reviewer may challenge a `[non-substantive]` claim by changing the PR title to remove the prefix; the burden of re-establishing eligibility lies with the author.

#### Layer 2 grep gate — semantic-diff check (pseudo-spec, Builder implementation deferred)

The semantic-diff check is a CI step (`scripts/ci/semantic-diff-check.sh`, to be implemented by Builder) that runs on every `[non-substantive]` PR diff. It flags a diff as **substantive** (failing the check) if any of the following token patterns appear in the changed lines (`+` or `-` in the unified diff):

```
# Normative keyword changes (any RFC 2119 keyword appearing in a changed line)
\bMUST\b, \bSHALL\b, \bMUST NOT\b, \bSHALL NOT\b, \bSHOULD\b, \bMAY\b

# Scope/permission tokens
\bforbidden\b, \binviolable\b, \bexception\b, \bescape hatch\b, \bpermitted\b, \brequired\b

# Structural tokens (principle numbers, section numbers)
^[0-9]+\., ^#{1,4}\s
```

A match on a **changed line** (not a context line) flips the PR to substantive. False positives (e.g., a typo fix that happens to touch a line containing `MUST`) must be resolved by splitting the PR: fix the typo in one commit, and handle the line with the normative token in a separate supersede PR if the token itself is not changing.

> **Quill v1.2 polish note:** The v1.1 draft listed 4 categories without OK/Not-OK examples. This v1.2 polish adds per-category examples and the wording-clarity evaluation rule to enable 30-second eligibility judgment. The Layer 2 grep gate pseudo-spec is a draft for Builder implementation; Quill authored the token list and false-positive policy only. Semantic of the exception itself is unchanged: in-place edits remain permitted for these 4 categories, and normative force of the charter is preserved.

### §6.2 Governance health review (Magi D2 採択前提条件 #4)

This charter SHALL undergo a **6-month governance health review** following its initial commit. The review (named `Fleet Charter Health Review`) MUST evaluate:

1. Number of supersede attempts and their dispositions (accepted / rejected / withdrawn).
2. Number of `[non-substantive]` PRs and any flagged semantic-diff false positives.
3. Layer 2 grep gate hit count and any escape attempts.
4. Whether any of the 5 inviolable principles (§1) has experienced political pressure to weaken.

The review output is a single ADR (`docs/adr/ADR-Fleet-Health-Review-1.md`) that recommends either (i) charter retention as-is, (ii) supersede to v2 with specific principle adjustments, or (iii) escalation to Magi for strategic re-deliberation.

The current latest charter is the only one in force. Older charters are kept for archeological reference but have no governance authority.
