# Classroom Live feature expansion implementation plan

Planning date: October 24, 2026. Target: one teacher and 40–50 students on the existing Next.js, Vercel, and Supabase application.

This document retains the original design and detailed acceptance checklist. Local implementation of all six features is now complete; see [EXPANSION_UPGRADE.md](EXPANSION_UPGRADE.md) and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified delivery status, bounded implementation choices, and remaining hosted/manual checks. Unchecked items below remain the original design checklist and are not a claim that the production rollout is complete.

## Implementation checkpoint

- [x] Saved question/choice orders and canonical grading in both engines and SQL.
- [x] Private question analysis, distributions, timing samples, and CSV.
- [x] Incomplete editor/import drafts, owner isolation, revisions, recovery, and transactional publishing.
- [x] Locally generated lobby QR and projector view.
- [x] Shared-start whole-quiz deadlines, including between-question expiration.
- [x] Session-end-only feedback across early finishing, closure, expiry, and cancellation.
- [x] Full 28-configuration local/SQL matrix, legacy active-session upgrade, and 50-player boundary checks.
- [ ] Hosted migration/deployment, real browser/phone QR checks, and classroom-network rehearsal.

The implementation uses room snapshot `sourceIndex` to recover original teacher quiz order, saved private room presentation arrays, and per-question opening timestamps for median accepted-answer response time. It does not add a full open/close event ledger, automatic draft retention, or draft-version history. Cloud drafts are separate per document; device recovery has one slot per teacher/project/workflow. These bounded choices are documented in the upgrade guide.

## 1. Features and priority

| Feature | Intended benefit | Delivery order |
|---|---|---|
| Stable question and choice shuffling | Reduce answer copying without corrupting scoring | After identity/mapping foundation |
| Question results dashboard | Identify topics the class needs to review | After canonical answer mapping |
| Resumable quiz and import drafts | Protect unfinished authoring and import reviews | Early, independently of gameplay changes |
| QR lobby join | Reduce typing on student phones | Early, independently of database changes |
| Whole-quiz timer | Let students manage one overall time budget | After attempt lifecycle changes |
| Reveal after the session ends | Prevent early finishers from seeing answer keys | Before new timer/shuffle combinations ship |

Recommended release sequence: drafts and QR; database foundation and strict feedback; shuffling; whole-quiz timing; analytics; combined release verification. A smaller release may ship drafts/QR first if their acceptance criteria pass independently.

## 2. Current implementation audit

The plan was checked against the current source and migrations 001 and 002, including the game engines, import preview, Supabase adapter, and self-paced UI.

| Existing behavior | Consequence for this work |
|---|---|
| Quizzes and immutable room quiz snapshots are JSONB documents | Keep the frozen room version authoritative; do not join results to the latest editable quiz |
| Quiz save generates new question IDs | A draft needs its own stable authoring IDs; active games must keep their snapshot IDs |
| Accepted answers store `question_index` and a numeric `choice` | Define these as canonical snapshot positions and translate shuffled displays before storing |
| Attempt has a current question index, status, and deadline | Separate student progress position from the canonical question index |
| Self-paced feedback currently supports `each` and `end` | Add an explicit `session_end` option without reinterpreting existing sessions |
| End-of-attempt feedback exposes a complete review when an individual finishes | Strict feedback must use the global session phase, not the individual finished flag |
| Local and cloud engines implement the same gameplay separately | Update both and run equivalent fixtures to prevent behavior drift |
| Snapshot reads reconcile overdue questions; Cron handles background closure | Both paths must enforce identical timer and feedback rules |
| Private Broadcast events contain only room revisions | Preserve this; avoid broadcasting draft content, answers, or per-student mappings |
| Host/player clients use snapshots, subscriptions, and fallback reads | Each snapshot must consistently describe the same effective settings and mapping |
| Import preview exists only in component state | Persist review flags, source labels, edits, and incomplete values explicitly |
| Current save requires a complete playable quiz | Draft persistence needs separate validation and cannot silently loosen publish/host validation |
| Quiz deletion is currently direct deletion | Draft references must survive or detach safely; never cascade-delete active room snapshots |
| Class starts from a shared lobby; late joins are rejected | Keep this policy; new timing/shuffle options do not introduce late enrollment |
| No durable per-question open/close history exists for all paths | Analytics timing must begin with new records; do not invent historical timing |

