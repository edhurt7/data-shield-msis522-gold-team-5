import { z } from "zod";

import { procedureSourceChunkSchema } from "@/lib/agent/contracts";

export const procedureDocumentSchema = z.object({
  id: z.string().min(1),
  site: z.string().min(1),
  updated_at: z.string().datetime(),
  channel_hint: z.enum(["email", "webform", "unknown"]),
  chunks: z.array(procedureSourceChunkSchema).min(1),
});

export type ProcedureDocument = z.infer<typeof procedureDocumentSchema>;

export const builtInProcedureDocuments: ProcedureDocument[] = [
  {
    id: "fastpeoplesearch-procedure-v1",
    site: "FastPeopleSearch",
    updated_at: "2026-03-01T00:00:00.000Z",
    channel_hint: "webform",
    chunks: [
      {
        doc_id: "fps-proc-1",
        quote: "Use the FastPeopleSearch removal webform to request record suppression.",
      },
      {
        doc_id: "fps-proc-2",
        quote: "Required fields: full name and privacy email. Check the consent checkbox before form submission.",
      },
    ],
  },
  {
    id: "spokeo-procedure-v3",
    site: "Spokeo",
    updated_at: "2026-02-20T00:00:00.000Z",
    channel_hint: "webform",
    chunks: [
      {
        doc_id: "spokeo-proc-1",
        quote: "Open the Spokeo opt-out form and search for the matching profile.",
      },
      {
        doc_id: "spokeo-proc-2",
        quote: "Submit the webform with full name and privacy email, then confirm the request from the email link if prompted.",
      },
    ],
  },
  {
    id: "whitepages-procedure-v1",
    site: "WhitePages",
    updated_at: "2026-03-05T00:00:00.000Z",
    channel_hint: "webform",
    chunks: [
      {
        doc_id: "whitepages-proc-1",
        quote: "Open the WhitePages suppression request form and paste the matching listing URL.",
      },
      {
        doc_id: "whitepages-proc-2",
        quote: "Provide the privacy email address, confirm the request checkbox, and complete the email verification step if prompted.",
      },
    ],
  },
  {
    id: "truepeoplesearch-procedure-v1",
    site: "TruePeopleSearch",
    updated_at: "2026-03-05T00:00:00.000Z",
    channel_hint: "webform",
    chunks: [
      {
        doc_id: "truepeoplesearch-proc-1",
        quote: "Use the TruePeopleSearch removal page to search for the matching profile by full name and city/state.",
      },
      {
        doc_id: "truepeoplesearch-proc-2",
        quote: "Select the matching record, enter the privacy email address, and complete the email confirmation flow if prompted.",
      },
    ],
  },
  {
    id: "radaris-procedure-v1",
    site: "Radaris",
    updated_at: "2026-02-22T00:00:00.000Z",
    channel_hint: "email",
    chunks: [
      {
        doc_id: "radaris-proc-1",
        quote: "Email privacy@radaris.example with a removal request and the matching listing URL.",
      },
      {
        doc_id: "radaris-proc-2",
        quote: "Include your full name and privacy email in the email request.",
      },
    ],
  },
];
