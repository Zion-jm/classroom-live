import { randomUUID, randomBytes } from "node:crypto";

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const check = (condition, message, status = 400) => {
  if (!condition) throw new GameError(message, status);
};
export function validateQuiz(input) {
  check(
    input &&
      typeof input.title === "string" &&
      input.title.trim().length > 0 &&
      input.title.length <= 120,
    "Enter a title (up to 120 characters).",
  );
  check(
    Array.isArray(input.questions) &&
      input.questions.length >= 1 &&
      input.questions.length <= 100,
    "Add between 1 and 100 questions.",
  );
  const questions = input.questions.map((q) => {
    check(
      typeof q.prompt === "string" &&
        q.prompt.trim() &&
        q.prompt.length <= 2000,
      "Every question needs text (up to 2,000 characters).",
    );
    check(
      Array.isArray(q.choices) &&
        q.choices.length >= 2 &&
        q.choices.length <= 6 &&
        q.choices.every(
          (c) => typeof c === "string" && c.trim() && c.length <= 500,
        ),
      "Add 2–6 nonempty choices (up to 500 characters each).",
    );
    check(
      Number.isInteger(q.correct) &&
        q.correct >= 0 &&
        q.correct < q.choices.length,
      "Select the correct answer for every question.",
    );
    check(
      Number.isInteger(q.seconds) && q.seconds >= 5 && q.seconds <= 300,
      "Timers must be 5–300 seconds.",
    );
    check(
      !q.explanation ||
        (typeof q.explanation === "string" && q.explanation.length <= 2000),
      "Explanation is too long.",
    );
    return {
      id: randomUUID(),
      prompt: q.prompt.trim(),
      choices: q.choices.map((c) => c.trim()),
      correct: q.correct,
      seconds: q.seconds,
      explanation: q.explanation || "",
    };
  });
  return { title: input.title.trim(), questions };
}
export function seed() {
  const quiz = validateQuiz({
    title: "The classroom warm-up",
    questions: [
      {
        prompt: "Which planet is known as the Red Planet?",
        choices: ["Venus", "Mars", "Jupiter", "Mercury"],
        correct: 1,
        seconds: 20,
        explanation:
          "Iron minerals on the surface give Mars its reddish color.",
      },
      {
        prompt: "What is 12 × 8?",
        choices: ["84", "88", "96", "108"],
        correct: 2,
        seconds: 15,
        explanation: "12 × 8 = 96.",
      },
      {
        prompt: "Which part of a plant absorbs water from the soil?",
        choices: ["Leaves", "Flowers", "Stem", "Roots"],
        correct: 3,
        seconds: 20,
        explanation: "Roots absorb water and minerals from the soil.",
      },
    ],
  });
  return {
    quizzes: [{ ...quiz, id: randomUUID(), updatedAt: Date.now() }],
    rooms: [],
  };
}
export function createRoom(quiz, now = Date.now()) {
  return {
    id: randomUUID(),
    code: randomBytes(4).toString("hex").slice(0, 6).toUpperCase(),
    quiz: structuredClone(quiz),
    phase: "LOBBY",
    index: -1,
    revision: 0,
    deadline: null,
    players: [],
    answers: {},
    revealedCount: 0,
    createdAt: now,
  };
}
export function reconcile(room, now = Date.now()) {
  if (room.phase === "QUESTION_OPEN" && now >= room.deadline) {
    room.phase = "QUESTION_LOCKED";
    room.revision++;
  }
}
export function join(room, name) {
  check(room.phase === "LOBBY", "This game has already started.");
  check(
    typeof name === "string" &&
      name.trim().length >= 1 &&
      name.trim().length <= 30,
    "Enter a name of 1–30 characters.",
  );
  const normalized = name.trim().normalize("NFKC").toLowerCase();
  check(
    !room.players.some((p) => p.normalized === normalized),
    "That name is already in this room.",
  );
  check(room.players.length < 50, "This room is full (50 players).");
  const player = {
    id: randomUUID(),
    token: randomBytes(32).toString("hex"),
    name: name.trim(),
    normalized,
  };
  room.players.push(player);
  room.revision++;
  return player;
}
export function command(room, action, now = Date.now()) {
  reconcile(room, now);
  if (action === "start") {
    check(
      room.phase === "LOBBY" && room.players.length > 0,
      "Start requires a lobby with at least one player.",
    );
    room.index = 0;
    open(room, now);
  } else if (action === "close") {
    check(room.phase === "QUESTION_OPEN", "Answers are already closed.");
    check(
      room.players.every((p) => room.answers[`${room.index}:${p.id}`]),
      "Wait until everyone submits or the timer expires.",
    );
    room.phase = "QUESTION_LOCKED";
  } else if (action === "reveal") {
    check(
      room.phase === "QUESTION_LOCKED",
      "Wait until answers lock before revealing.",
    );
    room.phase = "ANSWER_REVEALED";
    room.revealedCount = room.index + 1;
  } else if (action === "next") {
    check(
      room.phase === "ANSWER_REVEALED" &&
        room.index < room.quiz.questions.length - 1,
      "Reveal the answer before advancing.",
    );
    room.index++;
    open(room, now);
  } else if (action === "finish") {
    check(
      room.phase === "ANSWER_REVEALED" &&
        room.index === room.quiz.questions.length - 1,
      "Reveal the last answer first.",
    );
    room.phase = "FINISHED";
  } else if (action === "cancel") {
    check(
      !["FINISHED", "CANCELLED"].includes(room.phase),
      "This game has ended.",
    );
    room.phase = "CANCELLED";
  } else throw new GameError("Unknown game command.");
  room.revision++;
}
function open(room, now) {
  room.phase = "QUESTION_OPEN";
  room.startedAt = now;
  room.deadline = now + room.quiz.questions[room.index].seconds * 1000;
}
export function submit(room, playerId, questionId, choice, now = Date.now()) {
  reconcile(room, now);
  const q = room.quiz.questions[room.index];
  check(q && q.id === questionId, "This question is no longer active.");
  const key = `${room.index}:${playerId}`;
  if (room.answers[key]) return room.answers[key];
  check(
    room.phase === "QUESTION_OPEN" && now < room.deadline,
    "Time is up. Answers are locked.",
  );
  check(
    room.players.some((p) => p.id === playerId),
    "Player session is invalid.",
    401,
  );
  check(
    Number.isInteger(choice) && choice >= 0 && choice < q.choices.length,
    "Choose a valid answer.",
  );
  room.answers[key] = { choice, at: now };
  room.revision++;
  return room.answers[key];
}
function visibleCount(room) {
  if (Number.isInteger(room.revealedCount)) return room.revealedCount;
  return ["ANSWER_REVEALED", "FINISHED"].includes(room.phase)
    ? room.index + 1
    : Math.max(0, room.index);
}
export function rankings(room) {
  const count = visibleCount(room);
  const rows = room.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: room.quiz.questions
        .slice(0, count)
        .reduce(
          (n, q, i) =>
            n + (room.answers[`${i}:${p.id}`]?.choice === q.correct ? 1 : 0),
          0,
        ),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map((r, i) => ({
    ...r,
    rank:
      i === 0 || rows[i - 1].score !== r.score
        ? i + 1
        : rows.findIndex((x) => x.score === r.score) + 1,
  }));
}
export function snapshot(room, playerId, admin = false, now = Date.now()) {
  reconcile(room, now);
  const q = room.quiz.questions[room.index];
  const revealed = ["ANSWER_REVEALED", "FINISHED"].includes(room.phase);
  const board = rankings(room);
  const own = room.answers[`${room.index}:${playerId}`];
  return {
    id: room.id,
    code: room.code,
    title: room.quiz.title,
    phase: room.phase,
    revision: room.revision,
    index: room.index,
    total: room.quiz.questions.length,
    deadline: room.deadline,
    serverNow: now,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    submitted: room.players.filter((p) => room.answers[`${room.index}:${p.id}`])
      .length,
    question: q
      ? {
          id: q.id,
          prompt: q.prompt,
          choices: q.choices,
          seconds: q.seconds,
          ...(revealed
            ? { correct: q.correct, explanation: q.explanation }
            : {}),
        }
      : null,
    ownAnswer: own?.choice ?? null,
    score: board.find((p) => p.id === playerId)?.score ?? 0,
    leaderboard: admin || room.phase === "FINISHED" ? board : [],
    revealedCount: visibleCount(room),
  };
}