Audit limits: source review establishes the present implementation structure. It does not verify current hosted migrations, provider quotas, deployment revision, or classroom Wi-Fi capacity. This planning task does not change production data or run a load test.

## 3. Product behavior matrix

### Mode compatibility

| Setting | Teacher-paced | Self-paced |
|---|---|---|
| Question shuffle | One shared shuffled sequence for the whole room | Independent saved sequence per student |
| Choice shuffle | Optional saved order per student; teacher uses canonical labels | Optional saved order per student |
| Question timer | Existing behavior | Existing independent behavior |
| Whole-quiz timer | Unavailable in this release | Optional replacement for per-question timers |
| Answer reveal | Existing teacher-controlled reveal | After each question; after individual finish; after whole session ends |
| QR join | Available in lobby | Available in lobby |
| Results dashboard | Available to owning teacher | Available to owning teacher |

Defaults: both shuffle settings off; question timers selected; teacher mode unchanged; self-paced retains the currently selected/default feedback behavior. New settings apply only to newly hosted rooms and become immutable when the room is created. Do not silently change an old room's settings after deployment.

### Decisions to confirm before dependent implementation

- [ ] Confirm all six additions are in the release scope.
- [ ] Confirm teacher-paced question shuffle uses one shared order, preserving the shared-question experience.
- [ ] Confirm choice shuffling may give teacher and student different letter labels; reveal by answer text and mapped choice, not a class-wide letter.
- [ ] Confirm whole-quiz duration defaults to 20 minutes, with allowed values 1–180 whole minutes.
- [ ] Confirm whole-quiz timing starts at the teacher's shared Start, not on each student's first interaction.
- [ ] Confirm whole-quiz deadline includes reading, feedback, and time between questions; no pause is introduced.
- [ ] Confirm whole-quiz mode keeps forward-only navigation and locks submitted answers; previous-question editing is outside this scope.
- [ ] Confirm saved drafts are private to their owning teacher and source documents are not uploaded or retained.
- [ ] Confirm teacher analytics can show live counts, but detailed question analysis defaults to completed sessions.

These are recommended bounded defaults, not user-confirmed requirements. Prepare code-independent designs and data contracts while resolving any changed choices.

## 4. Foundation: canonical identity and display mapping

### Representation

- Canonical question index: position in the immutable room quiz snapshot, retained for existing answer rows and exports.
- Canonical question ID: snapshot question UUID, supplied with every submission.
- Presentation position: the student's current step, e.g. step 4 of 10. It is not an answer-table question index.
- Question order: saved permutation of all canonical indexes, with each appearing exactly once.
- Choice order: saved permutation of canonical choice indexes for one question and student.
- Display labels A–F: derived from presentation order; never used as a grading key.

Recommended wire contract: each visible choice is `{ id, text }`, with a stable opaque choice ID referring to its canonical choice inside the room snapshot. The browser sends the selected choice ID. The server verifies it belongs to the current canonical question and stores the canonical index. This is cleaner than trusting a submitted displayed position. Existing clients sending numeric `choice` require an explicitly versioned legacy path that is allowed only for legacy rooms without shuffling.

- [ ] Choose one canonical mapping helper used by snapshot, answer, reveal, review, analytics, and CSV code.
- [ ] Store generated permutations once in private database records; never regenerate on refresh or reconnect.
- [ ] Generate permutations on the trusted side using a documented unbiased shuffle; generate local equivalents for tests.
- [ ] Validate permutation length, range, uniqueness, and completeness when creating a room/attempt.
- [ ] Do not rely on a client-supplied shuffle seed or client-generated order for grading.
- [ ] Resolve current presentation position to canonical question before answer authorization.
- [ ] Validate submitted question ID and choice ID together.
- [ ] Preserve one accepted answer per room/player/canonical question.
- [ ] Ensure reviewing earlier completed questions cannot submit or replace answers.
- [ ] Never send future question content or answer-key mappings before they are eligible.
- [ ] Keep shuffling out of the editable quiz itself; two rooms may use different settings on the same quiz.

## 5. Proposed data changes

Exact migration names should follow the latest applied schema version. Do not edit or rerun released migrations 001/002.

