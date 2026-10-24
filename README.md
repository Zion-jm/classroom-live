# Classroom Live

A locally runnable, host-controlled classroom quiz application built with Next.js and TypeScript. The production target is Vercel + Supabase; no accounts or hosted resources are required for this local milestone.

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

- Synchronization uses 750 ms polling, not Supabase Realtime. It is designed for local functional testing, not measured classroom capacity.
- Data lives in `.local/database.json`. This contains sensitive session credentials; do not commit or share it. Tests use separate in-memory fixtures.
- The filesystem adapter supports one Node server process. Do not run dev and production servers against the same data directory simultaneously.
- Expiration is reconciled on the next server request. A browser locks at its countdown deadline and the server always rejects late answers; a durable autonomous scheduler comes with Supabase.
- No rate-limiting service, password recovery, persistent upload storage, online presence tracking, or automated retention is configured yet.
- Images, incomplete quiz drafts, and production Supabase authorization/migrations remain in the next milestones.
- Administrator authentication is a local password gate; production will use Supabase Auth with explicit admin role authorization.
- Browser sessions hold reconnect credentials. Clearing browser data creates a new session and cannot reclaim a taken player name.
- The free-tier 50-player target is not verified by the engine's 50-player test. A real network load test is still required.
- Google Fonts is an optional network enhancement; system fonts provide an offline fallback.

## Architecture

- `app/page.tsx`: responsive admin and student interface.
- `app/api/local/route.ts`: local HTTP commands and authorized snapshots.
- `lib/engine.mjs`: pure game rules, scoring, and role-safe snapshots.
- `lib/store.ts`: single-process local persistence; explicitly refuses to run on Vercel.
- `tests/engine.test.mjs`: timing, ranking, validation, privacy, and progression checks.

## Next milestone: Supabase and Vercel

1. Provision the user-owned Supabase project and Vercel application.
2. Introduce SQL migrations for quizzes, questions, choices, rooms, player memberships, answers, and command IDs.
3. Replace local transactions with atomic PostgreSQL functions enforcing authorization, revisions, and database-time deadlines.
4. Replace the local password with Supabase admin Auth and player tokens with anonymous Auth memberships.
5. Add row-level security, private room Broadcast authorization, and sanitized committed events.
6. Replace polling with Realtime plus snapshot recovery and fallback polling.
7. Add Supabase Cron expiration and Storage uploads with validation.
8. Implement abuse controls, retention, exports/backups, and complete production security checks.
9. Run the 50-player classroom rehearsal, then deploy.

Do not deploy the local adapter to Vercel. No cloud accounts, database credentials, deployment, or GitHub push have been performed in this milestone.

## GitHub preparation

Source files and the dependency lockfile belong in Git. `.local/`, `.env.local`, `node_modules/`, and `.next/` do not. The repository URL and push will be handled after local review, as requested.
