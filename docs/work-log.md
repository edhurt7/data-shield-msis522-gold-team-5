# Work Log

## 2026-03-12

### Update 1

Scaffolded the initial agent contract layer for the LLM and orchestration workflow.

Added:

- `src/lib/agent/contracts.ts`
- `src/lib/agent/state-machine.ts`
- `src/lib/agent/index.ts`
- `src/test/agent-contracts.test.ts`

This contract layer defines the shared schemas and TypeScript types for:

- agent run phases and statuses
- user intent and search profile input
- listing candidates and evidence
- match decisions with confidence scores
- retrieved opt-out procedures
- drafted opt-out requests
- automation handoffs
- workflow timeline events
- execution outcomes

It also defines the first-pass workflow state machine for the agent lifecycle:

`intake -> scan -> match -> retrieve_procedure -> draft -> approval -> execution -> verification -> logging -> completed`

Notes:

- The contract is backend-agnostic so the Lovable frontend can consume stable shapes later without being tightly coupled to LangGraph internals.
- Validation tests were added, but local verification is currently blocked because frontend dependencies are not installed in this workspace, so `npm test` and `npm run build` could not run.

### Update 3

Wired the existing frontend mock layer to the new agent contract schemas.

Completed:

- Added `src/lib/agent/mock-run.ts` as a schema-validated demo agent run fixture
- Reworked `src/lib/mock-data.ts` to derive dashboard, history, and listing detail data from the validated agent state instead of hard-coded standalone UI mocks
- Added `src/test/mock-data.test.ts` to verify the adapter output remains aligned with the contract-backed fixture

Result:

- The current Lovable frontend can keep using its existing component props and mock exports
- The underlying mock data now flows from the agent contract layer, which gives us a stable bridge to future backend and LangGraph integration

Verification:

- `npm test` passed with 3 test files and 10 total tests
- `npm run build` passed successfully

Notes:

- Build still emits a large bundle warning for the main JavaScript chunk. This is not blocking current work.

### Update 4

Defined the initial frontend-to-backend transport contract for the future FastAPI and LangGraph service.

Completed:

- Added `src/lib/agent/api.ts` with schema-validated request and response shapes for:
  - create run
  - get run
  - list runs
  - send chat command
  - submit approval
  - trigger rescan
  - append execution result
- Added `src/lib/agent/client.ts` with a small typed fetch client and a dedicated `AgentApiError`
- Updated `src/lib/agent/index.ts` exports to include the new transport layer
- Added `src/test/agent-api.test.ts` to validate both schema parsing and client request behavior

Result:

- The repo now has a concrete API contract the frontend can target before the FastAPI service exists
- The future backend can implement against stable paths and payloads instead of ad hoc UI-driven shapes

Verification:

- `npm test` passed with 4 test files and 15 total tests
- `npm run build` passed successfully

### Update 5

Added a React Query-backed dashboard integration layer on top of the agent mock service.

Completed:

- Added `src/lib/agent/mock-service.ts` as a temporary in-memory service that simulates dashboard reads and chat command updates
- Added `src/hooks/use-agent-dashboard.ts` with query and mutation hooks for dashboard data and chat submission
- Refactored `src/lib/mock-data.ts` into reusable adapter functions so UI shapes can be derived from any `AgentRunState`
- Updated `src/pages/DashboardPage.tsx` to read sites and chat messages through the hook layer
- Updated `src/pages/HistoryPage.tsx` to read activity log data through the same dashboard query abstraction
- Updated `src/components/ChatBar.tsx`, `src/components/SummaryBar.tsx`, and `src/components/ScanProgress.tsx` to accept data via props instead of importing singleton mocks directly
- Added `src/test/mock-agent-service.test.ts` to validate the temporary service behavior

Result:

- The current frontend now has a realistic integration seam for a future backend without forcing a major Lovable UI rewrite
- Chat interactions on the dashboard now flow through a mutation path instead of local component-only state

Verification:

- `npm test` passed with 5 test files and 17 total tests
- `npm run build` passed successfully

### Update 6

Normalized the agent contract layer to match the project spec more directly and added graph-node interface schemas for the proposed LangGraph workflow.

Completed:

- Extended `src/lib/agent/contracts.ts` with exact spec-level schemas for:
  - `SeedProfile`
  - `DiscoveryResult`
  - `ProcedureRetrieval`
  - `SubmissionPayload`
  - `ExecutionResult`
  - policy thresholds and guardrail config