| Record | Proposed addition | Purpose |
|---|---|---|
| Room state | `settingsVersion`, `shuffleQuestions`, `shuffleChoices`, `timerMode`, `quizDurationSeconds`, `feedback` | Freeze effective hosting settings |
| Room state/private record | Shared canonical question order for teacher-paced rooms | Preserve one common active question |
| Attempt/private presentation record | Per-student question order and per-question choice order | Stable independent display |
| Attempt | Explicit presentation position, `started_at`, `overall_deadline`, `finished_at`, `finish_reason` | Separate progress, timing, and completion |
| Question exposure | Room/player/question, opened/closed timestamps, close reason | Accurate exposure, timeout, and latency analysis |
| Accepted answer | Optional stable canonical choice ID and contract version; retain legacy indexes | Versioned mapping without corrupting history |
| Draft | UUID, owner, source quiz ID if any, kind, payload, payload version, revision, updated time | Private resumable incomplete work |
| Draft promotion receipt | Owner/draft/revision/request ID → resulting quiz ID/version | Safe retry after lost save response |
| Editable quiz | Explicit revision/version counter, initialized for existing rows | Detect edits made after a draft was opened; timestamps alone are not reliable concurrency tokens |

Recommended `finish_reason`: `student_finished`, `overall_timeout`, `teacher_closed`. Keep cancellation distinct from normal completed results. Recommended question close reason: `submitted`, `question_timeout`, `overall_timeout`, `teacher_closed`.

- [ ] Backfill only identity mappings and default metadata for legacy records; do not infer missing timestamps.
- [ ] Preserve current deadline values in active legacy attempts.
- [ ] Add checks and indexes for owner draft listing, due overall deadlines, question exposures, and canonical result aggregation.
- [ ] Enable RLS and revoke direct browser access to all new private tables.
- [ ] Expose narrowly authorized draft and analytics RPC actions through the current API boundary.
- [ ] Keep function search paths fixed and permissions explicit.
- [ ] Extend database capabilities reporting with supported settings/contract versions.
- [ ] Block unsupported new settings against an old database with a clear update message.
- [ ] Test migration from a database containing old quizzes, unfinished games, finished games, and existing answers.

## 6. Phase A — Draft saving and recovery

**Outcome:** A teacher can stop writing or reviewing an import and continue safely later.

### Draft model and lifecycle

1. New authoring/import work receives a draft ID and stable draft question IDs.
2. Local recovery is updated as edits occur; cloud autosave follows a debounce when authenticated.
3. Dashboard lists drafts separately from playable quizzes.
4. Resume restores incomplete values, correct-answer selections, import issues/acknowledgements, and source labels.
5. Publish/save validates the complete quiz and promotes a specific draft revision transactionally.
6. Host is available only for valid published quizzes; incomplete drafts cannot host.

- [ ] Define draft payload schema and maximum serialized size before enabling autosave.
- [ ] Keep import review metadata in the draft, but exclude the original DOCX/XLSX bytes.
- [ ] Save on a debounce (initial target 1–2 seconds) with dirty-revision tracking; avoid saving every keystroke.
- [ ] Show `Saving`, `Saved`, `Offline—saved on this device`, and actionable save failure states.
- [ ] Save locally before relying on an asynchronous cloud request; handle storage denial/quota errors without claiming success.
- [ ] Scope local recovery by backend/project and authenticated teacher ID to prevent a different signed-in user seeing prior answer keys.
- [ ] Treat local recovery as teacher-sensitive data and provide explicit discard/cleanup behavior.
- [ ] Keep a draft revision precondition for cloud writes; reject stale updates from another tab.
- [ ] Preserve a newer local revision if an older save response arrives late.
- [ ] Offer conflict choices: reload cloud draft, save local copy as new draft, or explicitly replace after review. Do not silently merge answer keys.
- [ ] On reload, compare local and cloud versions and offer the recoverable newer work.
- [ ] Provide manual Save draft, Resume, Rename, and Discard controls.
- [ ] Confirm destructive discard; deleting a draft must not delete a published quiz or running room.
- [ ] Validate structure and bounds for incomplete drafts separately from playable quiz validation.
- [ ] Promote draft and mark its revision as published in one transaction, with an idempotency receipt.
- [ ] If a draft edits an existing quiz, validate ownership and source version before replacing it.
- [ ] If the source quiz was deleted or changed, offer Save as new rather than silently overwriting.
- [ ] Prevent navigating away from genuinely unsaved/unrecoverable edits; do not warn on every page exit after successful save.
- [ ] Mirror draft behavior in local mode and document local-only recovery limits.

