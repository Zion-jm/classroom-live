import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  createRoom,
  join,
  command,
  submit,
  snapshot,
  rankings,
  validateQuiz,
} from "../lib/engine.mjs";
function setup() {
  const r = createRoom(seed().quizzes[0], 1000);
  const a = join(r, "Alice");
  const b = join(r, "Bob");
  command(r, "start", 1000);
  return { r, a, b };
}
test("answer keys stay private until reveal; unanswered receives zero", () => {
  const { r, a, b } = setup();
  const q = r.quiz.questions[0];
  assert.equal(snapshot(r, a.id, false, 1001).question.correct, undefined);
  assert.equal(snapshot(r, a.id, false, 1001).question.explanation, undefined);
  submit(r, a.id, q.id, q.correct, 1100);
  assert.equal(snapshot(r, a.id, false, 1101).score, 0);
  command(r, "reveal", r.deadline);
  assert.equal(snapshot(r, a.id, false, r.deadline).score, 1);
  assert.equal(snapshot(r, b.id, false, r.deadline).score, 0);
  assert.equal(snapshot(r, b.id, false, r.deadline).ownAnswer, null);
  assert.equal(
    snapshot(r, a.id, false, r.deadline).question.correct,
    q.correct,
  );
});
test("exact deadline rejects even if no closure worker has executed", () => {
  const { r, a } = setup();
  assert.throws(
    () => submit(r, a.id, r.quiz.questions[0].id, 0, r.deadline),
    /locked/,
  );
  assert.equal(r.phase, "QUESTION_LOCKED");
});
test("duplicate submission never overwrites the accepted answer", () => {
  const { r, a } = setup();
  const id = r.quiz.questions[0].id;
  submit(r, a.id, id, 1, 1100);
  submit(r, a.id, id, 0, 1200);
  assert.equal(r.answers[`0:${a.id}`].choice, 1);
});
test("state sequence, early closing, and stale questions are enforced", () => {
  const { r, a, b } = setup();
  assert.throws(() => command(r, "next", 1100));
  assert.throws(() => command(r, "reveal", 1100));
  assert.throws(() => command(r, "close", 1100));
  const id = r.quiz.questions[0].id;
  submit(r, a.id, id, 0, 1100);
  submit(r, b.id, id, 1, 1100);
  command(r, "close", 1200);
  command(r, "reveal", 1201);
  command(r, "next", 1300);
  assert.equal(r.index, 1);
  assert.throws(() => submit(r, a.id, id, 0, 1400));
});
test("names are unique and late joins blocked", () => {
  const r = createRoom(seed().quizzes[0]);
  join(r, "Alice");
  assert.throws(() => join(r, " ALICE "));
  command(r, "start");
  assert.throws(() => join(r, "Bob"));
});
test("shared ranks use competition ranking; quiz snapshots are immutable copies", () => {
  const { r, a, b } = setup();
  submit(r, a.id, r.quiz.questions[0].id, 1, 1100);
  submit(r, b.id, r.quiz.questions[0].id, 1, 1100);
  command(r, "reveal", r.deadline);
  assert.deepEqual(
    rankings(r).map((p) => p.rank),
    [1, 1],
  );
  const q = seed().quizzes[0];
  const room = createRoom(q);
  q.questions[0].correct = 0;
  assert.equal(room.quiz.questions[0].correct, 1);
});
test("50 players can answer together and produce consistent final rankings", () => {
  const r = createRoom(seed().quizzes[0]);
  const players = Array.from({ length: 50 }, (_, i) => join(r, `Student ${i}`));
  assert.throws(() => join(r, "Extra"));
  command(r, "start", 1000);
  for (let i = 0; i < r.quiz.questions.length; i++) {
    const q = r.quiz.questions[i];
    for (const [n, p] of players.entries())
      submit(
        r,
        p.id,
        q.id,
        n % 2 ? q.correct : (q.correct + 1) % 4,
        r.deadline - 1,
      );
    command(r, "reveal", r.deadline);
    command(r, i === 2 ? "finish" : "next", r.deadline + 1);
  }
  assert.equal(r.phase, "FINISHED");
  assert.equal(rankings(r).filter((p) => p.score === 3).length, 25);
  assert.equal(rankings(r)[25].rank, 26);
});
test("invalid quiz data rejected", () => {
  assert.throws(() => validateQuiz({ title: "", questions: [] }));
  const q = seed().quizzes[0];
  q.questions[0].correct = 8;
  assert.throws(() => validateQuiz(q));
});

test("cancelling after reveal preserves already awarded scores", () => {
  const { r, a } = setup();
  submit(r, a.id, r.quiz.questions[0].id, 1, 1100);
  command(r, "reveal", r.deadline);
  command(r, "cancel", r.deadline + 1);
  const state = snapshot(r, a.id, false, r.deadline + 2);
  assert.equal(state.score, 1);
  assert.equal(state.revealedCount, 1);
});
