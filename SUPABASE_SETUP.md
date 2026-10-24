# Supabase setup — follow in this order

The integration code is ready for configuration. Running the application in local mode still uses `.local/database.json`. Supabase mode uses a separate database; local quizzes and results do not transfer automatically.

No service-role key or database password is required by this application. Only the Supabase URL and publishable key are used in the browser. PostgreSQL verifies each signed identity and authorizes every action.

## 1. Install the database

1. Open your Supabase project.
2. Open **SQL Editor** in the left sidebar.
3. Click **New query**.
4. Open `supabase/migrations/202610240001_classroom.sql` in this project.
5. Copy the entire file, including `begin;` and `commit;`, into the SQL editor.
6. Click **Run**. You should receive a success result.
7. If an error appears, stop and share the error text. Do not run fragments or drop tables to work around it.

Run the initial migration once. It is transactional: a failure rolls the installation back. A second run after success will report existing objects; do not reset the database. Future changes should use new migrations.

Tables live in the unexposed `classroom_private` schema with RLS and no client table grants. Do **not** add this schema to the exposed Data API schemas and do not disable RLS. The app uses the narrowly authorized public `classroom_request` RPC instead. You can inspect private tables in SQL Editor; their absence from the default public-table view is expected.

## 2. Enable automatic timer closure

1. Open another SQL Editor query.
2. Paste `supabase/setup/02_enable_timer.sql` in full.
3. Run it.
4. If Supabase requests enabling `pg_cron`, open Database Extensions or the Cron integration, enable that extension, then rerun this setup file.
5. Verify the job using:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'classroom-expire-questions';
```

Expect one active job with a one-second interval. This setup file may be rerun; it replaces only this app's named job. The job calls an owner-only function, not a publicly executable endpoint.

Answers always check database time. A scheduler delay cannot extend the answer deadline. Snapshot requests also reconcile overdue questions, so the admin can still reveal an expired question if the job is delayed. Test autonomous closure through the actual hosted Cron service before classroom release.

## 3. Enable student guest sign-in

1. Open **Authentication**.
2. Find the sign-in providers/settings and enable **Anonymous Sign-Ins**.
3. Keep email/password sign-in enabled for the teacher account.
4. Open **Authentication → Rate Limits**.
5. Check the anonymous sign-in limit. Supabase's documented default is 30 per IP per hour, which is insufficient for 50 new students behind one classroom Wi-Fi address.
6. Set a bounded limit suitable for the rehearsal, for example 100 anonymous sign-ins per IP per hour if your project's controls allow it, then verify 50 joins on the actual classroom network. Extra fresh tabs consume new identities; retries reuse the same session.

Do not disable all rate limits. Public anonymous sign-in also needs an abuse-protection decision before distributing the deployment widely. CAPTCHA is not wired into this milestone: if your project requires CAPTCHA tokens, sign-ins will fail until that integration is added. Keep public rollout pending that decision rather than disabling an existing protection.

Reference: [Anonymous sign-ins and limits](https://supabase.com/docs/guides/auth/auth-anonymous), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## 4. Create your teacher account

1. Open **Authentication → Users**.
2. Use **Add user → Create new user** (wording may vary).
3. Enter your own teacher email and a strong password. Keep the password private.
4. Confirm the email through the supported dashboard option or the delivered confirmation flow.
5. Open `supabase/setup/03_authorize_teacher.sql` locally.
6. In a new SQL Editor query, paste that file and replace `REPLACE_WITH_YOUR_TEACHER_EMAIL` with your exact account email.
7. Run the query. It grants teacher access to that existing non-anonymous account only.

Creating an Auth user alone does not grant administrator access. There is no public admin-registration page. A student cannot become a teacher by changing browser state or user metadata.

## 5. Configure private live channels

1. Open the project's **Realtime settings**.
2. Disable **Allow public access** if present, so client channels must be private.
3. The migration already creates the room membership SELECT policy on `realtime.messages`. Do not add a broad allow-everyone policy or a browser INSERT policy.
4. Do not add private quiz/answer tables to a public database-changes subscription. Their contents must stay private.

Each committed game/roster change sends a revision number. Students fetch their own filtered snapshot after receiving it. Answer submissions notify the host channel only, avoiding a 50-by-50 burst of student refreshes for each class question. Reconnects and periodic fallback reads recover missed events.

Reference: [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

## 6. Activate Supabase mode locally

Your `.env.local` already has the project URL and publishable key. Add or change this line:

```env
NEXT_PUBLIC_BACKEND=supabase
```

Keep the existing URL/key lines. Do not put the database password or a secret/service-role key in this file's public variables. Never commit `.env.local`.

1. Stop the running local server with **Ctrl+C** in its terminal.
2. Run `npm run check:supabase` for a read-only connection check.
3. Run `npm run dev` again.
4. Refresh `http://localhost:3000`.
5. Confirm the header says **LIVE CLASSROOM**.
6. Click **Host a session**, then sign in with the teacher email and password from Step 4.