- Added `src/lib/agent/graph.ts` with typed node input/output contracts for:
  - `validate_consent`
  - `discovery_parse`
  - `retrieve_procedure`
  - `draft_optout`
  - `plan_submission`
  - `interpret_result`
- Expanded `src/lib/agent/api.ts` to include a spec-aligned start-run request using `seed_profile`
- Updated exports in `src/lib/agent/index.ts`
- Added `src/test/agent-graph.test.ts`
- Expanded `src/test/agent-contracts.test.ts` and `src/test/agent-api.test.ts` to validate the spec-level shapes

Result:

- The repo now contains both the broader internal run-state model and the exact external schemas described in the Agent & LLM Logic spec
- The next step can be building the runnable LangGraph skeleton against stable node contracts rather than continuing to refine data shapes

Verification:

- `npm test` passed with 6 test files and 26 total tests
- `npm run build` passed successfully

### Update 7

Built the first runnable agent workflow skeleton for the proposed LangGraph phases.

Completed:

- Added `src/lib/agent/workflow.ts` with:
  - a conservative sequential workflow runner
  - typed node interfaces for the six proposed graph nodes
  - default deterministic node implementations for:
    - `validate_consent`
    - `discovery_parse`
    - `retrieve_procedure`
    - `draft_optout`
    - `plan_submission`
    - `interpret_result`
  - a simple in-memory site registry interface
- Updated `src/lib/agent/index.ts` exports to include the workflow module
- Added `src/test/agent-workflow.test.ts` covering:
  - one-site golden path
  - missing procedure fallback
  - low-confidence fallback

Result:

- The repo now has a runnable orchestration skeleton that follows the intended graph phases and enforces the core guardrails:
  - no progression without consent
  - no drafting without grounded procedure retrieval
  - no submission planning when match confidence is below threshold
- This is still deterministic placeholder logic, not LLM-backed reasoning, but it establishes the exact execution seam where prompt-driven node implementations can be dropped in next

Verification:

- `npm test` passed with 7 test files and 29 total tests
- `npm run build` passed successfully

### Update 8

Added the first prompt and structured-output adapter layer for the agent workflow.

Completed:

- Added `src/lib/agent/prompts.ts` with strict prompt definitions for:
  - listing classifier / extractor
  - procedure selector
  - draft generator
  - post-execution verifier
- Added `src/lib/agent/llm.ts` with:
  - a pluggable structured-output adapter interface
  - `createPromptBackedNodes(...)` to wire prompt-backed node implementations into the workflow
  - a fixture adapter for local testing without live model calls
- Updated `src/lib/agent/index.ts` exports to include the new prompt and adapter modules
- Added `src/test/agent-prompts.test.ts` to verify prompt construction and guardrail language
- Added `src/test/agent-llm.test.ts` to verify the workflow can run using prompt-backed nodes through the fixture adapter

Result:

- The repo now has a concrete seam for swapping deterministic placeholder node logic with real LLM-backed structured-output calls
- Prompting strategy is encoded in code rather than only in planning notes
- The workflow can already execute through model-style nodes without changing its outer orchestration contract

Verification:

- `npm test` passed with 9 test files and 33 total tests
- `npm run build` passed successfully

### Update 9

Added the first saved-artifact one-site golden path and lightweight evaluation harness for the agent workflow.

Completed:

- Added `src/lib/agent/fixtures/fastpeoplesearch.ts` with:
  - saved seed profile
  - saved listing page text
  - saved procedure chunks
  - saved execution result
  - expected outcome targets
- Added `src/lib/agent/eval.ts` with a lightweight golden-path evaluator
- Added `src/test/agent-golden-path.test.ts` to run the workflow end-to-end on the FastPeopleSearch fixture
- Added `src/test/agent-eval.test.ts` to evaluate the workflow output against expected match/procedure/draft/result checks
- Updated `src/lib/agent/index.ts` exports to include the evaluation helper

Result:

- The agent layer now has one concrete site fixture that exercises the workflow using saved artifacts rather than only synthetic inline test data
- The repo now has the beginnings of the evaluation harness described in the project plan
- This closes a major gap between schema design and real agent-behavior validation

Verification:

- `npm test` passed with 11 test files and 35 total tests
- `npm run build` passed successfully

### Update 10

Expanded the agent evaluation harness with adversarial fixture coverage for ambiguous-match fallback behavior.

Completed:

- Added `src/lib/agent/fixtures/fastpeoplesearch-negative.ts` with:
  - an ambiguous-match fixture
