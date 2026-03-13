import type { HistoryEntry } from "@/lib/mock-data";

let sessionHistory: HistoryEntry[] = [];

export function getSessionHistory(fallback: HistoryEntry[] = []) {
  if (sessionHistory.length === 0 && fallback.length > 0) {
    sessionHistory = [...fallback];
  }

  return sessionHistory;
}

export function prependSessionHistory(entry: HistoryEntry) {
  sessionHistory = [entry, ...sessionHistory.filter((item) => item.id !== entry.id)];
  return sessionHistory;
}

export function resetSessionHistory(entries: HistoryEntry[] = []) {
  sessionHistory = [...entries];
  return sessionHistory;
}