**Acceptance gate:** recover an edited 80-question import with unchecked warnings after refresh; no wrong answer selection, warning acknowledgement, or text disappears. Verify a simulated failed promotion response cannot create two quizzes.

## 7. Phase B — QR lobby joining

**Outcome:** Students scan a QR code and reach the existing name-entry flow for the intended room.

- [ ] Add a maintained QR encoder as an explicit dependency; generate locally without a third-party QR service.
- [ ] Encode only the public join URL (`https://production-domain/?room=CODE`). Never encode session tokens, passwords, or keys.
- [ ] Derive the canonical production URL from validated configuration or current origin; avoid untrusted arbitrary redirect targets.
- [ ] Show QR, room code, and text link together in both mode lobbies.
- [ ] Include room-code text as an accessible alternative; QR alone is insufficient.
- [ ] Provide a large projector-friendly view with adequate contrast and quiet zone.
- [ ] Add optional QR image download only if needed; generated artwork contains no sensitive credentials.
- [ ] Explain that local `localhost` QR codes cannot reach the host computer from another device; offer the LAN address workflow.
- [ ] Keep existing room capacity, name validation, membership, and late-join rules unchanged.
- [ ] Show expired/started/invalid room errors through the existing join page.
- [ ] Verify real scanning on Android and iPhone, from a monitor and projected display, using Wi-Fi and mobile data on the deployed URL.
- [ ] Test URL encoding and existing query parameters; validate the extracted room code server-side.

**Acceptance gate:** phone scan reaches the correct room code with no typing; joining remains an explicit student action after entering a name.

## 8. Phase C — Strict feedback after the whole session

**Outcome:** An early finisher cannot retrieve correctness, scores, or answer keys until the global session completes.

### Three self-paced feedback settings

| Setting | During active question | After a question locks | After student finishes, class active | After session finishes |
|---|---|---|---|---|
| `each` | No key | Current question key/feedback | Own score and full review | Own review and final class ranks |
| `end` | No key | Recorded/timeout only | Own score and full review | Own review and final class ranks |
| `session_end` | No key | Recorded/timeout only | Completion receipt and waiting; no score/review | Own score/review and final class ranks |

Teachers retain authorized access to their room's answers/results. Students receive no other student's individual answers. A final leaderboard is intentionally class-visible when the session finishes.

- [ ] Extend setup UI with an explicit third choice and explain early-finisher behavior for all options.
- [ ] Preserve `end` as after-individual-finish for all existing rooms; never silently reinterpret it.
- [ ] Centralize `canRevealQuestion`, `canRevealScore`, `canReviewAttempt`, and `canViewLeaderboard` predicates.
- [ ] Apply predicates to snapshots, individual receipts, review routes, resume data, exports, and any future analytics endpoints.
- [ ] Use explicit null/omission for withheld values; do not send correctness disguised in alternate fields.
- [ ] Ensure progress lists, counts, ordering, or error messages do not expose hidden per-player scores.
- [ ] Broadcast only invalidation metadata and re-fetch filtered views on final closure.
- [ ] In the waiting view, show completion status and safe progress counts only.
- [ ] Auto-close when all attempts finish, or on teacher Close session; then reveal atomically.
- [ ] Cancellation must not release unearned future answer keys. Recommended: show cancellation receipt and preserve owner-only results; no student full review on cancellation.
- [ ] Test timeout completion and teacher closure through the same predicates.

**Acceptance gate:** inspect every student response before session finish, including early-finish retries: correct IDs, correctness, explanations, score, review, and leaderboard are absent/withheld. Final closure reveals them once eligible.

## 9. Phase D — Stable question and choice shuffling

**Outcome:** Independent display order reduces copying while every result refers to the original room snapshot question/choice.

### Hosting controls

- [ ] Add independent Shuffle questions and Shuffle choices switches with both off initially.
- [ ] Explain shared question order in teacher mode and individual order in self-paced mode.
- [ ] Display frozen settings in lobby and results metadata.
- [ ] Do not mutate existing room mappings or settings midgame.

