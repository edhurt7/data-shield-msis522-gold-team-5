# Web Automation Role

## Scope

The automation layer owns browser-side execution after the agent workflow has already produced a validated `ActionHandoff`.

This layer now includes a generic Playwright runner, site adapters, failure classification, and workflow integration. It remains intentionally narrow: orchestration decides whether a site should run, while automation attempts execution safely and returns evidence-rich results.

## Inputs

Primary external input:

- `ActionHandoff` from [src/lib/agent/contracts.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/agent/contracts.ts)

Important reused contract fields:

- `payload.siteId`
- `payload.submissionChannel`
- `payload.fields`
- `payload.steps`
- `payload.draft`
- `mode`
- `requiresUserApproval`
- `reviewReasons`

Internal runner options:

- site registry
- clock injection for deterministic tests
- browser injection for deterministic tests

## Outputs

Contract-facing output:

- `ExecutionResult`

Internal automation output:

- execution evidence bundle
- automation failure code
- structured review reasons
- step outcomes
- artifact references for logs, screenshots, and future HTML/text captures

The runner returns both so the existing system can keep consuming `ExecutionResult` while the automation layer preserves richer audit data for storage and debugging.

## Support Matrix

| Site | Status | Verified | Notes |
| --- | --- | --- | --- |
| FastPeopleSearch | `partial` | 2026-03-13 | Adapter is implemented and workflow-integrated, but live verification in this environment hit an anti-bot “Just a moment...” page and did not expose the expected selectors. |
| Spokeo | `partial` | Not verified | Adapter is implemented and fixture-covered for the listing-URL plus privacy-email flow, but live selectors have not been re-validated. |
| WhitePages | `partial` | Not verified | Adapter is implemented and fixture-covered for the suppression-request flow, but live selectors have not been re-validated. |
| TruePeopleSearch | `partial` | Not verified | Adapter is implemented and fixture-covered for the search-select-submit flow, but live selectors have not been re-validated. |
| Radaris | `partial` | Not verified | Adapter is implemented for the email-backed submission path; it serializes the outbound email payload, but transport delivery is still harness-only. |
| UnknownBroker | `blocked` | Not verified | No validated procedure or adapter. |

## Stop Conditions

The runner must stop without browser execution when any of the following are true:

- `handoff.mode !== "auto"`
- `handoff.requiresUserApproval === true`
- `handoff.reviewReasons.length > 0`
- no site executor is registered for the requested site
- the site executor raises a known manual-review error

Known failure classes:

- `captcha`
- `rate_limited`
- `selector_missing`
- `site_changed`
- `timeout`
- `manual_review_required`

Unknown errors fail closed as `failed` or escalate to `manual_required`, depending on whether the error is classifiable.

## Generic vs Site-Specific

Generic responsibilities:

- validate and parse the handoff
- decide whether automation is allowed to start
- resolve a site executor from the registry
- translate known execution errors into contract-safe results
- attach evidence metadata common to every site

Site-specific responsibilities:

- browser navigation details
- selectors
- field mapping
- anti-bot detection specifics
- confirmation-page interpretation
- site-specific artifacts
- site verification dates and known issues
- email-payload serialization for non-browser submission channels such as Radaris

## Backend Persistence

The backend should persist, at minimum, the contract-facing execution fields from `ExecutionResult`:

- `status`
- `confirmation_text`
- `screenshot_ref`
- `error_text`
- `ticket_ids`

Recommended additional persistence from the automation evidence envelope:

- handoff ID
- executor ID
- failure code
- structured review reasons
- step outcomes
- artifact metadata and refs
- execution start and completion timestamps

Persisting both the contract result and evidence envelope keeps the workflow/UI path simple while preserving auditability and debugging detail for later review.

## Live Verification

Current live verification status:

- `npm run playwright:smoke` confirms Playwright can launch Chromium locally
- FastPeopleSearch live verification on `2026-03-13` reached `https://www.fastpeoplesearch.com/removal`
- The page title was `Just a moment...`
- The encoded adapter selectors were not present in that session

Implication:

- The FastPeopleSearch adapter is implementation-complete but should be treated as `partial` support until the anti-bot gate is resolved or the live flow is re-verified under production-like conditions

## Current Files

- [src/lib/automation/types.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/types.ts)
- [src/lib/automation/runner.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/runner.ts)
- [src/lib/automation/site-registry.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/site-registry.ts)
- [src/lib/automation/demo-harness.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/demo-harness.ts)
- [src/lib/automation/sites/fastpeoplesearch.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/fastpeoplesearch.ts)
- [src/lib/automation/sites/spokeo.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/spokeo.ts)
- [src/lib/automation/sites/whitepages.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/whitepages.ts)
- [src/lib/automation/sites/truepeoplesearch.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/truepeoplesearch.ts)
- [src/lib/automation/sites/radaris.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/radaris.ts)
- [src/lib/automation/sites/site-adapter.template.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/site-adapter.template.ts)
- [src/lib/automation/artifacts.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/artifacts.ts)
- [src/lib/automation/errors.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/errors.ts)

## Notes

When adding a new broker adapter:

- start from [site-adapter.template.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/sites/site-adapter.template.ts)
- register the site and support status in [site-registry.ts](/C:/dev/github/data-shield-msis522-gold-team-5/src/lib/automation/site-registry.ts)
- record `verifiedAt` and `knownIssues`
- add a fixture-backed site test before enabling the adapter as `supported`
