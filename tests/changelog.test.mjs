import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  CHANGELOG_LAST_SEEN_STORAGE_KEY,
  changelogMatchesVersion,
  changelog,
  formatChangelogDate,
  hasUnreadChangelog,
  latestChangelogEntry,
  latestChangelogVersion,
  loadLastSeenChangelogVersion,
  markLatestChangelogSeen,
} from "/tmp/feedback-mark-changelog.mjs";
import { ANNOTE_VERSION } from "/tmp/feedback-mark-version.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("changelog entries use the small canonical schema and newest-first order", () => {
  assert.ok(changelog.length > 0);
  for (const entry of changelog) {
    assert.deepEqual(Object.keys(entry).sort(), ["date", "items", "version"]);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.items.length > 0);
    assert.ok(entry.items.every((item) => typeof item === "string" && item.trim().length > 0));
  }
  for (let index = 1; index < changelog.length; index += 1) {
    assert.ok(changelog[index - 1].date >= changelog[index].date, "changelog is not newest first");
  }
});

test("latest changelog entry matches the runtime and package release version", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(latestChangelogEntry(), changelog[0]);
  assert.equal(latestChangelogVersion(), ANNOTE_VERSION);
  assert.equal(latestChangelogVersion(), pkg.version);
  assert.equal(changelogMatchesVersion(pkg.version), true);
  assert.equal(changelogMatchesVersion("999.0.0"), false, "a release-version mismatch was not caught");
});

test("formats ISO dates compactly and includes a different year", () => {
  assert.equal(formatChangelogDate("2026-09-04", 2026), "Sep 4");
  assert.equal(formatChangelogDate("2025-09-04", 2026), "Sep 4, 2025");
  assert.equal(formatChangelogDate("not-a-date", 2026), "not-a-date");
  assert.equal(formatChangelogDate("2026-02-30", 2026), "2026-02-30");
});

test("opening logic persists the latest version and survives a later load", () => {
  const storage = memoryStorage();
  assert.equal(loadLastSeenChangelogVersion(storage), null);
  assert.equal(hasUnreadChangelog(loadLastSeenChangelogVersion(storage)), true);
  assert.equal(markLatestChangelogSeen(storage), latestChangelogVersion());
  assert.equal(storage.values.get(CHANGELOG_LAST_SEEN_STORAGE_KEY), latestChangelogVersion());
  assert.equal(loadLastSeenChangelogVersion(storage), latestChangelogVersion());
  assert.equal(hasUnreadChangelog(loadLastSeenChangelogVersion(storage)), false);
});

test("unavailable storage does not interrupt changelog discovery", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(loadLastSeenChangelogVersion(storage), null);
  assert.equal(markLatestChangelogSeen(storage), latestChangelogVersion());
});

test("changelog styles use shared semantic theme tokens", async () => {
  const source = await readFile(new URL("../src/annotator.ts", import.meta.url), "utf8");
  const start = source.indexOf("      .changelog-detail {");
  const end = source.indexOf("      .settings-copy {", start);
  assert.ok(start >= 0 && end > start, "changelog style block missing");
  const styles = source.slice(start, end);
  assert.ok(styles.includes("var(--fm-text-strong)"));
  assert.ok(styles.includes("var(--fm-text-muted)"));
  assert.ok(styles.includes("var(--fm-text-subtle)"));
  assert.ok(!styles.includes("#") && !styles.includes("rgba("), "changelog introduced theme-specific colors");
});