- Expanded `src/lib/agent/eval.ts` with review-fallback evaluation helpers
- Updated `src/test/agent-eval.test.ts` to validate:
  - happy-path fixture behavior
  - ambiguous-match fallback behavior
- Updated `src/test/agent-golden-path.test.ts` to assert workflow blocking behavior on the ambiguous-match fixture

Result:

- The evaluation harness now tests a high-risk failure mode from the project spec:
  - ambiguous identity matches
- This improves confidence that the workflow will fail closed rather than over-submit when evidence is weak

Verification:

- `npm test` passed with 11 test files and 39 total tests
- `npm run build` passed successfully

### Update 11

Focused the branch-level one-site path on FastPeopleSearch with repo-backed listing artifacts and retrieval-grounded workflow assertions.

Completed:

- Moved the FastPeopleSearch captured listing and confirmation text into repo artifact files under `src/lib/agent/fixtures/artifacts/fastpeoplesearch/`
- Updated the FastPeopleSearch fixtures to load those saved artifacts instead of embedding the listing text inline
- Extended the workflow output with an explicit `match_decision` object carrying decision, confidence, rationale, and evidence
- Tightened the submission payload contract so a handoff cannot contain both `email` and `webform` payloads at once
- Narrowed the end-to-end FastPeopleSearch coverage to:
  - one retrieval-backed happy path
  - one same-site blocked path for low-confidence matching
- Expanded the evaluation harness to assert:
  - explicit match decision output
  - grounded procedure retrieval
  - clean automation handoff payload shape
  - post-execution status interpretation

Result:

- The branch now treats FastPeopleSearch as the single real integration target for saved-artifact coverage
- Procedure grounding for that path comes from the retrieval layer rather than manually injected chunks in the end-to-end tests
- The output contract is cleaner for automation handoff because mixed-channel submission payloads are now rejected

Verification:

- `npm test` passed with 13 test files and 52 total tests

### Update 12

Locked the current fixture-backed agent paths into an explicit baseline regression suite.

Completed:

- Added `src/test/support/fixture-workflow.ts` to centralize the fixture-backed workflow runner and mocked retrieval backend
- Updated `src/test/agent-golden-path.test.ts` and `src/test/agent-eval.test.ts` to use the shared fixture runner
- Added `src/test/agent-baseline-regression.test.ts` covering the current saved-fixture baselines for:
  - FastPeopleSearch happy path
  - ambiguous low-confidence block
  - incomplete-procedure no-grounding fallback
  - Radaris email draft quality
  - unclear execution evidence fail-closed behavior

Result:

- The repo now has an explicit baseline regression suite for the current fixture-backed behavior instead of relying on that baseline only implicitly across broader tests
- Future workflow or prompt changes can be evaluated against a stable saved-fixture contract before expanding to new sites or live integrations

## Remaining Work For Eddie

### Highest Priority

- Replace the fixture structured-output adapter with a real LLM model adapter
  - connect prompt-backed nodes to a live structured-output model client
  - preserve schema validation on all model outputs
  - verify the four prompt paths with real model calls:
    - listing classifier / extractor
    - procedure selector
    - draft generator
    - post-execution verifier

- Add real retrieval integration
  - connect procedure selection to a vector store or retrieval layer
  - load retrieved chunks dynamically instead of injecting saved chunks
  - handle stale, missing, or contradictory retrieval results explicitly

- Implement a real one-site end-to-end path
  - use one selected broker site as the first real integration target
  - connect listing artifact -> retrieval -> draft -> submission payload -> execution interpretation
  - keep the same evaluation fixtures to compare live behavior against expected outputs

### Next Priority

- Expand evaluation coverage
  - add more ambiguous-match and false-positive fixtures
  - add contradictory-retrieval fixtures
  - add draft completeness checks against required fields and policy constraints
  - measure fallback behavior quality, not just happy-path success

- Finalize policy defaults with the team
  - production match confidence threshold
  - retry policy
  - manual review escalation rules
  - pending confirmation handling rules
  - monitoring cadence

### Later

- Add monitoring / re-scan workflow
  - model the monthly or configurable recheck cycle
  - compare newly discovered listings against prior outcomes
  - trigger new removal cycles when re-listed

- Integrate real automation results
  - connect execution-result interpretation to Playwright outputs
  - consume confirmation text, ticket IDs, screenshots, and error states from actual automation

## 2026-03-13

### Update 13

