// Run against an isolated LOCAL server, never a hosted deployment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
assert.ok(
  new URL(base).hostname === "127.0.0.1" ||
    new URL(base).hostname === "localhost",
);
let cookie = "";
async function api(
  body,
  { host = false, token = "", code = "", status = 200 } = {},
) {
  const response = await fetch(
    `${base}/api/local${body ? "" : code ? `?code=${code}${host ? "&host=1" : ""}` : ""}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(host ? { Cookie: cookie } : {}),
        "x-player-token": token,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  if (body?.action === "login")
    cookie = response.headers.get("set-cookie").split(";")[0];
  return result;
}
await api({
  action: "login",
  password: process.env.LOCAL_ADMIN_PASSWORD || "classroom-local",
});
const question = {
  prompt: "Pick green",
  choices: ["Green", "Red"],
  correct: 0,
  seconds: 60,
  explanation: "Green is correct.",
};
const did = randomUUID();
let d = await api(
  {
    action: "draft_save",
    id: did,
    revision: 0,
    kind: "editor",
    payload: { quiz: { title: "QA draft", questions: [] } },
  },
  { host: true },
);
await api({ action: "draft_load", id: did }, { status: 401 });
await api(
  { action: "draft_publish", id: did, revision: d.revision },
  { host: true, status: 400 },
);
await api(
  { action: "draft_save", id: did, revision: 0, kind: "editor", payload: {} },
  { host: true, status: 400 },
);
d = await api(
  {
    action: "draft_save",
    id: did,
    revision: d.revision,
    kind: "editor",
    payload: {
      quiz: {
        title: "QA expansion HTTP",
        questions: [question, { ...question, prompt: "Green again" }],
      },
    },
  },
  { host: true },
);
const { quiz } = await api(
  { action: "draft_publish", id: did, revision: d.revision },
  { host: true },
);
assert.equal(
  (
    await api(
      { action: "draft_publish", id: did, revision: d.revision },
      { host: true },
    )
  ).quiz.id,
  quiz.id,
);
for (const feedback of ["each", "end", "session_end"]) {
  const { code } = await api(
    {
      action: "host",
      id: quiz.id,
      mode: "self",
      feedback,
      timerMode: "quiz",
      quizDurationSeconds: 60,
      shuffleQuestions: true,
      shuffleChoices: true,
    },
    { host: true },
  );
  const a = await api({ action: "join", code, name: "QA Alice" });
  await api({ action: "join", code, name: "QA Bob" });
  let h = await api(null, { host: true, code });
  await api({ action: "start", code, revision: h.revision }, { host: true });
  let s = await api(null, { token: a.token, code });
  const deadline = s.deadline;
  for (let i = 0; i < 2; i++) {
    assert.equal(s.question.correct, undefined);
    assert.deepEqual(s.review, []);
    assert.equal(s.deadline, deadline);
    const qid = s.question.id,
      selected = s.question.choices.indexOf("Green");
    s = await api(
      {
        action: "answer",
        code,
        questionId: qid,
        choiceId: s.question.choiceIds[selected],
      },
      { token: a.token },
    );
    assert.equal(s.score, feedback === "each" ? i + 1 : null);
    s = await api(
      { action: "next_self", code, questionId: qid },
      { token: a.token },
    );
  }
  assert.equal(s.phase, "ATTEMPT_FINISHED");
  assert.equal(s.score, feedback === "session_end" ? null : 2);
  h = await api(null, { host: true, code });
  await api(
    { action: "close_session", code, revision: h.revision },
    { host: true },
  );
  s = await api(null, { token: a.token, code });
  assert.equal(s.score, 2);
  assert.equal(s.review.length, 2);
  const report = await api(
    { action: "session_analysis", code },
    { host: true },
  );
  assert.ok(
    report.questions.every((q) => q.correct === 1 && q.unanswered === 1),
  );
  await api(
    { action: "session_analysis", code },
    { token: a.token, status: 401 },
  );
  const { csv } = await api({ action: "export", code }, { host: true });
  assert.match(csv, /QA Alice/);
}
const editId = randomUUID();
const edit = await api(
  {
    action: "draft_save",
    id: editId,
    revision: 0,
    kind: "editor",
    payload: { quiz },
  },
  { host: true },
);
await api(
  { action: "save", quiz: { ...quiz, title: "Changed elsewhere" } },
  { host: true },
);
await api(
  { action: "draft_publish", id: editId, revision: edit.revision },
  { host: true, status: 400 },
);
await api({ action: "delete", id: quiz.id }, { host: true });
await api(
  { action: "draft_publish", id: editId, revision: edit.revision },
  { host: true, status: 400 },
);
console.log(
  "Expansion HTTP checks passed: drafts, conflict protection, all feedback policies with shuffle/overall timer, private analysis, CSV.",
);
