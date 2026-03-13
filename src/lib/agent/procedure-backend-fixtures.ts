import type { BackendProcedureRetrievalResponse } from "@/lib/agent/retrieval";

export const builtInProcedureBackendResponses: BackendProcedureRetrievalResponse[] = [
  {
    site: "FastPeopleSearch",
    retrieved_at: "2026-03-12T00:00:00.000Z",
    procedures: [
      {
        procedure_id: "fastpeoplesearch-procedure-v1",
        site: "FastPeopleSearch",
        updated_at: "2026-03-01T00:00:00.000Z",
        channel_hint: "webform",
        source_chunks: [
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
    ],
  },
  {
    site: "Spokeo",
    retrieved_at: "2026-03-12T00:00:00.000Z",
    procedures: [
      {
        procedure_id: "spokeo-procedure-v3",
        site: "Spokeo",
        updated_at: "2026-02-20T00:00:00.000Z",
        channel_hint: "webform",
        source_chunks: [
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
    ],
  },
  {
    site: "Radaris",
    retrieved_at: "2026-03-12T00:00:00.000Z",
    procedures: [
      {
        procedure_id: "radaris-procedure-v1",
        site: "Radaris",
        updated_at: "2026-02-22T00:00:00.000Z",
        channel_hint: "email",
        source_chunks: [
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
    ],
  },
];
