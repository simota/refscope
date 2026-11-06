import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOwners,
  formatCount,
  formatDays,
  ownerFilterValue,
  ownerShare,
  ownersSummary,
  releaseCadence,
  releaseDate,
} from "../src/app/lib/insights.ts";

const day = 86_400_000;
const at = (days: number) => new Date(Date.UTC(2024, 0, 1) + days * day).toISOString();

test("releaseDate prefers the tagger date over the commit date", () => {
  assert.equal(releaseDate({ taggedAt: at(3), committedAt: at(1) }), at(3));
  assert.equal(releaseDate({ taggedAt: null, committedAt: at(1) }), at(1));
  assert.equal(releaseDate({ taggedAt: null, committedAt: null }), null);
});

test("releaseCadence takes the median gap and the age of the newest release", () => {
  const releases = [at(30), at(20), at(14), at(0)].map((iso) => ({ taggedAt: iso, committedAt: null }));
  const cadence = releaseCadence(releases, Date.parse(at(35)));
  assert.equal(cadence.medianDays, 10);
  assert.equal(cadence.daysSinceLatest, 5);
  // Even count of gaps averages the middle two; undated entries are skipped.
  const even = releaseCadence(
    [at(10), at(8), at(2), at(0), "bad"].map((iso) => ({ taggedAt: iso, committedAt: null })),
    Date.parse(at(10)),
  );
  assert.equal(even.medianDays, 2);
  assert.deepEqual(releaseCadence([], 0), { medianDays: null, daysSinceLatest: null });
  assert.equal(releaseCadence([{ taggedAt: at(1), committedAt: null }], Date.parse(at(2))).medianDays, null);
});

test("formatDays and formatCount stay readable", () => {
  assert.equal(formatDays(0.1), "2 hours");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(13.6), "14 days");
  assert.equal(formatDays(90), "3 months");
  assert.equal(formatDays(800), "2 years");
  assert.equal(formatCount(1200, false), "1,200");
  assert.equal(formatCount(5000, true), "5,000+");
});

test("ownerShare and activeOwners", () => {
  assert.equal(ownerShare({ commits: 1 }, 3), 33);
  assert.equal(ownerShare({ commits: 1 }, 0), 0);
  assert.deepEqual(activeOwners([{ recentCommits: 0 }, { recentCommits: 2 }]), [{ recentCommits: 2 }]);
});

test("ownersSummary says what was counted", () => {
  assert.equal(
    ownersSummary({ path: "src", authorCount: 3, scannedCommits: 12, truncated: false, majorityAuthors: 1 }),
    "3 authors across 12 non-merge commits touching src. One author made half or more of them.",
  );
  assert.equal(
    ownersSummary({ path: "", authorCount: 1, scannedCommits: 3000, truncated: true, majorityAuthors: 1 }),
    "1 author across 3,000+ non-merge commits (newest only) touching the repository.",
  );
  assert.equal(
    ownersSummary({ path: "x", authorCount: 0, scannedCommits: 0, truncated: false, majorityAuthors: 0 }),
    "No commit changed x in this history.",
  );
});

test("ownerFilterValue prefers the e-mail unless redacted", () => {
  assert.equal(ownerFilterValue({ author: "Ann", authorEmail: "ann@x.test" }, false), "ann@x.test");
  assert.equal(ownerFilterValue({ author: "AN·1a2b", authorEmail: "[redacted]" }, true), "AN·1a2b");
  assert.equal(ownerFilterValue({ author: "Ann", authorEmail: "" }, false), "Ann");
});
