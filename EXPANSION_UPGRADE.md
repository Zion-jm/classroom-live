# Feature expansion: setup and verification

Implemented locally on October 24, 2026. This release adds all six features in FEATURE_EXPANSION_PLAN.md. Production rollout and phone/browser rehearsal remain separate steps.

## 1. Install the database update before deploying the new UI

For the existing project where migrations 001 and 002 are already installed:

1. Finish any running class, and retain a backup/export of important quizzes and results.
2. Open `supabase/migrations/202610240003_expansion.sql` in this repository.
3. Copy the **entire file** into a new Supabase SQL Editor query.
4. Run it once. Expect `Success. No rows returned`.
5. Do not rerun migrations 001 or 002. Do not run `expansion-prefix.sql` or `expansion-suffix.sql`: those are maintainer source fragments, already included in migration 003.
6. Verify installation with the queries below.

```sql
select to_regclass('classroom_private.drafts') as drafts,
       to_regclass('classroom_private.exposures') as exposures;

select has_function_privilege('authenticated',
  'public.classroom_request(jsonb)', 'execute') as rpc_allowed,
  has_table_privilege('authenticated',
  'classroom_private.drafts', 'select') as direct_drafts_allowed;
-- Expected: rpc_allowed = true, direct_drafts_allowed = false.

select jobname, schedule, command, active
from cron.job where jobname = 'classroom-expire-questions';
-- Existing active timer job still calls classroom_private.expire_questions().
```

Capabilities require a signed-in teacher/player session. In the application, new setting checks use `classroom_request({action:'capabilities'})` and expect `schemaVersion:3`, `expansion:true`, `drafts:true`.

Migration 003 runs inside a transaction, preserves existing quiz documents/room snapshots/answer rows, and leaves the Cron entry point unchanged. It adds quiz revisions, private draft and exposure tables, persisted presentations, and overall attempt deadlines. Historical timing/reach is not fabricated. Existing room settings retain their original meaning.

## 2. Update the application

No additional Supabase key, paid integration, QR service, or environment variable is required. Keep the current Vercel Supabase environment variables.

From the project folder:

```powershell
npm install
npm test
npm run typecheck
npm run build
git status
git add .
git commit -m "Add quiz shuffling, drafts, QR joins, overall timers and analysis"
git push origin main
```

Review `git status` before committing. `.env.local`, `.local/`, dependencies, and build artifacts are ignored. Vercel's connected repository deploys the pushed commit. After it succeeds, refresh teacher and student browsers; an old browser cannot submit numeric answers in a choice-shuffled room and receives a refresh message.

## 3. Use the new features

### Hosting settings

- **Shuffle questions:** teacher-paced rooms get one shared sequence; self-paced students get individual sequences. Orders are saved once at Start and remain stable on refresh/reconnect.
- **Shuffle choices:** students can receive different choice letters. Discuss the answer **text**, since teacher and student letters can differ. Submission, reveal, review, and reporting translate to canonical snapshot indexes.
- **Self-paced timer:** select per-question timing or one whole-quiz budget. Default is 20 minutes; whole minutes from 1 to 180 are allowed. The budget starts at the shared Start and continues while reading feedback, between questions, while offline, and with the tab closed. Submitted answers stay locked and navigation remains forward-only.
- **Feedback:** choose after each question, after an individual finishes, or after the **whole session ends**. The last option withholds scores, keys, explanations, and reviews from early finishers. Normal global completion, overall expiry, or teacher closure unlocks final results; cancellation does not unlock strict reviews.

### Drafts and recovery

- Authoring and import previews have **Save draft now** and a debounced autosave (1.5 seconds). Incomplete drafts cannot be hosted; Save quiz still validates every question.
- **Private drafts** on the dashboard provides Resume and Discard. Import drafts preserve parsed values, source labels, issue acknowledgements, timer defaults, and filename. The original file is never uploaded.
- Device recovery is scoped to the Supabase project, teacher account, and workflow. Reopening offers Recover as new draft or Discard device recovery. It never silently replaces newer cloud content.
- A cloud save failure leaves a visible status. Use Save draft now to retry; reconnecting or returning to the tab also retries. Conflicting revisions require reloading the cloud draft or saving a separate recovery draft.
- If the original published quiz changed or was deleted, use **Keep edits as a new quiz**, then Save quiz. Promotion is transactional and repeat requests for the same published draft revision return the same quiz ID.
- Device recovery is browser local storage, not encrypted storage. It retains one recovery slot for authoring and one for importing per teacher/project; use separate cloud drafts for multiple unfinished quizzes. Shared-machine users should discard unwanted recovery copies. Signing out does not delete recoverable work.

