# Self-paced quiz upgrade

## New behavior

Click **Host quiz** to choose a session mode. The same saved quiz works in both modes.

- **Teacher-paced:** existing shared question, teacher reveal, and teacher Next controls.
- **Self-paced:** shared lobby and one teacher Start, then students submit and click Next independently. Each question gets a personal server deadline. The next timer starts only when that student's next question opens.

Self-paced feedback options:

1. **After each question:** submission or expiry locks the question and reveals the correct answer, correctness, and explanation. Student clicks Next (or Finish on the last question).
2. **After finishing the quiz:** scores, correctness, explanations, and answer keys are omitted from student responses until their own attempt finishes. They then see their score and a full question-by-question review.

Early finishers can review while classmates are still answering. Class rankings remain hidden from students until everyone finishes or the teacher closes the session. Teachers can monitor individual question position, number submitted, and finished status. Closing early counts every remaining unanswered question as zero and produces final rankings.

Submitting and advancing are separate actions. A deadline locks an unanswered question but does not silently advance to the next one. Refresh/disconnection does not restart a timer. Modes and feedback settings are fixed at lobby creation.

## Apply to your existing Supabase project

1. Finish any ongoing classroom session before upgrading.
2. In Supabase open **SQL Editor → New query**.
3. Paste **all** of `supabase/migrations/202610240002_self_paced.sql` and click **Run**.
4. Expect **Success. No rows returned**. Run this migration once after success. It upgrades the existing installation in a transaction and preserves saved quizzes, rooms, teacher authorization, and answer records.
5. Do **not** rerun migration 001 or the initial teacher-authorization SQL.
6. No new environment variables or API keys are needed. The existing Cron job keeps calling the same expiration entry point; its implementation now handles both modes.
7. Test locally against Supabase before pushing/deploying. Select self-paced only after the migration succeeds. The client checks database capabilities to avoid silently creating a teacher-paced room against the old database.

For a brand-new Supabase project, run migrations 001 then 002, followed by the timer and teacher setup described in SUPABASE_SETUP.md.

## Rehearsal checklist

- [ ] Host an existing quiz in teacher-paced mode; original behavior still works.
- [ ] Host self-paced with feedback after each question and join with two students.
- [ ] Submit for one student. Only that student gets a reveal; the other keeps their own timer.
- [ ] Advance that student and verify the other stays on the previous question.
- [ ] Let a question time out; it locks and receives zero, with feedback appropriate to the setting.
- [ ] Refresh while answering and verify the original deadline remains.
- [ ] Finish one student early: personal score/review appears; class leaderboard stays hidden.
- [ ] Finish everyone: final rankings appear to all.
- [ ] Repeat with feedback after finishing. Inspect student responses before completion: no correct choice, explanation, score, full review, or leaderboard is exposed.
- [ ] Close a partially completed session from the teacher screen. All attempts end; unanswered questions receive zero; reviews and final ranks appear.
- [ ] Download CSV and compare scores and per-question outcomes.
- [ ] Verify the existing Cron job closes expired personal questions with no browser open.

## Deploy after hosted verification

```powershell
npm test
npm run typecheck
npm run build
git add .
git commit -m "Add self-paced quiz sessions and configurable answer feedback"
git push origin main
```

Vercel will build the pushed main branch if automatic deployment is enabled. No force push is needed. Confirm the deployment uses the new commit and run a short live rehearsal before class use.

## Implementation and verification limits

Migration 002 adds private per-player attempts and wraps the existing RPC with mode dispatch. Existing teacher-mode functions are retained privately and cannot be called directly by students. Writes acquire the room row before an attempt, preventing concurrent requests from advancing twice. Student Next requests include the active question ID; replaying a previous question cannot skip the next one. Server receipt time controls all cutoffs.

Realtime notifications still contain only revision metadata. Individual answers notify the teacher rather than every classmate. Session start/end updates notify the whole room; students also refresh their own deadline state and recover missed events with fallback reads.

Automated checks execute both SQL migrations against embedded PostgreSQL with simulated Supabase Auth/Realtime interfaces, plus local engine tests. They do not apply the migration to your hosted database, prove hosted Cron delivery, or replace the deployment/network rehearsal. Local mode also supports both session modes for offline backend development.
