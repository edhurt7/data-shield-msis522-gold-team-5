# Agent Policy Defaults

`src/lib/agent/contracts.ts` is the source of truth for the shared operating policy.

## Production defaults

- `match_confidence_threshold`: `0.75`
- `max_submission_retries`: `1`
- `require_explicit_consent`: `true`
- `minimize_pii`: `true`
- `require_retrieval_grounding`: `true`
- `low_confidence_match_strategy`: `block`
- `stale_procedure_strategy`: `block`
- `contradictory_procedure_strategy`: `block`
- `pending_confirmation_strategy`: `await_confirmation`
- `captcha_failure_strategy`: `request_user_review`
- `manual_requirement_strategy`: `request_user_review`

## Expected behavior

- Low-confidence matches are reviewed and block retrieval/drafting by default.
- Missing or ungrounded procedures block drafting by default.
- Stale and contradictory procedures escalate for review and block drafting by default.
- Pending confirmations stay pending and await confirmation by default.
- CAPTCHA or other manual-required execution outcomes escalate to user review by default.
- Failed submissions retry once by default, then escalate to review.
- Email drafts minimize PII by default and only include required facts unless a run override disables minimization.

## Overrides

- `policy_defaults` carries the shared baseline.
- `policy_overrides` carries per-run changes from backend, UI, or automation.
- `policy` is the resolved result the workflow actually uses after applying overrides on top of defaults.

This keeps one default operating policy while still allowing controlled per-run changes without changing workflow phases or core orchestration.
