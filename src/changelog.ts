export type ChangelogEntry = {
  version: string;
  date: string;
  items: string[];
};

// Curated product history, newest first. For a meaningful release: update this
// list, bump package.json, run verification, then publish.
export const changelog: ChangelogEntry[] = [
  {
    version: "0.2.0",
    date: "2026-09-04",
    items: [
      "Added Light, Dark and Opposite page themes.",
      "Added Fix, Ask and Note annotation intents.",
      "Added a Settings changelog with an unread update indicator.",
      "Improved the composer and style editor across light and dark themes.",
      "Added a centered precision cursor for selecting small elements.",
    ],
  },
  {
    version: "0.1.7",
    date: "2026-09-03",
    items: [
      "Added voice dictation for annotation feedback.",
      "Improved Settings navigation and keyboard shortcuts.",
      "Improved MCP connection reliability and safety.",
    ],
  },
  {
    version: "0.1.6",
    date: "2026-09-03",
    items: [
      "Added a Structure navigator for inspecting nearby elements.",
      "Added background color editing in the style editor.",
      "Improved element previews while exploring Structure.",
    ],
  },
];

export const CHANGELOG_LAST_SEEN_STORAGE_KEY = "annote:last-seen-version";

type ChangelogStorage = Pick<Storage, "getItem" | "setItem">;

export function latestChangelogEntry(): ChangelogEntry | undefined {
  return changelog[0];
}

export function latestChangelogVersion(): string {
  return latestChangelogEntry()?.version ?? "";
}

export function changelogMatchesVersion(version: string): boolean {
  return latestChangelogVersion() === version;
}

export function formatChangelogDate(isoDate: string, currentYear = new Date().getUTCFullYear()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year === currentYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

export function loadLastSeenChangelogVersion(storage: ChangelogStorage = localStorage): string | null {
  try {
    return storage.getItem(CHANGELOG_LAST_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markLatestChangelogSeen(storage: ChangelogStorage = localStorage): string {
  const version = latestChangelogVersion();
  if (!version) return "";
  try {
    storage.setItem(CHANGELOG_LAST_SEEN_STORAGE_KEY, version);
  } catch {
    // The current session can still treat the entry as seen when storage is unavailable.
  }
  return version;
}

export function hasUnreadChangelog(lastSeenVersion: string | null): boolean {
  // First-time users see only the passive dot; opening the panel clears it.
  const latest = latestChangelogVersion();
  return !!latest && latest !== lastSeenVersion;
}