### Server and local engine

- [ ] Generate one saved room question permutation for teacher-paced question shuffle.
- [ ] Generate each student's question permutation at shared Start for self-paced mode.
- [ ] Generate each student's choice permutation for each question once; store privately.
- [ ] Identity permutations represent unshuffled questions/choices and legacy rooms.
- [ ] Preserve separate presentation position and canonical question reference on attempts.
- [ ] Translate choice IDs to canonical choice index before storing/validating correctness.
- [ ] Return only the current mapped question and its displayed choices during answering.
- [ ] Reveal uses the student's displayed order, marking the correct text and their selected choice correctly.
- [ ] Teacher reveal shows canonical answer text and warns that student letter labels may differ.
- [ ] Personal full review follows that student's question/choice order, with canonical metadata retained server-side.
- [ ] Export columns and class analysis use canonical quiz order, regardless of student order.
- [ ] Duplicate question text or identical choice text remains distinguishable through stable IDs.
- [ ] Reject a choice from another question, another room, a stale question, or a forged mapping.
- [ ] Preserve retry behavior after a lost submission response; the first canonical answer wins.
- [ ] Ensure a repeated Next command with an old question ID cannot skip another question.
- [ ] Avoid sending private seeds/mappings that include the answer key; secrecy of question order itself is not an authorization boundary.

**Acceptance gate:** run shuffled fixtures with deliberately asymmetric keys and 2–6 choices. Every grade, highlight, review, and CSV must match the canonical expected result after refresh/reconnect. Tests must not require every random draw to differ; equal permutations can occur by chance.

## 10. Phase E — Whole-quiz timer for self-paced sessions

**Outcome:** A single authoritative countdown runs across the entire attempt and cannot be extended by delaying Next or refreshing.

### Rules

- `timerMode=question`: current behavior; a new deadline starts when the next question opens.
- `timerMode=quiz`: one overall deadline begins at shared teacher Start; per-question limits are inactive.
- A student may finish early. Unanswered/unvisited questions receive zero after overall expiry or teacher closure.
- The overall timer continues between questions, while viewing immediate feedback, during disconnection, and after refresh.
- No pause, backward navigation, answer editing, or individualized extra time is included in this release.
- At the exact deadline, new answer writes are rejected. A submission accepted before the cutoff remains accepted even if the response arrives late.

### Checklist

- [ ] Add timer-mode controls only for self-paced sessions; validate duration bounds server-side.
- [ ] Preserve individual question timer values in the quiz for later reuse; a room-wide setting merely overrides them.
- [ ] Compute overall deadline from database time once at Start.
- [ ] Persist overall deadline even when status is between questions.
- [ ] Separate displayed overall time from question progress and feedback status.
- [ ] In quiz mode, do not create or extend a deadline on Next.
- [ ] Reject both Answer and Next actions after overall cutoff; reconcile into finished state first.
- [ ] Finish expired attempts even if they are waiting on a feedback/Next screen.
- [ ] Run expiry logic from Cron, snapshots, and mutations using the same lifecycle helper.
- [ ] Capture effective timestamp after acquiring required locks; queued requests do not receive extra time.
- [ ] Resolve simultaneous submit/expiry/teacher-close actions transactionally with one accepted outcome.
- [ ] Record completion reason accurately and preserve already accepted answers.
- [ ] If all attempts finish through timeout, finish the session and apply feedback permissions atomically.
- [ ] Keep teacher-controlled early Close session consistent with whole-quiz expiry.
- [ ] Preserve room-before-attempt lock order and use bounded background batches to avoid blocking every room.
- [ ] Define a rejected-late-answer response that still lets the client restore terminal state even if the failed transaction rolls back reconciliation.
- [ ] Keep a delayed Cron job from extending eligibility: answer validation independently checks the overall deadline.
- [ ] Show a timeout completion message with the final unanswered count when eligible; strict feedback still hides score until session closure.

**Acceptance gate:** expire a student on an active question, between questions, and offline. All finish at the original deadline without further interaction. No browser clock change, replay, reconnect, or postponed Next extends the attempt.

## 11. Phase F — Question results dashboard

**Outcome:** The owning teacher can identify difficult questions and common wrong choices from accurate canonical results.

### Metrics and definitions

