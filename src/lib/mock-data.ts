export type ScanStatus = "scanning" | "found" | "not_found" | "opted_out" | "failed";
export type HistoryStatus = "pending" | "confirmed" | "re_listed";

export interface BrokerSite {
  id: string;
  name: string;
  url: string;
  status: ScanStatus;
  foundData?: {
    fields: string[];
    optOutMessage?: string;
  };
}

export interface HistoryEntry {
  id: string;
  date: string;
  site: string;
  action: string;
  status: HistoryStatus;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export const mockBrokerSites: BrokerSite[] = [
  {
    id: "1",
    name: "Spokeo",
    url: "spokeo.com",
    status: "found",
    foundData: {
      fields: ["Full Name", "Home Address", "Phone Number", "Email", "Relatives", "Age"],
      optOutMessage: "To whom it may concern,\n\nI am writing to request the immediate removal of my personal information from your database pursuant to applicable privacy laws.\n\nName: John Doe\nProxy Email: shield-a7x29k@detraceme.io\n\nPlease confirm removal within 72 hours.\n\nRegards,\nDetraceMe Agent",
    },
  },
  {
    id: "2",
    name: "WhitePages",
    url: "whitepages.com",
    status: "found",
    foundData: {
      fields: ["Full Name", "Current Address", "Previous Addresses", "Phone Number", "Associates"],
      optOutMessage: "Dear WhitePages Team,\n\nI hereby request the deletion of all personal records associated with my identity from your platform.\n\nName: John Doe\nProxy Email: shield-a7x29k@detraceme.io\n\nPlease confirm within 72 hours.\n\nRegards,\nDetraceMe Agent",
    },
  },
  {
    id: "3",
    name: "BeenVerified",
    url: "beenverified.com",
    status: "opted_out",
  },
  {
    id: "4",
    name: "Intelius",
    url: "intelius.com",
    status: "scanning",
  },
  {
    id: "5",
    name: "PeopleFinder",
    url: "peoplefinder.com",
    status: "not_found",
  },
  {
    id: "6",
    name: "TruePeopleSearch",
    url: "truepeoplesearch.com",
    status: "found",
    foundData: {
      fields: ["Full Name", "Address", "Phone", "Age", "Previous Cities"],
      optOutMessage: "Dear TruePeopleSearch,\n\nPlease remove all records associated with my personal data from your website.\n\nName: John Doe\nProxy Email: shield-a7x29k@detraceme.io\n\nThank you.",
    },
  },
  {
    id: "7",
    name: "FastPeopleSearch",
    url: "fastpeoplesearch.com",
    status: "opted_out",
  },
  {
    id: "8",
    name: "ThatsThem",
    url: "thatsthem.com",
    status: "not_found",
  },
  {
    id: "9",
    name: "Radaris",
    url: "radaris.com",
    status: "found",
    foundData: {
      fields: ["Full Name", "Address", "Phone", "Court Records", "Social Profiles"],
      optOutMessage: "Dear Radaris,\n\nI request the removal of my personal information from your database.\n\nName: John Doe\nProxy Email: shield-a7x29k@privacyshield.io\n\nPlease comply within 72 hours.",
    },
  },
  {
    id: "10",
    name: "USSearch",
    url: "ussearch.com",
    status: "scanning",
  },
  {
    id: "11",
    name: "Pipl",
    url: "pipl.com",
    status: "failed",
  },
  {
    id: "12",
    name: "ZabaSearch",
    url: "zabasearch.com",
    status: "not_found",
  },
];

export const mockHistory: HistoryEntry[] = [
  { id: "h1", date: "2026-03-08", site: "BeenVerified", action: "Opt-out submitted", status: "confirmed" },
  { id: "h2", date: "2026-03-08", site: "FastPeopleSearch", action: "Opt-out submitted", status: "confirmed" },
  { id: "h3", date: "2026-03-07", site: "Spokeo", action: "Listing found", status: "pending" },
  { id: "h4", date: "2026-03-07", site: "WhitePages", action: "Listing found", status: "pending" },
  { id: "h5", date: "2026-03-06", site: "TruePeopleSearch", action: "Listing found", status: "pending" },
  { id: "h6", date: "2026-03-06", site: "Radaris", action: "Listing found", status: "pending" },
  { id: "h7", date: "2026-03-05", site: "Spokeo", action: "Previous removal re-listed", status: "re_listed" },
  { id: "h8", date: "2026-03-04", site: "PeopleFinder", action: "Scan complete — not found", status: "confirmed" },
  { id: "h9", date: "2026-03-03", site: "BeenVerified", action: "Opt-out submitted", status: "confirmed" },
  { id: "h10", date: "2026-03-01", site: "Intelius", action: "Scan initiated", status: "pending" },
];

export const mockChatMessages: ChatMessage[] = [
  {
    id: "c1",
    role: "assistant",
    content: "Welcome back! Your scan found 4 new listings across data broker sites. Would you like me to submit removal requests for all of them?",
    timestamp: "2026-03-08T10:00:00Z",
  },
  {
    id: "c2",
    role: "user",
    content: "Yes, submit removals for Spokeo and WhitePages first.",
    timestamp: "2026-03-08T10:01:00Z",
  },
  {
    id: "c3",
    role: "assistant",
    content: "Got it. I've drafted opt-out requests for Spokeo and WhitePages using your proxy email. You can review them in the listing detail panel before I send them.",
    timestamp: "2026-03-08T10:01:30Z",
  },
];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
];

export function generateProxyEmail(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `shield-${code}@privacyshield.io`;
}

export function getScanSummary(sites: BrokerSite[]) {
  return {
    total: sites.length,
    found: sites.filter((s) => s.status === "found").length,
    optedOut: sites.filter((s) => s.status === "opted_out").length,
    scanning: sites.filter((s) => s.status === "scanning").length,
    notFound: sites.filter((s) => s.status === "not_found").length,
    failed: sites.filter((s) => s.status === "failed").length,
  };
}