Defined the week-1 web automation execution boundary for future Playwright integration.

Completed:

- Added `src/lib/automation/types.ts` with internal automation-only types for:
  - site executors
  - evidence bundles
  - artifacts
  - step outcomes
- Added `src/lib/automation/runner.ts` with a typed `executeAutomation(handoff)` entry point
- Added `src/lib/automation/errors.ts` with known execution failure classes:
  - `captcha`
  - `rate_limited`
  - `selector_missing`
  - `site_changed`
  - `manual_review_required`
- Added `src/lib/automation/site-registry.ts` with a registry seam for site-specific executors
- Added `src/lib/automation/sites/fastpeoplesearch.ts` as the first placeholder site executor
- Added `src/lib/automation/artifacts.ts` for execution evidence and artifact helpers
- Added tests:
  - `src/test/automation-runner.test.ts`
  - `src/test/automation-fastpeoplesearch.test.ts`
- Added `docs/web-automation-role.md`

Result:

- The repo now has a clean execution-layer boundary that accepts the existing `ActionHandoff` contract and returns a contract-safe `ExecutionResult` plus structured internal evidence
- The runner fails closed before execution when approval or review gates are still open
- Site-specific browser logic is now isolated behind a registry-driven executor seam instead of being coupled directly to the workflow

Verification:

- Pending local test run after adding the new automation module and tests

### Update 14

Built the reusable week-2 Playwright execution engine for simple contract-driven form steps.

Completed:

- Installed Playwright packages and added:
  - `playwright` dev dependency
  - `@playwright/test` dev dependency
  - `playwright.config.ts`
  - `playwright:install` script for Chromium setup
- Reworked `src/lib/automation/runner.ts` into a generic browser runner that:
  - launches a Playwright browser by default
  - executes `navigate`, `fill`, `select`, `click`, and `wait` steps
  - treats `submit` as a click-style action when a selector is present
  - enforces per-step timeout and retry behavior
  - captures screenshot, HTML, and page-text artifacts on terminal step failure
  - emits structured JSON step logs as automation artifacts
- Expanded `src/lib/automation/artifacts.ts` with page capture helpers for:
  - screenshot
  - HTML snapshot
  - visible page text
  - step-log artifact generation
- Replaced `src/test/automation-runner.test.ts` with generic-runner coverage for:
  - approval short-circuiting
  - successful step execution
  - retry recovery
  - failure artifact capture

Result:

- The automation layer now has a reusable browser execution core instead of only a site-registry wrapper
- Simple contract-driven webform flows can execute end-to-end without site-specific code when selectors and field bindings are present in the handoff
- Failures now return richer execution evidence for debugging and auditability

Verification:

- `npm test` passed with 16 test files and 118 total tests
- Real browser execution still requires `npm run playwright:install` to download Chromium locally

### Update 15

Added the first broker-specific adapter on top of the generic Playwright engine: FastPeopleSearch.

Completed:

- Reworked `src/lib/automation/site-registry.ts` so the default registry now includes FastPeopleSearch again
- Replaced the placeholder `src/lib/automation/sites/fastpeoplesearch.ts` executor with a real site adapter that:
  - rewrites the incoming handoff into a FastPeopleSearch-specific step plan
  - encodes the entry URL and selectors for the removal flow
  - validates required fields before execution
  - reuses the generic runner through the execution context
  - detects expected confirmation text
  - escalates to manual review on unsupported channels, CAPTCHA/block text, or missing confirmation language
- Replaced `src/test/automation-fastpeoplesearch.test.ts` with adapter-level coverage for:
  - registry wiring
  - site-specific selectors and entry URL
  - confirmation detection
  - manual-review fallback behavior

Result:

- FastPeopleSearch is now the first registered site adapter layered on top of the reusable browser runner instead of a standalone placeholder
- The generic runner remains the shared execution engine, while the site adapter owns site-specific navigation details and confirmation logic

Verification:

- `npm test` passed with 16 test files and 120 total tests

### Update 16

Hardened the automation layer to fail closed under real-world browser failures instead of returning optimistic success.

Completed:

- Expanded `src/lib/automation/errors.ts` with an explicit timeout failure class
- Tightened `src/lib/automation/runner.ts` to:
  - classify raw browser errors into CAPTCHA, rate-limit, selector-missing, site-changed, timeout, or manual-review paths
  - capture page text into `confirmation_text` on failure when available
  - capture a success screenshot and attach it to `screenshot_ref`
  - schema-validate terminal `ExecutionResult` objects before returning them
