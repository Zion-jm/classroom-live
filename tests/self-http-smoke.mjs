// Run against LOCAL mode only: TEST_BASE_URL=http://localhost:3001 node tests/self-http-smoke.mjs
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
let cookie = "";
async function api(body, token = "", hosting = false, code = "") {
  const response = await fetch(
    `${base}/api/local${body ? "" : `?code=${code}${hosting ? "&host=1" : ""}`}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(hosting ? { Cookie: cookie } : {}),
        "x-player-token": token,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  if (body?.action === "login")
    cookie = response.headers.get("set-cookie").split(";")[0];
  return data;
}
await api({
  action: "login",
  password: process.env.LOCAL_ADMIN_PASSWORD || "classroom-local",
});
const { quiz } = await api(
  {
    action: "save",
    quiz: {
      title: "QA — self-paced HTTP verification",
      questions: [
        {
          prompt: "First question",
          choices: ["Correct", "Wrong"],
          correct: 0,
          seconds: 60,
          explanation: "First explanation",
        },
        {
          prompt: "Second question",
          choices: ["Wrong", "Correct"],
          correct: 1,
          seconds: 60,
          explanation: "Second explanation",
        },
      ],
    },
  },
  "",
  true,
);
for (const feedback of ["each", "end"]) {
  const { code } = await api(
    { action: "host", id: quiz.id, mode: "self", feedback },
    "",
    true,
  );
  const a = await api({ action: "join", code, name: "HTTP Alice" }),
    b = await api({ action: "join", code, name: "HTTP Bob" });
  let h = await api(null, "", true, code);
  h = await api({ action: "start", code, revision: h.revision }, "", true);
  let s = await api(null, a.token, false, code);
  assert.equal(s.mode, "self");
  assert.equal(s.question.correct, undefined);
  s = await api(
    { action: "answer", code, questionId: s.question.id, choice: 0 },
    a.token,
  );
  assert.equal(s.question.correct, feedback === "each" ? 0 : undefined);
  assert.equal(s.score, feedback === "each" ? 1 : null);
  s = await api(
    { action: "next_self", code, questionId: s.question.id },
    a.token,
  );
  assert.equal((await api(null, b.token, false, code)).index, 0);
  s = await api(
    { action: "answer", code, questionId: s.question.id, choice: 1 },
    a.token,
  );
  s = await api(
    { action: "next_self", code, questionId: s.question.id },
    a.token,
  );
  assert.equal(s.phase, "ATTEMPT_FINISHED");
  assert.equal(s.review.length, 2);
  assert.equal(s.score, 2);
  assert.deepEqual(s.leaderboard, []);
  h = await api(null, "", true, code);
  assert.equal(h.finishedCount, 1);
  h = await api(
    { action: "close_session", code, revision: h.revision },
    "",
    true,
  );
  const ended = await api(null, b.token, false, code);
  assert.equal(ended.phase, "FINISHED");
  assert.equal(ended.score, 0);
  assert.equal(ended.review.length, 2);
  assert.equal(ended.leaderboard.length, 2);
  assert.match(
    (await api({ action: "export", code }, "", true)).csv,
    /Unanswered/,
  );
}
console.log(
  "Self-paced HTTP checks passed for both feedback options, independent progression, review, privacy, host closure, and CSV.",
);
