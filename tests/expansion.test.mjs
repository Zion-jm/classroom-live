import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  createRoom,
  join,
  command,
  submit,
  snapshot,
  nextSelf,
  validateQuiz,
} from "../lib/engine.mjs";
import { analysis, canonicalIndex, permutation } from "../lib/presentation.mjs";

test("50 students complete 100 shuffled questions with canonical scoring and reports", () => {
  const sample = seed().quizzes[0].questions[0];
  const quiz = validateQuiz({
    title: "Boundary fixture",
    questions: Array.from({ length: 100 }, (_, i) => ({
      ...sample,
      prompt: `Question ${i + 1}`,
    })),
  });
  const room = createRoom(quiz, 1000, {
    mode: "self",
    feedback: "session_end",
    timerMode: "quiz",
    quizDurationSeconds: 60,
    shuffleQuestions: true,
    shuffleChoices: true,
  });
  const players = Array.from({ length: 50 }, (_, i) =>
    join(room, `Boundary ${i}`),
  );
  command(room, "start", 1000);
  for (const [n, p] of players.entries())
    for (let step = 0; step < 100; step++) {
      const index = canonicalIndex(room, p.id, step),
        q = room.quiz.questions[index];
      submit(
        room,
        p.id,
        q.id,
        `${q.id}:${n % 2 === 0 ? q.correct : (q.correct + 1) % q.choices.length}`,
        1100 + step * 2,
      );
      nextSelf(room, p.id, q.id, 1101 + step * 2);
    }
  const result = snapshot(room, players[0].id, false, 2000);
  assert.equal(result.phase, "FINISHED");
  assert.equal(result.review.length, 100);
  assert.equal(result.leaderboard.filter((p) => p.score === 100).length, 25);
  const report = analysis(room);
  assert.equal(report.questions.length, 100);
  assert.ok(
    report.questions.every(
      (q) =>
        q.submitted === 50 &&
        q.correct === 25 &&
        q.incorrect === 25 &&
        q.unanswered === 0,
    ),
  );
});

for (const feedback of ["each", "end", "session_end"])
  for (const timerMode of ["question", "quiz"])
    for (const shuffleQuestions of [false, true])
      for (const shuffleChoices of [false, true])
        test(`local self matrix: ${feedback}/${timerMode}/questions=${shuffleQuestions}/choices=${shuffleChoices}`, () => {
          const r = createRoom(seed().quizzes[0], 1000, {
            mode: "self",
            feedback,
            timerMode,
            quizDurationSeconds: 60,
            shuffleQuestions,
            shuffleChoices,
          });
          const a = join(r, "A"),
            b = join(r, "B");
          command(r, "start", 1000);
          const order = [...r.attempts[a.id].questionOrder],
            deadline = r.attempts[a.id].deadline;
          assert.deepEqual([...order].sort(), [0, 1, 2]);
          if (!shuffleQuestions) assert.deepEqual(order, [0, 1, 2]);
          for (let step = 0; step < 3; step++) {
            const s = snapshot(r, a.id, false, 1100 + step * 100);
            assert.deepEqual(
              snapshot(r, a.id, false, 1100 + step * 100).question,
              s.question,
            );
            assert.equal(s.question.correct, undefined);
            const q = r.quiz.questions[canonicalIndex(r, a.id, step)];
            const correct = s.question.choices.indexOf(q.choices[q.correct]);
            if (shuffleChoices)
              assert.throws(
                () => submit(r, a.id, q.id, correct, 1110 + step * 100),
                /choice ID/,
              );
            submit(
              r,
              a.id,
              q.id,
              s.question.choiceIds[correct],
              1120 + step * 100,
            );
            const after = snapshot(r, a.id, false, 1121 + step * 100);
            assert.equal(
              after.question.correct,
              feedback === "each" ? correct : undefined,
            );
            assert.equal(after.score, feedback === "each" ? step + 1 : null);
            nextSelf(r, a.id, q.id, 1150 + step * 100);
            if (timerMode === "quiz" && step < 2)
              assert.equal(r.attempts[a.id].deadline, deadline);
          }
          let done = snapshot(r, a.id, false, 1500);
          assert.equal(done.score, feedback === "session_end" ? null : 3);
          assert.equal(done.review.length, feedback === "session_end" ? 0 : 3);
          assert.equal(snapshot(r, b.id, false, 1500).index, 0);
          command(r, "close_session", 1600);
          done = snapshot(r, a.id, false, 1700);
          assert.equal(done.score, 3);
          assert.deepEqual(
            done.review.map((q) => q.id),
            order.map((i) => r.quiz.questions[i].id),
          );
          for (const q of done.review) assert.equal(q.ownAnswer, q.correct);
          const report = analysis(r);
          for (const q of report.questions) {
            assert.equal(q.correct, 1);
            assert.equal(q.unanswered, 1);
            assert.equal(q.timingSamples, 1);
            assert.ok(q.medianResponseMs >= 0);
          }
        });

for (const shuffleQuestions of [false, true])
  for (const shuffleChoices of [false, true])
    test(`local teacher matrix: questions=${shuffleQuestions}/choices=${shuffleChoices}`, () => {
      const r = createRoom(seed().quizzes[0], 1000, {
        shuffleQuestions,
        shuffleChoices,
      });
      const players = [join(r, "A"), join(r, "B")];
      command(r, "start", 1000);
      for (let i = 0; i < 3; i++) {
        for (const p of players) {
          const s = snapshot(r, p.id, false, 1100 + i * 100);
          const q = r.quiz.questions[i];
          assert.equal(s.question.id, q.id);
          submit(
            r,
            p.id,
            q.id,
            s.question.choiceIds[
              s.question.choices.indexOf(q.choices[q.correct])
            ],
            1110 + i * 100,
          );
        }
        command(r, "close", 1120 + i * 100);
        command(r, "reveal", 1130 + i * 100);
        for (const p of players) {
          const s = snapshot(r, p.id, false, 1140 + i * 100);
          assert.equal(s.question.correct, s.ownAnswer);
        }
        if (i < 2) command(r, "next", 1150 + i * 100);
      }
      command(r, "finish", 1500);
      assert.ok(
        snapshot(r, null, true, 1600).leaderboard.every((p) => p.score === 3),
      );
      assert.deepEqual(
        analysis(r).questions.map((q) => q.sourceIndex),
        [0, 1, 2],
      );
    });

test("whole timer expires between questions; strict cancel stays private; permutations are complete", () => {
  for (const cancel of [false, true]) {
    const r = createRoom(seed().quizzes[0], 1000, {
      mode: "self",
      feedback: "session_end",
      timerMode: "quiz",
      quizDurationSeconds: 60,
    });
    const p = join(r, "Timed");
    command(r, "start", 1000);
    const q = r.quiz.questions[0];
    submit(r, p.id, q.id, q.correct, 1100);
    if (cancel) command(r, "cancel", 1200);
    const s = snapshot(r, p.id, false, 61000);
    assert.equal(s.phase, cancel ? "CANCELLED" : "FINISHED");
    assert.equal(s.score, cancel ? null : 1);
    assert.equal(s.review.length, cancel ? 0 : 3);
    assert.throws(() => submit(r, p.id, q.id, q.correct, 61000));
  }
  for (let n = 2; n <= 100; n++)
    assert.deepEqual(
      permutation(n, true).sort((a, b) => a - b),
      permutation(n),
    );
});