Freeze the eligible roster at Start under the existing no-late-joins policy. For each canonical question report:

- Eligible students: starting roster count.
- Reached: students for whom the question was opened; derive from exposure records for new sessions.
- Submitted: students with an accepted answer.
- Correct and incorrect: accepted answers graded against that room's immutable snapshot key.
- Unanswered at session end: eligible minus submitted, including both reached-but-no-answer and never-reached students.
- Correct rate: correct divided by eligible; show denominator in the UI.
- Accuracy among submissions: correct divided by submitted, or “No submissions” when zero.
- Choice distribution: counts by canonical answer text; unanswered is a separate category, not a choice.
- Response time, when recorded: accepted timestamp minus question-open timestamp for submitted answers only; excludes timeouts and unanswered. Label median/sample count and do not call it thinking time.

Before completion, “not yet answered” is not a final wrong-answer count. Completed and cancelled/incomplete sessions need distinct labels. For teacher-paced cancelled sessions, include only questions actually opened and clearly state coverage; do not rank unshown questions as failures. For normal self-paced closure, the full quiz denominator is intentional.

- [ ] Add owner-authorized `session_analysis` operation with bounds and no student access.
- [ ] Aggregate on the server using canonical question/choice mapping.
- [ ] Always use frozen room questions and key, even after editing/deleting the source quiz.
- [ ] Show room mode, feedback, timer setting, roster count, completion status, and date.
- [ ] Show summary score distribution and a sortable question table (question, correct rate, submitted, unanswered).
- [ ] Sort most-missed questions by a documented rate/count, with stable tie order.
- [ ] Add question detail with prompt, correct answer, distractor counts, and optional explanation.
- [ ] Display missing historical exposure/timing as “Unavailable for older sessions”; never assume zero seconds or never reached.
- [ ] Do not publish live analysis or score-ordered progress lists to students during strict feedback.
- [ ] Include downloadable question-summary CSV with safe escaping of formula-like cells.
- [ ] Validate aggregates against independent hand-calculated fixtures and existing player-result CSV.
- [ ] Index new exposure rows and measure aggregation on 50 students × 100 questions.
- [ ] Load results on demand rather than including detailed analytics in every gameplay snapshot.

**Acceptance gate:** correct + incorrect + unanswered equals eligible for each completed-session question; distractor counts sum to submitted; aggregate scores agree with the leaderboard across shuffled and unshuffled runs.

## 12. API and frontend integration checklist

### API contract

- [ ] Version new room settings and snapshot payloads; keep an explicit legacy decoder for old rooms.
- [ ] Add draft operations: list, load, save with expected revision, discard, promote with request ID.
- [ ] Add canonical question/choice submission identities; reject mixed ambiguous legacy/new payloads.
- [ ] Return safe settings summaries and progress position independently of canonical indexes.
- [ ] Include effective timer mode/deadline and whether question/score/review fields are currently revealable.
- [ ] Return final completion reason without leaking a key in error payloads.
- [ ] Extend capability checks beyond the current single `selfPaced` flag.
- [ ] Keep authorization server-side for all draft, host, analytics, and review operations.

### UI structure

- [ ] Extract setup, authoring, draft recovery, review, and results views into focused components rather than growing the existing single page indefinitely.
- [ ] Add typed settings/snapshot/draft interfaces and shared validation helpers.
- [ ] Include form labels, keyboard interaction, visible focus, mobile layouts, and reduced-motion support.
- [ ] Keep status announcements useful; do not announce every timer tick.
- [ ] Preserve local mode as a tested development adapter, not a production fallback on Vercel.
- [ ] Never fall back to permissive local admin authentication when cloud configuration fails.

## 13. Test plan and required scenarios

Existing engine, embedded PostgreSQL, parser, and HTTP tests remain regression gates. Add focused tests for actual behavior, not only implementation details.

