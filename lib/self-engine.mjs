import {
  permutation,
  setupPresentation,
  canonicalIndex,
  presentQuestion,
  resolveChoice,
  choiceOrder,
} from "./presentation.mjs";
const check = (condition, message) => {
  if (!condition) {
    const e = new Error(message);
    e.status = 400;
    throw e;
  }
};
export function reconcileSelf(room, now) {
  if (room.phase !== "RUNNING") return;
  for (const a of Object.values(room.attempts || {}))
    if (
      a.status !== "FINISHED" &&
      room.timerMode === "quiz" &&
      now >= a.overallDeadline
    ) {
      a.status = "FINISHED";
      a.finishReason = "overall_timeout";
      a.deadline = null;
      room.revision++;
    } else if (a.status === "OPEN" && now >= a.deadline) {
      a.status = room.feedback === "each" ? "REVIEW" : "LOCKED";
      room.revision++;
    }
  if (
    Object.values(room.attempts || {}).length &&
    Object.values(room.attempts).every((a) => a.status === "FINISHED")
  ) {
    room.phase = "FINISHED";
    room.revealedCount = room.quiz.questions.length;
    room.revision++;
  }
}
export function selfCommand(room, action, now) {
  reconcileSelf(room, now);
  if (action === "start") {
    check(
      room.phase === "LOBBY" && room.players.length,
      "Start requires a lobby with at least one player.",
    );
    setupPresentation(room);
    room.exposures = {};
    room.attempts = Object.fromEntries(
      room.players.map((p) => [
        p.id,
        {
          questionOrder: permutation(
            room.quiz.questions.length,
            room.shuffleQuestions,
          ),
          index: 0,
          status: "OPEN",
          deadline: now + room.quiz.questions[0].seconds * 1000,
        },
      ]),
    );
    for (const p of room.players) {
      const a = room.attempts[p.id];
      a.startedAt = now;
      a.overallDeadline =
        room.timerMode === "quiz"
          ? now + room.quizDurationSeconds * 1000
          : null;
      a.deadline =
        a.overallDeadline ??
        now + room.quiz.questions[a.questionOrder[0]].seconds * 1000;
      room.exposures[`${a.questionOrder[0]}:${p.id}`] = { openedAt: now };
    }
    room.phase = "RUNNING";
  } else if (action === "close_session") {
    check(room.phase === "RUNNING", "This session is not running.");
    for (const a of Object.values(room.attempts)) {
      a.status = "FINISHED";
      a.deadline = null;
      a.finishReason ??= "teacher_closed";
    }
    room.phase = "FINISHED";
    room.revealedCount = room.quiz.questions.length;
  } else if (action === "cancel") {
    check(
      !["FINISHED", "CANCELLED"].includes(room.phase),
      "This game has ended.",
    );
    room.phase = "CANCELLED";
  } else check(false, "This control is unavailable in self-paced mode.");
  room.revision++;
}
export function selfSubmit(room, playerId, questionId, choice, now) {
  reconcileSelf(room, now);
  const a = room.attempts?.[playerId];
  check(
    room.phase === "RUNNING" && a && a.status !== "FINISHED",
    "This attempt is not accepting answers.",
  );
  const index = canonicalIndex(room, playerId, a.index);
  const q = room.quiz.questions[index];
  check(q.id === questionId, "This question is no longer active.");
  const key = `${index}:${playerId}`;
  if (room.answers[key]) return room.answers[key];
  check(
    a.status === "OPEN" && now < a.deadline,
    "Time is up. Answers are locked.",
  );
  choice = resolveChoice(room, playerId, index, choice);
  check(
    Number.isInteger(choice) && choice >= 0 && choice < q.choices.length,
    "Choose a valid answer.",
  );
  room.answers[key] = { choice, at: now };
  a.status = room.feedback === "each" ? "REVIEW" : "LOCKED";
  room.revision++;
  return room.answers[key];
}
export function nextSelf(room, playerId, questionId, now = Date.now()) {
  reconcileSelf(room, now);
  const a = room.attempts?.[playerId];
  check(
    room.phase === "RUNNING" && a && a.status !== "FINISHED",
    "Your attempt has already finished.",
  );
  check(
    room.quiz.questions[canonicalIndex(room, playerId, a.index)].id ===
      questionId,
    "This question is no longer active.",
  );
  check(
    a.status !== "OPEN",
    "Submit your answer or wait for the timer before continuing.",
  );
  if (a.index === room.quiz.questions.length - 1) {
    a.status = "FINISHED";
    a.deadline = null;
    a.finishReason = "student_finished";
    if (Object.values(room.attempts).every((t) => t.status === "FINISHED")) {
      room.phase = "FINISHED";
      room.revealedCount = room.quiz.questions.length;
    }
  } else {
    a.index++;
    a.status = "OPEN";
    const index = canonicalIndex(room, playerId, a.index);
    a.deadline =
      a.overallDeadline ?? now + room.quiz.questions[index].seconds * 1000;
    if (room.exposures)
      room.exposures[`${index}:${playerId}`] = { openedAt: now };
  }
  room.revision++;
}
export function selfBoard(room) {
  const rows = room.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: room.quiz.questions.reduce(
        (n, q, i) =>
          n + (room.answers[`${i}:${p.id}`]?.choice === q.correct ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map((r) => ({
    ...r,
    rank: rows.findIndex((x) => x.score === r.score) + 1,
  }));
}
export function selfSnapshot(room, playerId, admin, now) {
  reconcileSelf(room, now);
  const a = room.attempts?.[playerId];
  const total = room.quiz.questions.length;
  const done = a?.status === "FINISHED" || room.phase === "FINISHED";
  const idx = a?.index ?? 0;
  const canonical = canonicalIndex(room, playerId, idx);
  const q = room.quiz.questions[canonical];
  const allowed =
    room.phase !== "CANCELLED" &&
    (room.feedback !== "session_end" || room.phase === "FINISHED");
  const board = selfBoard(room);
  const phase = ["LOBBY", "CANCELLED", "FINISHED"].includes(room.phase)
    ? room.phase
    : admin
      ? "RUNNING"
      : done
        ? "ATTEMPT_FINISHED"
        : a?.status === "OPEN"
          ? "QUESTION_OPEN"
          : a?.status === "REVIEW"
            ? "ANSWER_REVEALED"
            : "QUESTION_LOCKED";
  const reveal = room.feedback === "each" && a?.status === "REVIEW";
  return {
    id: room.id,
    code: room.code,
    title: room.quiz.title,
    mode: "self",
    feedback: room.feedback,
    timerMode: room.timerMode ?? "question",
    quizDurationSeconds: room.quizDurationSeconds,
    finishReason: a?.finishReason,
    shuffleChoices: room.shuffleChoices ?? false,
    phase,
    sessionPhase: room.phase,
    revision: room.revision,
    index: idx,
    total,
    deadline:
      admin && room.timerMode === "quiz" && room.phase === "RUNNING"
        ? Math.min(
            ...Object.values(room.attempts || {}).map(
              (attempt) => attempt.overallDeadline,
            ),
          )
        : a?.status !== "FINISHED" && room.timerMode === "quiz"
          ? a?.overallDeadline
          : a?.status === "OPEN"
            ? a.deadline
            : null,
    serverNow: now,
    ownAnswer: room.answers[`${canonical}:${playerId}`]
      ? choiceOrder(room, playerId, canonical).indexOf(
          room.answers[`${canonical}:${playerId}`].choice,
        )
      : null,
    score:
      allowed && (room.feedback === "each" || done)
        ? (board.find((p) => p.id === playerId)?.score ?? 0)
        : null,
    revealedCount: done ? total : 0,
    finishedCount: Object.values(room.attempts || {}).filter(
      (a) => a.status === "FINISHED",
    ).length,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    progress: admin
      ? room.players.map((p) => ({
          id: p.id,
          name: p.name,
          status: room.attempts?.[p.id]?.status || "WAITING",
          index: room.attempts?.[p.id]?.index || 0,
          answered: Object.keys(room.answers).filter((k) =>
            k.endsWith(`:${p.id}`),
          ).length,
        }))
      : [],
    question:
      !admin && !done && room.phase !== "LOBBY"
        ? presentQuestion(room, playerId, canonical, reveal && allowed)
        : null,
    leaderboard: admin || room.phase === "FINISHED" ? board : [],
    review:
      !admin && done && allowed
        ? (a?.questionOrder ?? room.quiz.questions.map((_, i) => i)).map(
            (i) => ({
              ...presentQuestion(room, playerId, i, true),
              ownAnswer: room.answers[`${i}:${playerId}`]
                ? choiceOrder(room, playerId, i).indexOf(
                    room.answers[`${i}:${playerId}`].choice,
                  )
                : null,
            }),
          )
        : [],
  };
}