### QR join

The teacher lobby renders a QR locally, with a larger projector view and a normal join link. It contains only the site URL and public room code. Students still enter their names. A localhost QR cannot connect another phone to the host computer; use the deployed HTTPS URL (or a reachable LAN address for local testing).

### Question results

Open a session and choose **Question results**. Only its owning teacher can retrieve analysis. Counts use the frozen game questions and canonical accepted answers.

- Correct rate = correct / eligible roster; submission accuracy = correct / accepted submissions.
- Incorrect counts only wrong accepted submissions. Unanswered is final only after FINISHED; cancellation/active sessions show Not final.
- Reached counts question exposures. Median response time uses accepted answers with recorded opening times, including server/network delay; it is not pure thinking time.
- Missing legacy reach/timing is unavailable. Timing sample counts are explicit.
- Sort by most missed or original quiz order; expand for distribution and explanation; download the question summary CSV. Student results CSV keeps original quiz column order even when gameplay was shuffled.

## 4. Verification performed and remaining checks

Automated coverage includes all 24 self-paced configurations and four teacher shuffle configurations in both local engines and embedded PostgreSQL. Coverage includes two independent students, canonical scoring/review, private responses, stable refreshes, whole-timer expiry between questions, strict cancellation, draft ownership/conflicts/promotion, and migration of an already active session with an accepted answer. Boundary fixtures include 50 students completing 100 shuffled questions locally and 50 simultaneous overall expirations in a 100-question SQL session.

The 50-player local HTTP regression, both existing self-paced HTTP flows, and expansion HTTP checks passed against isolated test data. TypeScript and the Supabase-mode production build are checked separately. Embedded PostgreSQL mocks Auth, Realtime, and Cron interfaces; it cannot verify hosted JWTs, WebSocket delivery, scheduling, free-tier limits, or classroom mobile connectivity.

Browser automation was unavailable because local browser use is disabled in Work settings. Complete these manual checks after deployment:

- [ ] Create an incomplete quiz; wait for Draft saved; leave and Resume it.
- [ ] Edit/import, disconnect briefly, reconnect, and verify cloud/device recovery status.
- [ ] Open the same draft in two tabs; confirm stale saves cannot overwrite newer work.
- [ ] Scan QR on a phone; verify room prefill, name entry, and joining the correct lobby.
- [ ] Rehearse both original teacher-paced and new shuffled sessions with two real devices.
- [ ] Finish early under strict feedback; inspect responses to confirm no score, key, explanation, or review before the class ends.
- [ ] Set a one-minute whole-quiz timer; submit then wait between questions until expiry. Repeat with the student offline and reconnect.
- [ ] Compare question analysis and both CSV downloads to the accepted answers.
- [ ] Rehearse with the intended classroom network/mobile carriers and 40–50 students before relying on measured latency or capacity.

## 5. Rollback and maintenance

Prefer a corrective migration or disabling new hosting while fixing a defect. Do not drop migration-003 tables/functions once new rooms or drafts exist. Frontend rollback does not undo database/data changes; an older client does not understand strict feedback, overall timing, or shuffled choice IDs. Do not use an old frontend to continue new-format sessions. Finish/cancel those sessions with the matching new client before rollback; retain the upgraded database and saved records.

The generated SQL is checked in and deploys independently of Node. Maintainers editing the SQL source fragments or generation rules must run `node scripts/build-expansion-migration.mjs`, review the emitted SQL, and run the full test suite. Do not rewrite an already-applied migration; subsequent fixes need migration 004.

Draft retention/cleanup and large historical analytics pagination are not added in this release. Keep classroom data volume modest and clean up obsolete drafts intentionally. No production migration, Git push, or deployment was performed by this implementation task.
