// Run against an already running local server: node tests/http-smoke.mjs
// Creates a clearly labeled test quiz and room; does not delete user data.
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
let adminCookie = "";
async function api(
  body,
  { admin = false, token = "", query = "", status = 200, origin = base } = {},
) {
  const response = await fetch(`${base}/api/local${query}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(admin ? { Cookie: adminCookie } : {}),
      ...(token ? { "x-player-token": token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  if (body?.action === "login" && status === 200)
    adminCookie = response.headers.get("set-cookie").split(";")[0];
  return data;
}
await api({ action: "host", id: "forbidden" }, { status: 401 });
await api({ action: "login", password: "wrong" }, { status: 401 });
await api(
  {
    action: "login",
    password: process.env.LOCAL_ADMIN_PASSWORD || "classroom-local",
  },
  { origin: "http://untrusted.example", status: 403 },
);
await api({
  action: "login",
  password: process.env.LOCAL_ADMIN_PASSWORD || "classroom-local",
});
const { quiz } = await api(
  {
    action: "save",
    quiz: {
      title: "QA — 50-player verification",
      questions: [
        {
          prompt: "Choose green.",
          choices: ["Green", "Red"],
          correct: 0,
          seconds: 5,
          explanation: "Green is the correct choice.",
        },
        {
          prompt: "Choose two.",
          choices: ["One", "Two"],
          correct: 1,
          seconds: 5,
          explanation: "",
        },
      ],
    },
  },
  { admin: true },
);
const { code } = await api({ action: "host", id: quiz.id }, { admin: true });
const players = await Promise.all(
  Array.from({ length: 50 }, (_, i) =>
    api({ action: "join", code, name: `QA student ${i}` }),
  ),
);
await api({ action: "join", code, name: "QA STUDENT 0" }, { status: 400 });
await api({ action: "join", code, name: "Overflow" }, { status: 400 });
await api(
  { action: "start", code, revision: 50 },
  { token: players[0].token, status: 401 },
);
let room = await api(undefined, { admin: true, query: `?code=${code}&host=1` });
room = await api(
  { action: "start", code, revision: room.revision },
  { admin: true },
);
await api({ action: "join", code, name: "Late" }, { status: 400 });
const playerState = await api(undefined, {
  token: players[0].token,
  query: `?code=${code}`,
});
assert.equal(playerState.question.correct, undefined);
assert.equal(playerState.question.explanation, undefined);
assert.deepEqual(playerState.leaderboard, []);
await Promise.all(
  players
    .slice(0, 49)
    .map((p, i) =>
      api(
        { action: "answer", code, questionId: room.question.id, choice: i % 2 },
        { token: p.token },
      ),
    ),
);
const receipt = await api(
  { action: "answer", code, questionId: room.question.id, choice: 1 },
  { token: players[0].token },
);
assert.equal(receipt.ownAnswer, 0);
await new Promise((r) =>
  setTimeout(r, Math.max(0, room.deadline - Date.now() + 100)),
);
await api(
  { action: "answer", code, questionId: room.question.id, choice: 0 },
  { token: players[49].token, status: 400 },
);
room = await api(undefined, { admin: true, query: `?code=${code}&host=1` });
assert.equal(room.phase, "QUESTION_LOCKED");
room = await api(
  { action: "reveal", code, revision: room.revision },
  { admin: true },
);
const correct = await api(undefined, {
  token: players[0].token,
  query: `?code=${code}`,
});
assert.equal(correct.score, 1);
const unanswered = await api(undefined, {
  token: players[49].token,
  query: `?code=${code}`,
});
assert.equal(unanswered.score, 0);
assert.equal(unanswered.ownAnswer, null);
room = await api(
  { action: "next", code, revision: room.revision },
  { admin: true },
);
await Promise.all(
  players.map((p) =>
    api(
      { action: "answer", code, questionId: room.question.id, choice: 1 },
      { token: p.token },
    ),
  ),
);
room = await api(undefined, { admin: true, query: `?code=${code}&host=1` });
room = await api(
  { action: "close", code, revision: room.revision },
  { admin: true },
);
room = await api(
  { action: "reveal", code, revision: room.revision },
  { admin: true },
);
room = await api(
  { action: "finish", code, revision: room.revision },
  { admin: true },
);
assert.equal(room.leaderboard.length, 50);
assert.equal(room.leaderboard.filter((p) => p.score === 2).length, 25);
assert.equal(room.leaderboard[25].rank, 26);
const { csv } = await api({ action: "export", code }, { admin: true });
assert.match(csv, /Revealed questions/);
assert.match(csv, /Unanswered/);
console.log(
  `HTTP verification passed: 50 players, role checks, origin checks, privacy, duplicate submissions, timed lock, unanswered scoring, final ties, CSV. Room ${code}.`,
);
