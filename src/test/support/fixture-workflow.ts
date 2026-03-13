import {
  createAgentWorkflow as createBaseAgentWorkflow,
  createDefaultProcedureRetriever,
  type ExecutionResult,
  type ProcedureRetriever,
  type WorkflowRunOutput,
} from "@/lib/agent";
import { fastPeopleSearchFixture } from "@/lib/agent/fixtures/fastpeoplesearch";
import { createWorkflowFixtureLlmAdapter } from "@/test/support/workflow-fixture-llm";

const basePolicy = {
  match_confidence_threshold: 0.75,
  max_submission_retries: 1,
  monitoring_cadence_days: 30,
  re_review_cooldown_days: 30,
  re_review_listing_reappearance_threshold: 1,
  require_explicit_consent: true,
  minimize_pii: true,
  require_retrieval_grounding: true,
};

export const fixtureWorkflowBaseContext = {
  policy: basePolicy,
  review_reasons: [],
  events: [],
};

function createProcedureFetch() {
  return async (_request: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { site?: string };

    if (body.site === fastPeopleSearchFixture.site) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          site: fastPeopleSearchFixture.site,
          retrieved_at: "2026-03-12T12:00:00.000Z",
          procedures: [
            {
              procedure_id: "fastpeoplesearch-procedure-v1",
              site: fastPeopleSearchFixture.site,
              updated_at: "2026-03-10T00:00:00.000Z",
              channel_hint: "webform",
              source_chunks: fastPeopleSearchFixture.procedureChunks.map((chunk) => ({
                ...chunk,
                source_id: "fastpeoplesearch-procedure-v1",
                source_updated_at: "2026-03-10T00:00:00.000Z",
                retrieved_at: "2026-03-12T12:00:00.000Z",
              })),
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        site: body.site ?? "unknown",
        retrieved_at: "2026-03-12T12:00:00.000Z",
        procedures: [],
      }),
    } as Response;
  };
}

export function createFixtureBackedWorkflow(...args: Parameters<typeof createBaseAgentWorkflow>) {
  const [options] = args;

  return createBaseAgentWorkflow({
    procedureRetriever: createDefaultProcedureRetriever({
      fetchFn: createProcedureFetch() as typeof fetch,
    }),
    llm: {
      adapter: createWorkflowFixtureLlmAdapter(),
    },
    ...options,
  });
}

export async function runFixtureWorkflow(
  input: {
    runId: string;
    site: string;
    requestText: string;
    seedProfile: typeof fastPeopleSearchFixture.seedProfile;
    listingPageText: string;
    pageArtifact?: { visible_text: string; url: string; screenshot_ref?: string | null; extracted_metadata?: Record<string, unknown> };
    candidateUrl: string;
    retrievedChunks?: { doc_id: string; quote: string }[];
    executionResult?: ExecutionResult;
  },
  options?: {
    procedureRetriever?: ProcedureRetriever;
    policyOverrides?: Partial<typeof basePolicy>;
  },
): Promise<WorkflowRunOutput> {
  const workflow = createFixtureBackedWorkflow(options);

  return workflow.run({
    context: {
      ...fixtureWorkflowBaseContext,
      policy: {
        ...fixtureWorkflowBaseContext.policy,
        ...options?.policyOverrides,
      },
      run_id: input.runId,
    },
    seed_profile: input.seedProfile,
    request_text: input.requestText,
    site_input: {
      site: input.site,
      page_artifact: input.pageArtifact ?? {
        visible_text: input.listingPageText,
        url: input.candidateUrl,
        screenshot_ref: null,
      },
      retrieved_chunks: input.retrievedChunks ?? [],
      execution_result: input.executionResult,
    },
  });
}
