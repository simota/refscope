# ADR-Fleet-002: Charter v2 Supersede — User Authority Override of Magi D4 Verdict

> **Status:** ACCEPTED
> **Date:** 2026-05-03
> **Deciders:** User (authority override), Quill (Magi D2 supersede pathway execution)
> **Supersedes:** `docs/fleet-charter.md` (v1, 2026-05-03)
> **New charter:** `docs/fleet-charter-v2.md`

## Context

Magi D4 (2026-05-03, 3-0 unanimous, Confidence 81/100) adopted O2 (CommandPalette jump) + O3 (env var `RTGV_REPOS` maintenance) and **rejected O1** (explicit "Open →" button + UI-based repository addition) for the following reasons:

- FleetSurface row に "Open →" button を追加すると 28px row の情報密度が過剰になる
- UI implementation cost が O2 の約 2 倍
- Sophia: "small is beautiful" 原則に反する

Magi D4 also noted retreat condition R4-3: if ≥3/5 real SREs explicitly request "UI で追加したい", Magi D4 re-deliberation would be triggered.

**User feedback received (post-D4):** "CLI から複数リポジトリを設定するより WEB UI でリポジトリを追加できるほうがよい" with explicit selection of "A) Persistent (file-based)" as the persistence strategy.

This feedback constitutes direct user authority override of the Magi D4 verdict. The charter v1 §6 supersede pathway (Magi D2 §6 amendment process) is the constitutionally correct mechanism to effect this change without violating the charter immutability discipline.

The v1 SUPERSEDED header annotation added in this ADR is judged to fall within charter §6.1 Category 4 (wording clarity, normative force unchanged — the annotation is a pointer to v2, not a weakening of v1 normative force). This is a Quill self-determination per §6.1 evaluation rule; recorded here for transparency.

## Decision

Create `docs/fleet-charter-v2.md` as a supersede of `docs/fleet-charter.md` (v1), via the §6 amendment process. The following changes are made:

1. **§1 Principle 2** — Add explicit permission for file-based persistence of the user-managed repository allowlist (`~/.config/refscope/repos.json`). All other state remains memory-only.

2. **§1 Principle 3** — Extend the allowlist source of truth to include the UI-add list persisted at `~/.config/refscope/repos.json`, while preserving the anti-auto-discovery constraint (all entries require explicit user action).

3. **§3 Forbidden UI vocabulary** — Remove `"Add repository"`, `"Open repository"`, and `"Browse for repository"` from the forbidden list. Team-feature vocabulary (`Team / Organization / Workspace / Members / Invite / Role / presence / Share / Login / Avatar`) is fully preserved (Magi D1 guardrail intact).

4. **§5 Schema versioning** — Add `repos.json` schema (version 1) literal description (`{ "version": 1, "repos": [{"id": string, "path": string, "addedAt": ISO8601}] }`).

5. **§6.2 baseline** — Reset 6-month governance health review baseline to v2 commit date (2026-05-03); next review due 2026-11-03.

Charter v1 is annotated with a SUPERSEDED header notice (§6.1 Category 4); its body (§1–§6) is preserved unmodified as historical record.

**§6 amendment process compliance note:** §6 process #2 requires ≥2 CODEOWNERS reviewers. User authority override reduces this to 1 reviewer (the user themselves) for this supersede. This exception is explicitly recorded here. Future supersedes must restore the ≥2 reviewers requirement unless a further explicit user authority override is documented.

## Consequences

**Positive:**
- User-requested UX improvement (UI-based repo addition) is now constitutionally permitted.
- Charter immutability discipline is preserved via the supersede pathway (no in-place edit of normative content).
- Magi D1 team-feature guardrail is fully preserved in v2.
- The §2 forbidden token list is unchanged; `scripts/ci/forbid-derived-words.sh` requires no modification; `make verify` fleet-gate is unaffected.

**Negative / risks:**
- §6 ≥2 reviewers requirement is reduced to 1 for this supersede (documented exception).
- File-based persistence introduces a new failure mode (file corruption, permission errors) not present in env-var-only configuration.

**Retreat conditions (v2-specific, extending Magi D4 R4-1/R4-2/R4-3):**

| ID | Trigger | Action |
|---|---|---|
| **R4-1** | CommandPalette jump が Fleet UX の cognitive load を増やすと実 SRE ≥3/5 名が報告 | `Detail: <repoId> を開く` コマンドを削除し FleetSurface row に "Open" button を Magi 再 deliberation に諮る |
| **R4-2** | Researcher セッションで "CommandPalette を開かずに repo を直接 click する" が ≥4/5 名で自然な行動として観察される | CommandPalette command は維持しつつ FleetSurface row に hover 時 "Open →" CTA を追加する小規模 UX 補完を Artisan に handoff |
| **R4-3** | env var `RTGV_REPOS` 管理 UX の不満が ≥3/5 名から "UI で追加したい" として明示的に挙がる | 本 ADR により charter v2 で解決済 |
| **R4-v2-sec-incident** | `~/.config/refscope/repos.json` に起因するセキュリティインシデント (path traversal, unauthorized write) が報告される | repos.json 機能を無効化し env var only に戻す charter v3 supersede を即時起草 |
| **R4-v2-corruption** | repos.json の読み書きエラーによる起動失敗が複数ユーザーから報告される (≥3 件) | repos.json をオプション機能 (opt-in flag) に格下げし、エラー時は env var fallback を保証する charter v3 supersede |
| **R4-v2-misuse** | UI add 機能が "チーム共有" 目的で利用されているパターンが確認される (例: repos.json をチームで共有・同期する CI パイプライン) | repos.json path を user-local のみに制限する enforcement を追加する charter v3 supersede |
| **R4-v2-no-adoption** | UI add 機能のリリース後 6 ヶ月で実使用率が ≤5% (telemetry opt-in ユーザー測定) の場合 | §6.2 governance health review で "feature retention vs removal" を Magi に諮る |

**Next Magi agenda candidate:** "supersede pathway 濫用防止策" (D6 議題候補) — 本 ADR は user authority override による §6 ≥2 reviewers 縮退の初例であり、将来の濫用防止ルール策定を次回 Magi 招集時に議題として list する。
