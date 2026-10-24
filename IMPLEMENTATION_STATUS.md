# Local implementation status — October 24, 2026

## Feature expansion (current release)

- [x] All six features implemented in the local and Supabase paths: stable shuffling, question analysis, resumable private drafts, QR lobby, whole-quiz timer, and session-end-only feedback.
- [x] Migration 003 preserves an existing active self-paced game and accepted answer; legacy teacher/self regressions pass.
- [x] All 24 self-paced configurations and four teacher shuffle configurations checked in local engines and PostgreSQL.
- [x] Draft owner isolation, stale revisions, incomplete validation, import acknowledgements, repeated publishing, changed/deleted source handling, strict privacy, timer expiry between questions, and canonical review checked.
- [x] 50 students × 100 shuffled questions checked locally; 50 overall expirations in a 100-question SQL session checked.
- [x] Existing 50-player HTTP verification, both original self-paced HTTP checks, and expansion HTTP checks pass against isolated local data.
- [x] TypeScript and Supabase-mode production build pass.
- [ ] Visual/browser/phone checks: browser automation unavailable because local browser use is disabled in Work settings.
- [ ] User applies migration 003, pushes the reviewed changes, verifies Vercel deployment, and rehearses on real classroom devices/network.

See [EXPANSION_UPGRADE.md](EXPANSION_UPGRADE.md). Older sections below are historical milestone records; their rollout checkboxes have not been revalidated against production in this task.

## Bulk quiz import

- [x] Browser-only Word and Excel extraction, bounded ZIP/XML parsing, and explicit unsupported-file errors.
- [x] Import preview with editable prompts, choices, correct answers, timers, explanations, question removal, and one-action quiz save.
- [x] Review gates for ambiguous keys, correction notes, placeholder choices, formula rows, and possible duplicates.
- [x] Supplied Word document extracts 80 questions, with source-review flags on questions 7, 50, and 60.
- [x] Six parser tests cover Word formatting/notes/tables/line breaks and Excel strings/headers/formulas, plus invalid and oversized inputs.
- [ ] New import UI deployed through GitHub/Vercel and verified on production.

No additional SQL migration is required. Original source files and answer keys are not added to the repository or uploaded during extraction. The teacher reviews the data before invoking the existing authorized quiz-save operation.

## Self-paced upgrade

- [x] Session setup with teacher-paced/self-paced selection and per-question/end-of-attempt feedback.
- [x] Independent student question state, authoritative deadlines, locked submissions, and Next/Finish controls in both local and cloud code.
- [x] Teacher progress dashboard, automatic completion, early session closure, full personal reviews, final rankings, and CSV compatibility.
- [x] Incremental migration 002 preserves existing quizzes, teacher sessions, access policies, and the Cron command.
- [x] Database capability check blocks self-paced hosting before the upgrade is installed.
- [x] Thirteen automated tests pass, including both migrations, teacher-mode regression, self-paced privacy, independent progress, timeout, early finishing, and 50-member self-paced closure.
- [x] Local self-paced HTTP checks pass for both feedback options, including progression, hidden score/key before finish, personal review, early closure, and CSV.
- [x] Browser check covers mode selection, self-paced lobby, teacher progress, student timeout, independent Next, Finish, and final answer review.
- [x] Supabase-mode production build passes during implementation.
- [ ] User applies migration 002 to the hosted project and rehearses both feedback options there.
- [ ] Updated commit pushed and Vercel deployment verified.

See SELF_PACED_UPGRADE.md for the exact upgrade sequence. These implementation checks do not claim the hosted migration or rollout has already happened.

## Completed local milestone

- [x] Next.js / TypeScript project with dependency lockfile and ignore rules.
- [x] Responsive landing page, admin sign-in, dashboard, editor, lobby, gameplay, and results screens.
- [x] Local password-protected admin session and secure server-only answer evaluation.
- [x] Quiz creation, editing, duplicate/delete, question ordering, validation, preview, timers, explanations.
- [x] Persistent room snapshots, unique names, guest sessions, lobby removal, and room capacity limit.
- [x] Server-enforced deadlines, one accepted answer, retry safety, lock, reveal, and manual advancement.
- [x] Private answer receipts, correct/wrong display, zero for unanswered questions, and revealed-score updates.
- [x] Shared competition ranks, saved room history, incomplete-game reporting, and CSV export.
- [x] Browser refresh recovery, reconnect polling, and stale-revision protection.
- [x] Nine engine tests passed, including a 50-player scoring scenario and preservation of revealed scores after cancellation.
- [x] Production build and TypeScript check passed during development.
- [x] HTTP integration test passed with 50 independent player credentials, concurrent submissions, deadline rejection, permission checks, answer-key privacy, final ranks, and CSV.
- [x] Browser verification: landing page, admin login, host lobby, separate student join, shared question, student submission, host locking/reveal, correct highlight, and score update.
- [x] Mobile answer-reveal layout checked at a 390-pixel viewport; desktop and mobile preview images saved beside the project.

The automated 50-session HTTP check runs on this computer. It is not proof of Supabase free-tier capacity or classroom Wi-Fi performance.

## Deliberately deferred to cloud integration

- [x] Supabase SQL migration and atomic game operations written and tested locally against PostgreSQL.
- [x] Teacher and anonymous player Auth integration, RLS/no direct table access, membership-authorized private Realtime policy implemented.
- [x] Private Realtime transport with reconnect snapshots, deadline refresh, event coalescing, fallback reads, and backoff implemented.
- [x] Cron setup SQL and database-time expiration function implemented; expiration function tested locally.
- [x] Read-only project connectivity check passed with configured publishable credentials.
- [ ] User runs migration/timer SQL and configures hosted Auth, teacher access, and private Realtime.
- [ ] Hosted Auth, private-channel delivery, and autonomous Cron verified in the real project.
- [ ] Local app switched to Supabase mode after setup succeeds.
- [ ] Image uploads and Storage policies.
- [ ] Incomplete draft saving, retention, rate limits, advanced presence, and production hardening.
- [ ] Vercel configuration and hosted deployment.
- [ ] GitHub remote setup and push after local review.
- [ ] Full cloud and classroom-network rehearsal with 50 students.

See README.md for run instructions and local adapter limits. The original implementation plan remains the complete release checklist; this milestone does not mark the production phases complete.

## Supabase implementation details

Private relational tables store teacher allowlists, quiz documents, rooms, memberships, and per-player submissions. Quiz questions/choices and immutable room snapshots use JSONB for the current fixed question type. Unique answer keys, room-row locks, owner checks, revision preconditions, and database-time checks enforce gameplay. Repeated answer retries return the first accepted answer; repeated admin transitions fail stale revision checks rather than advancing twice. Future high-volume or per-question analytics may warrant normalizing quiz documents further.

Auth and Realtime service interfaces are mocked only in the embedded PostgreSQL test. This verifies SQL execution/authorization logic, not the provider's JWT validation, actual WebSocket authorization, Cron extension scheduling, or production load. Anonymous sign-in limits on shared classroom Wi-Fi must be configured and rehearsed.