- Updated the FastPeopleSearch adapter to preserve generic-runner evidence when:
  - CAPTCHA is detected
  - blocked/rate-limited pages are detected
  - expected confirmation text is missing
- Expanded tests for:
  - CAPTCHA
  - missing selectors
  - timeout
  - confirmation page not found

Result:

- The automation layer now fails closed with evidence instead of discarding browser context when site conditions degrade
- Success and failure paths both preserve screenshot and page-text evidence
- Returned automation results are validated against the shared `executionResultSchema`

Verification:

- `npm test` passed with 16 test files and 124 total tests

### Update 17

Integrated the automation layer into the existing agent workflow seam.

Completed:

- Re-exported automation modules through `src/lib/agent/index.ts`
- Extended `src/lib/agent/workflow.ts` with:
  - a workflow-side automation record schema
  - `automation_record` on workflow site outputs
  - a workflow handoff builder that converts the current planning output into an `ActionHandoff` for supported sites
  - `runWithAutomation(...)`, which:
    - runs the existing workflow through retrieval/draft/planning
    - executes automation from the generated handoff
    - feeds the returned `ExecutionResult` back through workflow interpretation
    - returns the structured automation record alongside the interpreted workflow output
- Added `src/test/agent-workflow-automation.test.ts` covering:
  - retrieval
  - draft generation
  - handoff creation
  - automation execution
  - result interpretation

Result:

- The repo now has a working end-to-end path from workflow planning to automation execution to interpreted execution outcome
- Automation evidence is carried back into the workflow output rather than being lost at the execution boundary

Verification:

- `npm test` passed with 17 test files and 125 total tests

### Update 18

Hardened the automation layer for team handoff and future broker expansion.

Completed:

- Added `src/lib/automation/sites/site-adapter.template.ts` as a starting point for new broker adapters
- Expanded `src/lib/automation/site-registry.ts` with:
  - support-status metadata
  - verification dates
  - known issues
  - a default support matrix the docs and backend can reference
- Updated `docs/web-automation-role.md` with:
  - a support matrix covering `supported`, `partial`, `manual_only`, and `blocked`
  - backend persistence guidance for:
    - status
    - confirmation text
    - screenshot ref
    - error text
    - ticket IDs
  - onboarding notes for adding new site adapters

Result:

- The automation layer is now documented as a maintainable subsystem rather than a one-off implementation for a single site
- New adapters have a clear starting point, and backend persistence expectations are explicit for future FastAPI/storage work

Verification:

- Documentation and registry updates only; no runtime behavior changed

### Update 19

Closed the remaining definition-of-done gaps for the web automation role.

Completed:

- Added automation-level failure metadata:
  - `failureCode`
  - structured `reviewReasons`
- Propagated that metadata through the automation record returned to the workflow
- Added an explicit `site_changed` regression test
- Added a real Playwright smoke script:
  - `npm run playwright:smoke`
- Installed Chromium locally and verified a real browser launch

Result:

- Automation failures now produce both evidence artifacts and structured failure metadata instead of relying only on downstream interpretation
- Playwright is no longer only dependency-installed; it has a verified runnable browser path in this workspace

Verification:

- `npm run playwright:install` passed
- `npm run playwright:smoke` passed
- `npm test` passed with 17 test files and 126 total tests

### Update 20

Closed the remaining maintainability items surfaced by the definition-of-done review.

Completed:

- Extracted workflow handoff construction into `src/lib/automation/handoff.ts`
- Replaced the workflow-local handoff builder with the shared automation mapping module
- Added typed support-matrix helpers in `src/lib/automation/site-registry.ts` for:
  - full matrix reads
  - per-site lookup
  - runnable/non-runnable gating
- Performed a live FastPeopleSearch verification check with Playwright on `2026-03-13`
- Updated support metadata and docs to reflect the real live-verification result:
  - FastPeopleSearch is currently `partial`, not fully `supported`, in this environment

Result:

- Workflow orchestration no longer owns automation handoff-shaping logic directly
- Support-matrix metadata is now reusable by backend scheduling or UI gating code
- Live verification status is explicit and consistent across code and docs instead of being implied

Verification:

- `npm run playwright:smoke` passed
- `npm test` passed with 18 test files and 128 total tests

- Coordinate backend storage and endpoint implementation
  - map current schemas to FastAPI endpoints and persistence models
  - confirm what the backend will store for auditability and evaluation
