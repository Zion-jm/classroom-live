import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  createRoom,
  join,
  command,
  submit,
  nextSelf,
  snapshot,
} from "../lib/engine.mjs";
for (const feedback of ["each", "end"])
  test(`self-paced ${feedback}: independent progress, feedback isolation, deadline recovery, finish and ties`, () => {
    const r = createRoom(seed().quizzes[0], 1000, { mode: "self", feedback });
    const a = join(r, "Alice"),
      b = join(r, "Bob");
    command(r, "start", 1000);
    const q = r.quiz.questions[0];
    assert.equal(snapshot(r, a.id, false, 1001).question.correct, undefined);
    assert.throws(() => nextSelf(r, a.id, q.id, 1001), /Submit/);
    submit(r, a.id, q.id, q.correct, 1100);
    const locked = snapshot(r, a.id, false, 1101);
    assert.equal(
      locked.question.correct,
      feedback === "each" ? q.correct : undefined,
    );
    assert.equal(locked.score, feedback === "each" ? 1 : null);
    nextSelf(r, a.id, q.id, 1200);
    assert.equal(snapshot(r, b.id, false, 1201).index, 0);
    assert.equal(snapshot(r, a.id, false, 1201).index, 1);
    assert.throws(() => nextSelf(r, a.id, q.id, 1201), /no longer/);
    for (let i = 1; i < r.quiz.questions.length; i++) {
      const q = r.quiz.questions[i];
      submit(r, a.id, q.id, q.correct, 1300 + i);
      nextSelf(r, a.id, q.id, 1400 + i);
    }
    const done = snapshot(r, a.id, false, 1500);
    assert.equal(done.phase, "ATTEMPT_FINISHED");
    assert.equal(done.review.length, 3);
    assert.equal(done.score, 3);
    assert.deepEqual(done.leaderboard, []);
    assert.deepEqual(snapshot(r, b.id, false, 1500).review, []);
    const deadline = r.attempts[b.id].deadline;
    assert.throws(() => submit(r, b.id, q.id, 0, deadline), /locked/);
    assert.equal(snapshot(r, b.id, false, deadline + 1).ownAnswer, null);
    nextSelf(r, b.id, q.id, deadline + 2);
    command(r, "close_session", deadline + 3);
    const ended = snapshot(r, b.id, false, deadline + 4);
    assert.equal(ended.phase, "FINISHED");
    assert.equal(ended.score, 0);
    assert.equal(ended.review.length, 3);
    assert.equal(ended.leaderboard.length, 2);
    assert.throws(() =>
      submit(r, b.id, r.quiz.questions[1].id, 0, deadline + 5),
    );
  });
test("self-paced auto-completes only after the last student finishes", () => {
  const quiz = seed().quizzes[0];
  quiz.questions = quiz.questions.slice(0, 1);
  const r = createRoom(quiz, 1000, { mode: "self", feedback: "end" });
  const a = join(r, "A"),
    b = join(r, "B");
  command(r, "start", 1000);
  const q = quiz.questions[0];
  for (const p of [a, b]) {
    submit(r, p.id, q.id, q.correct, 1100);
    nextSelf(r, p.id, q.id, 1200);
    if (p === a) assert.equal(r.phase, "RUNNING");
  }
  assert.equal(r.phase, "FINISHED");
  assert.deepEqual(
    snapshot(r, a.id, false, 1300).leaderboard.map((p) => p.rank),
    [1, 1],
  );
});