| ID | Scenario | Required assertion |
|---|---|---|
| T01 | Shuffled teacher session | All students see the same canonical question, even with different choices |
| T02 | Shuffled self-paced session | Students can reach different questions; mappings remain valid |
| T03 | Refresh/reconnect | Order, selection receipt, deadlines, and score do not change |
| T04 | Canonical grading | Every mapped correct choice scores one; every mapped wrong choice scores zero |
| T05 | Forged IDs | Other room/question/choice IDs are rejected |
| T06 | Replay Next | A previous question command cannot skip the active question |
| T07 | Strict early finisher | No score, key, explanation, review, or class ranking is returned |
| T08 | Strict global completion | Eligible review/ranks appear on the same committed final state |
| T09 | Legacy `end` feedback | Existing individual-finish review semantics remain unchanged |
| T10 | Whole-quiz timeout while answering | Submission at/after deadline rejected; prior answers retained |
| T11 | Whole-quiz timeout between questions | Attempt finishes despite no open question timer |
| T12 | Offline expiry | Reconnect restores expired/finished state, not a fresh deadline |
| T13 | Cron delayed | Request cutoff still enforced; later reconciliation releases only eligible feedback |
| T14 | Last answer/timeout/close race | One consistent result, completion reason, and final ranking |
| T15 | Draft refresh | All incomplete edits and import review flags restored |
| T16 | Draft two-tab conflict | Stale revision cannot overwrite newer work |
| T17 | Draft offline/storage failure | Accurate status; no false Saved message; recoverable work retained where possible |
| T18 | Draft promotion retry | Same request/revision yields one saved quiz |
| T19 | Cross-owner draft/results access | Denied even when IDs are known |
| T20 | QR scan | Correct production room opens without leaking credentials |
| T21 | Analytics totals | Canonical counts, grades, percentages, and exports agree |
| T22 | Zero submissions | No divide-by-zero or misleading 0-second response time |
| T23 | Legacy analytics | Missing metrics labeled unavailable; old scores unchanged |
| T24 | Source quiz changed/deleted | Room keys, review, analysis, and leaderboard stay stable |
| T25 | Mixed 2–6 choice questions | No lost, duplicated, or out-of-range choices |
| T26 | Duplicate text | Stable IDs distinguish questions and choices correctly |
| T27 | Session cancellation | Incomplete reporting is explicit and strict future keys stay hidden |
| T28 | Local/cloud equivalence | Same fixed mappings/actions produce equal visible states and scores |
| T29 | Migration from populated database | Old history and active legacy games still function |
| T30 | Settings unsupported by database | Hosting blocked with clear migration guidance |

### Combination coverage

Self-paced has 3 feedback policies × 2 timer modes × 2 question-shuffle settings × 2 choice-shuffle settings = **24 configurations**. Run at least one complete deterministic database game in every configuration. Teacher-paced adds 4 shuffle combinations with the existing question timer and manual reveal behavior.

- [ ] Include at least two independently progressing students in self-paced fixtures.
- [ ] Include correct, incorrect, timed-out, never-reached, and early-closed outcomes.
- [ ] Test 1 and 100 questions, and 1 and 50 students, at relevant boundaries.
- [ ] Test timer duration minimum/maximum and exact deadline equality.
- [ ] Use explicit deterministic stored permutations in grading tests; separately verify production shuffle generation produces valid permutations.
- [ ] Test after a simulated worker restart and missed/out-of-order live notifications.
- [ ] Run a 50-student/100-question test for database contention, expiry, analytics, and payload size.
- [ ] Inspect actual hosted student network responses for hidden fields and verify private channel authorization.
- [ ] Rehearse on classroom phones/network; embedded PostgreSQL cannot verify hosted Auth, Realtime, Cron, or Wi-Fi.

## 14. Performance and cost controls

- [ ] Recheck current free quotas before rollout; this plan does not assume unlimited usage.
- [ ] Keep detailed question analysis and drafts out of live snapshot payloads.
- [ ] Coalesce host progress refreshes instead of broadcasting every answer to the whole class.
- [ ] Restrict per-student snapshots to current question/receipt and eligible review data.
- [ ] Bound draft size, autosave frequency, history retention, and number of saved recovery copies.
- [ ] Load question reviews on demand if 100-question payloads become too large; do not send future keys early to optimize latency.
- [ ] Benchmark final-response bursts when all 50 students finish or time out together.
- [ ] Use the current intended latency targets as goals: question/reveal/submission updates around one second and lobby/results around two seconds under documented normal conditions; report measurements, not guarantees.
- [ ] Verify no new paid service is required for QR or drafts; do not automatically upgrade accounts.

## 15. Migration and release sequence

