# Classroom Live

A host-controlled classroom quiz application built with Next.js and TypeScript. It supports local file storage for development and Supabase PostgreSQL/Auth/Realtime for the cloud. Start with local mode, or follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) to configure cloud mode.

## Feature expansion (migration 003)

Session setup now includes saved question/choice shuffling, self-paced whole-quiz timing, and feedback withheld until the entire session ends. Teacher lobbies include QR joins; editors/import reviews save private resumable drafts; session Question results shows choice distributions and response-time summaries. Follow [EXPANSION_UPGRADE.md](EXPANSION_UPGRADE.md) **before deploying this version**: existing Supabase projects must apply migration 003 once. The guide covers usage, verification, rollout, and rollback limits. Local mode supports these features immediately.

## Bulk import

The teacher dashboard includes **Import quiz** for `.docx` and `.xlsx`. Preview all extracted questions, correct flagged source issues, set timers, and save everything as one new quiz. Parsing stays in the browser; only the reviewed quiz is saved. See [QUIZ_IMPORT.md](QUIZ_IMPORT.md) for supported layouts, Excel headers, and limits. No database migration or new environment variable is required.

## Session modes

**Host quiz** now opens session setup. Choose **Teacher-paced** for the original shared progression, or **Self-paced** for individual timers and student Next/Finish controls. Self-paced feedback can reveal after every question or after the student finishes all questions. Early finishers see their own review; class rankings wait for session completion. The teacher has a progress dashboard and can close remaining attempts early.

Existing Supabase installations must apply migration **002 once**, following [SELF_PACED_UPGRADE.md](SELF_PACED_UPGRADE.md). Do not rerun the original migration. Local mode supports both options immediately. The upgrade guide includes hosted verification and deployment commands.

## Supabase integration

The database migration, teacher allowlist setup, Cron timer setup, browser Auth, private live subscriptions, and fallback synchronization are implemented. The app stays in local mode until `NEXT_PUBLIC_BACKEND=supabase` is configured and the server is restarted. Follow the setup guide before changing this setting. Local quizzes do not transfer automatically.

Run `npm run check:supabase` for a read-only project connectivity check. `npm test` includes the main SQL migration executed against embedded PostgreSQL with simulated Supabase service interfaces. Actual hosted Auth, private Realtime, Cron, and classroom capacity still need verification after dashboard setup.

## Run locally

Requires Node.js 20.9 or newer and npm.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Click **Host a session** and sign in with `classroom-local`. To change the password, copy `.env.example` to `.env.local`, edit `LOCAL_ADMIN_PASSWORD`, and restart the server. The default credential is for local development only.

On Windows, after dependencies are installed, you can also double-click **Start Local Quiz.cmd**, keep that window open, and visit the address above.

For a production-mode local check:

```sh
npm test
npm run typecheck
npm run build
npm start
```

With the server already running, `npm run test:http` executes the 50-player API verification and creates a labeled QA quiz/session in local history. It never deletes existing quizzes or sessions.

## Try a complete game

1. Sign in as host. Use the sample quiz or create your own.
2. Click **Host quiz**. Copy the room code or join link.
3. Open another browser tab and join with the code and a student name.
4. Each tab has its own player session in sessionStorage. Avoid duplicating an already joined tab; open a fresh tab for a different student.
5. Start from the host screen. Students select a choice and explicitly submit.
6. Wait for expiry, or close early after everyone submits.
7. Reveal, discuss, and advance manually.
8. After the last reveal, show final rankings and download the CSV.

Other devices on the same trusted network can use `http://YOUR-COMPUTER-LAN-IP:3000` while the server is running, subject to Windows firewall permissions. `localhost` links only work on the host computer. Open the host screen through the LAN address before copying join links for phones. Clipboard copying may be unavailable on non-HTTPS LAN addresses; manually share the displayed code/address instead.

## Implemented local features

- Admin password and HTTP-only signed session cookie.
- Quiz creation/editing, copying, deletion, question reordering, 2–6 choices, timers, explanations, and preview.
- Room codes, join links, unique names, 50-player cap, participant list, and lobby removal.
- Immutable quiz snapshot per game.
- Timed questions, explicit submission, accepted-answer retry safety, locking, manual reveals and progression.
- Correct/wrong highlights, unanswered feedback, scores, shared final ranks, history, and CSV exports.
- Player refresh recovery and polling reconnects.
- Persistent local JSON storage excluded from Git.
- Server-side role checks, phase checks, answer-key filtering, deadline checks, and room revision protection.

## Local adapter limitations

- Local mode synchronization uses 750 ms polling. Supabase mode uses private Realtime notifications, snapshot recovery, and fallback reads. Neither mode's classroom capacity is guaranteed without a deployment/network rehearsal.
- Data lives in `.local/database.json`. This contains sensitive session credentials; do not commit or share it. Tests use separate in-memory fixtures.
- The filesystem adapter supports one Node server process. Do not run dev and production servers against the same data directory simultaneously.
- Expiration is reconciled on the next server request. A browser locks at its countdown deadline and the server always rejects late answers; a durable autonomous scheduler comes with Supabase.
- No rate-limiting service, password recovery, persistent upload storage, online presence tracking, or automated retention is configured yet.
- Images and incomplete quiz drafts remain in later milestones. Supabase authorization/migrations are now supplied; project installation and hosted verification remain pending.
- Local mode uses a password gate. Supabase mode uses email/password Auth and an owner-managed teacher allowlist; its local filesystem API is disabled.
- Browser sessions hold reconnect credentials. Clearing browser data creates a new session and cannot reclaim a taken player name.
- The free-tier 50-player target is not verified by the engine's 50-player test. A real network load test is still required.
- Google Fonts is an optional network enhancement; system fonts provide an offline fallback.

## Architecture

- `app/page.tsx`: responsive admin and student interface.
- `app/api/local/route.ts`: local HTTP commands and authorized snapshots.
- `lib/engine.mjs`: pure game rules, scoring, and role-safe snapshots.
- `lib/store.ts`: single-process local persistence; explicitly refuses to run on Vercel.
- `tests/engine.test.mjs`: timing, ranking, validation, privacy, and progression checks.

## Cloud rollout checklist

1. Run the supplied migration and timer setup in the user-owned Supabase project.
2. Enable anonymous Auth, review shared-IP rate limits, create the teacher account, and run its authorization SQL.
3. Configure private Realtime and activate Supabase mode as described in the setup guide.
4. Verify hosted identity, ownership, privacy, deadlines, event delivery, and reconnects locally against Supabase.
5. Decide public-sign-in abuse protection and retention/backup procedures before wider rollout.
6. Review/push code and deploy Vercel with the three documented environment variables.
7. Run the deployed 50-player classroom rehearsal before class use.
8. Add optional Storage uploads and draft persistence in a later feature milestone.

Do not deploy the local adapter to Vercel. Cloud mode calls database functions directly with authenticated user JWTs and requires no secret/service-role key. No dashboard migration, teacher creation, cloud deployment, or new GitHub push is performed automatically by these files.

## GitHub preparation

Source files and the dependency lockfile belong in Git. `.local/`, `.env.local`, `node_modules/`, and `.next/` do not. The repository URL and push will be handled after local review, as requested.
