import { ZodError } from "zod";
import { describe, expect, it } from "vitest";

import {
  createBackendProcedureRetriever,
  createDefaultProcedureRetriever,
  createStaticProcedureRetrievalBackendClient,
  reviewReasonsForProcedureResolution,
} from "@/lib/agent";

describe("procedure retrieval integration", () => {
  const input = {
    seed_profile: {
      full_name: "Jane Doe",
      name_variants: [],
      location: { city: "Seattle", state: "Washington" },
      approx_age: null,
      privacy_email: "shield-abc123@detraceme.io",
      optional: { phone_last4: null, prior_cities: [] },
      consent: true as const,
    },
    discovery_result: {
      site: "FastPeopleSearch",
      scan_timestamp: "2026-03-12T12:00:00.000Z",
      found: true,
      candidates: [
        {
          url: "https://example.com/listing/jane-doe",
          extracted: {
            name: "Jane Doe",
            age: "35",
            addresses: [],
            relatives: [],
            phones: [],
          },
          match_confidence: 0.95,
          evidence_snippets: ["Jane Doe, Seattle, WA"],
        },
      ],
      notes: null,
    },
    site: "FastPeopleSearch",
    provided_chunks: [],
    registry_chunks: [],
  };

  const context = {
    run_id: "run_retrieval_001",
    policy: {
      match_confidence_threshold: 0.75,
      max_submission_retries: 1,
      require_explicit_consent: true,
      minimize_pii: true,
      require_retrieval_grounding: true,
    },
    review_reasons: [],
    events: [],
  };

  it("retrieves procedure chunks from backend-shaped data", async () => {
    const retriever = createBackendProcedureRetriever({
      client: createStaticProcedureRetrievalBackendClient([
        {
          site: "FastPeopleSearch",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fps-webform-v2",
              site: "FastPeopleSearch",
              updated_at: "2026-03-10T00:00:00.000Z",
              channel_hint: "webform",
              source_chunks: [
                { doc_id: "fps-live-1", quote: "Use the FastPeopleSearch removal webform." },
                { doc_id: "fps-live-2", quote: "Required fields: full name and privacy email." },
              ],
            },
          ],
        },
      ]),
      now: "2026-03-12T12:00:00.000Z",
    });

    const result = await retriever(input, context);

    expect(result.status).toBe("found");
    expect(result.chunks).toEqual([
      { doc_id: "fps-live-1", quote: "Use the FastPeopleSearch removal webform." },
      { doc_id: "fps-live-2", quote: "Required fields: full name and privacy email." },
    ]);
    expect(result.notes).toContain("fps-webform-v2");
  });

  it("returns missing when the backend has no procedure for the site", async () => {
    const retriever = createBackendProcedureRetriever({
      client: createStaticProcedureRetrievalBackendClient([
        {
          site: "Spokeo",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [],
        },
      ]),
      now: "2026-03-12T12:00:00.000Z",
    });

    const result = await retriever(input, context);

    expect(result.status).toBe("missing");
    expect(result.chunks).toEqual([]);
    expect(result.review_reasons).toEqual(["missing_procedure"]);
  });

  it("marks stale backend procedures for review", async () => {
    const retriever = createBackendProcedureRetriever({
      client: createStaticProcedureRetrievalBackendClient([
        {
          site: "FastPeopleSearch",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fps-old",
              site: "FastPeopleSearch",
              updated_at: "2025-01-01T00:00:00.000Z",
              channel_hint: "webform",
              source_chunks: [{ doc_id: "fps-old-1", quote: "Old webform procedure." }],
            },
          ],
        },
      ]),
      maxAgeDays: 30,
      now: "2026-03-12T00:00:00.000Z",
    });

    const result = await retriever(input, context);

    expect(result.status).toBe("stale");
    expect(result.review_reasons).toEqual(["stale_procedure"]);
  });

  it("marks contradictory backend procedures for review", async () => {
    const retriever = createBackendProcedureRetriever({
      client: createStaticProcedureRetrievalBackendClient([
        {
          site: "FastPeopleSearch",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fps-email",
              site: "FastPeopleSearch",
              updated_at: "2026-03-01T00:00:00.000Z",
              channel_hint: "email",
              source_chunks: [{ doc_id: "fps-email-1", quote: "Email privacy@site.test." }],
            },
            {
              procedure_id: "fps-webform",
              site: "FastPeopleSearch",
              updated_at: "2026-03-02T00:00:00.000Z",
              channel_hint: "webform",
              source_chunks: [{ doc_id: "fps-webform-1", quote: "Use the webform only." }],
            },
          ],
        },
      ]),
      now: "2026-03-12T00:00:00.000Z",
    });

    const result = await retriever(input, context);

    expect(result.status).toBe("contradictory");
    expect(result.review_reasons).toEqual(["contradictory_procedure"]);
    expect(result.chunks.length).toBe(2);
  });

  it("rejects malformed backend payloads", async () => {
    const retriever = createBackendProcedureRetriever({
      client: {
        retrieveProcedures: () => ({
          site: "FastPeopleSearch",
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fps-invalid",
              site: "FastPeopleSearch",
              updated_at: "2026-03-10T00:00:00.000Z",
              channel_hint: "webform",
            },
          ],
        }),
      },
      now: "2026-03-12T12:00:00.000Z",
    });

    await expect(retriever(input, context)).rejects.toBeInstanceOf(ZodError);
  });

  it("prefers provided chunks over backend results", async () => {
    const retriever = createDefaultProcedureRetriever();

    const result = await retriever(
      {
        ...input,
        provided_chunks: [{ doc_id: "fps-live-1", quote: "Use the webform and enter full name and email." }],
      },
      context,
    );

    expect(result.status).toBe("found");
    expect(result.chunks).toEqual([{ doc_id: "fps-live-1", quote: "Use the webform and enter full name and email." }]);
  });

  it("maps contradictory retrieval to an explicit review reason", () => {
    expect(reviewReasonsForProcedureResolution("contradictory")).toEqual(["contradictory_procedure"]);
  });
});