1. Implement new schema/helpers with backward-compatible defaults and permissions.
2. Execute migrations against a populated local PostgreSQL fixture containing both legacy modes and historical records.
3. Run automated matrix tests and production build.
4. Prepare numbered incremental SQL and a concise upgrade guide, including verification queries and rollback limits.
5. During a break between classes, back up relevant production data and apply new migrations once in order.
6. Verify capabilities, privileges, Cron entry point, and legacy-room reads before enabling UI options.
7. Test locally against the upgraded hosted database using separate teacher/student identities.
8. Commit/push the reviewed code; allow Vercel to deploy the matching version.
9. Rehearse the deployed configuration on phones, then run the 50-player exercise.
10. Record accepted settings, measured limits, known constraints, and operating instructions.

- [ ] Do not modify a running session's snapshot, permutation, timer settings, or feedback policy during migration.
- [ ] Use additive schema changes first; avoid renaming/removing functions needed by the previous deployed client until compatibility is verified.
- [ ] Keep rollback capable of serving legacy rooms. Once new-format rooms exist, disabling new hosting is safer than dropping their tables/functions.
- [ ] Separate data migration rollback from frontend deployment rollback; document which version can read which settings.
- [ ] Prevent old clients from interpreting shuffled positions as canonical answers; use room settings/contract version checks server-side.
- [ ] Preserve secrets and student records outside Git. QR assets and public URLs must contain no tokens.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shuffle changes grades | Persist canonical mapping; verify asymmetric fixtures and exports |
| Teacher says “B” while student correct choice is “D” | Reveal answer text and explain individualized choice labels |
| Early finisher sees strict-mode key | Global reveal predicates shared by every response path |
| Whole timer pauses between questions | Persist independent overall deadline and expire every unfinished status |
| Autosave overwrites newer draft | Expected revisions, dirty sequence tracking, conflict UI |
| Draft exposes imported answer keys on shared machine | Owner-scoped storage and explicit cleanup; no student-readable draft API |
| Analytics confuses unanswered with wrong submissions | Separate denominators and reached/submitted/final unanswered categories |
| Old games break after upgrade | Default identity mappings, frozen snapshots, legacy contract tests |
| UI displays stale state after simultaneous finish | Transactional terminal transition, revisions, snapshot recovery |
| Timer worker overloads room locks | Consistent lock order, bounded due scans, request-level cutoff checks |

## 17. Definition of done

- [ ] All six features have clear documented behavior and confirmed product defaults.
- [ ] Old teacher-paced and self-paced sessions still work and retain their historical scores.
- [ ] Shuffling is stable across refresh/reconnect and canonical grades/reports are correct.
- [ ] Draft recovery restores incomplete authored/imported work without overwriting newer revisions.
- [ ] QR joins work on representative classroom phones.
- [ ] Whole-quiz timing is server-authoritative across every attempt status.
- [ ] Strict feedback withholds keys, scores, and reviews until global completion.
- [ ] Question analysis matches raw accepted answers and immutable room snapshots.
- [ ] All 28 mode/settings configurations pass their full-flow fixtures, plus security/race/boundary cases.
- [ ] Build, type checks, applicable tests, migration checks, and a real hosted rehearsal pass.
- [ ] Upgrade guide, feature instructions, backup/recovery notes, and known limitations are updated.
- [ ] Production rollout is verified separately from local implementation completion.

## 18. Plan review checklist

The following are planning checks completed by source inspection, not implementation tests:

- [x] Checked both released migrations and the current question-index/choice-index answer model.
- [x] Checked existing `each`/`end` feedback semantics and individual/full-session completion conditions.
- [x] Checked Cron and snapshot reconciliation entry points and the room-before-attempt lock convention.
- [x] Checked authoring/import component state and existing complete-quiz save validation.
- [x] Identified all six feature dependencies and incompatible timer/mode combinations.
- [x] Defined canonical versus displayed identity for grading, reveal, analytics, and exports.
- [x] Defined strict answer visibility, cancellation, shared start, deadline boundaries, and draft conflicts.
- [x] Defined denominators and unavailable historical timing instead of inventing metrics.
- [x] Included backward compatibility, incremental migration, rollback limits, and hosted verification.
- [x] Included explicit acceptance gates, a configuration matrix, and production-capacity limits.

No feature implementation, database update, GitHub push, or deployment was performed as part of preparing this plan.
