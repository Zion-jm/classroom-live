import { randomInt } from "node:crypto";
export function permutation(n, shuffled = false) {
  const a = Array.from({ length: n }, (_, i) => i);
  if (shuffled)
    for (let i = n - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
  return a;
}
export function settings(options = {}) {
  const mode = options.mode ?? "teacher",
    feedback = options.feedback ?? "end",
    timerMode = options.timerMode ?? "question",
    quizDurationSeconds = options.quizDurationSeconds ?? 1200;
  if (
    !["teacher", "self"].includes(mode) ||
    !["each", "end", "session_end"].includes(feedback) ||
    !["question", "quiz"].includes(timerMode) ||
    (mode === "teacher" && timerMode === "quiz") ||
    !Number.isInteger(quizDurationSeconds) ||
    quizDurationSeconds < 60 ||
    quizDurationSeconds > 10800
  )
    throw Object.assign(
      new Error(
        "Invalid session settings. Whole-quiz timing is self-paced only (1–180 minutes).",
      ),
      { status: 400 },
    );
  return {
    mode,
    feedback,
    timerMode,
    quizDurationSeconds,
    shuffleQuestions: options.shuffleQuestions === true,
    shuffleChoices: options.shuffleChoices === true,
    settingsVersion: 3,
  };
}
export function canonicalIndex(room, playerId, position) {
  return room.attempts?.[playerId]?.questionOrder?.[position] ?? position;
}
export function choiceOrder(room, playerId, index) {
  return (
    room.presentations?.[playerId]?.[index] ??
    room.quiz.questions[index].choices.map((_, i) => i)
  );
}
export function presentQuestion(room, playerId, index, reveal = false) {
  const q = room.quiz.questions[index];
  if (!q) return null;
  const order = choiceOrder(room, playerId, index);
  return {
    id: q.id,
    prompt: q.prompt,
    choices: order.map((i) => q.choices[i]),
    choiceIds: order.map((i) => `${q.id}:${i}`),
    seconds: q.seconds,
    ...(reveal
      ? { correct: order.indexOf(q.correct), explanation: q.explanation }
      : {}),
  };
}
export function resolveChoice(room, playerId, index, value) {
  const q = room.quiz.questions[index];
  if (typeof value === "string") {
    const i = q.choices.findIndex((_, i) => `${q.id}:${i}` === value);
    if (i >= 0) return i;
  } else if (!room.shuffleChoices && Number.isInteger(value)) return value;
  throw Object.assign(
    new Error("Choose a valid choice ID for this question."),
    { status: 400 },
  );
}
export function setupPresentation(room) {
  room.presentations = Object.fromEntries(
    room.players.map((p) => [
      p.id,
      room.quiz.questions.map((q) =>
        permutation(q.choices.length, room.shuffleChoices),
      ),
    ]),
  );
}
export function analysis(room) {
  const completed = room.phase === "FINISHED",
    n = room.players.length;
  const questions = room.quiz.questions.map((q, index) => {
    const rows = room.players.map((p) => ({
      p,
      answer: room.answers[`${index}:${p.id}`],
      exposure: room.exposures?.[`${index}:${p.id}`],
    }));
    const submitted = rows.filter((x) => x.answer);
    const correct = submitted.filter(
      (x) => x.answer.choice === q.correct,
    ).length;
    const times = submitted
      .filter((x) => x.exposure)
      .map((x) => Math.max(0, x.answer.at - x.exposure.openedAt))
      .sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    return {
      id: q.id,
      index,
      sourceIndex: q.sourceIndex ?? index,
      prompt: q.prompt,
      choices: q.choices,
      correctChoice: q.correct,
      explanation: q.explanation,
      eligible: n,
      submitted: submitted.length,
      correct,
      incorrect: submitted.length - correct,
      unanswered: completed ? n - submitted.length : null,
      reached: room.exposures ? rows.filter((x) => x.exposure).length : null,
      correctRate: n ? correct / n : null,
      submissionAccuracy: submitted.length ? correct / submitted.length : null,
      distribution: q.choices.map((text, i) => ({
        text,
        count: submitted.filter((x) => x.answer.choice === i).length,
      })),
      medianResponseMs: times.length
        ? times.length % 2
          ? times[middle]
          : (times[middle - 1] + times[middle]) / 2
        : null,
      timingSamples: times.length,
    };
  });
  return {
    title: room.quiz.title,
    phase: room.phase,
    mode: room.mode ?? "teacher",
    eligible: n,
    questions: questions.sort((a, b) => a.sourceIndex - b.sourceIndex),
  };
}