The old local password no longer works in Supabase mode. The local filesystem API is disabled in Supabase mode and on Vercel. Existing local data stays on disk, separate from cloud data.

To return to local mode, set `NEXT_PUBLIC_BACKEND=local`, restart, and refresh. Local and cloud guest sessions are stored separately.

## 7. Test one complete cloud game

- [ ] Teacher can sign in and create a quiz. Cloud starts with an empty quiz collection.
- [ ] Saved quiz survives refresh and a server restart.
- [ ] Host creates a room and sees a room code.
- [ ] A student on a separate device/browser joins with name and code only.
- [ ] Header connection label becomes **Live connection** when private Realtime succeeds.
- [ ] Teacher sees the student in the lobby.
- [ ] Start shows the same question and deadline on both screens.
- [ ] Correct answer and explanation are absent from student network responses until reveal.
- [ ] Submitting twice preserves the first accepted choice.
- [ ] At the deadline, unsubmitted answers lock and score zero.
- [ ] Reveal highlights correct/wrong choices and updates scores.
- [ ] Only the teacher can advance; the final question offers final results.
- [ ] Shared scores produce shared ranks, and CSV agrees with the game.
- [ ] Student refresh/reconnect restores the same identity within that tab.
- [ ] A different student cannot read another room or send host commands.
- [ ] Editing a quiz does not change a game already hosted from it.
- [ ] The actual Cron job closes a question with all game pages closed.

Teacher Auth persists per tab using sessionStorage. A fresh browser tab can represent a separate student without sharing the teacher session. Browser tab duplication may copy sessionStorage: open a fresh tab or a separate browser profile/device when testing different identities. Closing the tab, clearing storage, or signing out may lose an anonymous identity; do not promise cross-device recovery.

If testing students on your phone while the website is still local, use the computer's LAN URL, not `localhost`, and copy the join link from a host page using that LAN URL. Both devices require access to Supabase over the internet.

## 8. Push and deploy after cloud testing

Run the automated checks first:

```powershell
npm test
npm run typecheck
npm run build
git status --short
git add .
git commit -m "Integrate Supabase authentication, database and live gameplay"
git push origin main
```

Check that `.env.local` and `.local/` remain ignored before committing. The SQL files contain no credentials and should be committed. Do not commit edits containing a private teacher password.

In Vercel:

1. Import `Zion-jm/classroom-live` and select Next.js.
2. Use the repository root; the app is already at its root.
3. Add these three environment variables:
   - `NEXT_PUBLIC_BACKEND=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL` = your project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = your publishable key
4. Deploy. Environment changes require a new build/deployment.
5. Set Supabase Auth's Site URL to the deployed HTTPS address. Add only the development/production redirect URLs actually needed for later email recovery flows.
6. Verify the local API returns 404 on the deployment and teacher login uses email/password.
7. Test the full game on the deployment, then perform the 50-student classroom rehearsal.

Do not treat the embedded PostgreSQL test as a hosted load test. It executes the migration and game rules against a local PostgreSQL engine with simulated Auth/Realtime interfaces; hosted Auth configuration, private channel policy behavior, Cron delivery, and internet latency still require the steps above.

## Troubleshooting

| Symptom | Check |
|---|---|
| Database not installed / missing RPC | Run the complete main migration in the correct project |
| Invalid API key / failed fetch | Compare URL/key to the same Supabase project; check project is active |
| Anonymous sign-in disabled | Enable Anonymous Sign-Ins |
| Too many sign-ins | Check anonymous and token limits for shared classroom IPs; allow existing sessions to persist |
| Teacher account not authorized | Run Step 4's authorization query with the exact teacher email |
| Connected, checking updates | Check private channel settings, membership policy, WebSocket access, and network; fallback reads still work |
| Question locks only when a page is open | Verify Cron extension/job, function permissions, and job run errors |
| Still says LOCAL WORKSPACE | Set NEXT_PUBLIC_BACKEND, restart dev server, and refresh; rebuild on Vercel |
| Existing quizzes missing | Cloud and local databases are separate; recreate the quiz or use a reviewed import process |

## Backup and retention

Before relying on the free project for class records, export the private schema's quiz/room/player/answer data through an owner-controlled logical backup and test restoration. CSV is a results report, not a complete restorable backup. Plan retention and membership cleanup before deleting anonymous Auth users because player rows reference them. Automatic retention and image uploads are outside this integration milestone.
