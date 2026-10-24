"use client";
import { useEffect, useRef, useState } from "react";
import SelfSession from "./components/SelfSession";
import ImportQuiz from "./components/ImportQuiz";
import LobbyQR from "./components/LobbyQR";
import Analysis from "./components/Analysis";
import DraftPanel, { type DraftHandle } from "./components/DraftPanel";
import {
  backendRequest,
  cloudMode,
  playerStorageKey,
  subscribeRoom,
} from "../lib/backend";
type Question = {
  prompt: string;
  choices: string[];
  correct: number;
  seconds: number;
  explanation: string;
  id?: string;
};
type Quiz = {
  id?: string;
  revision?: number;
  title: string;
  questions: Question[];
};
const blankQuestion = (): Question => ({
  prompt: "",
  choices: ["", "", "", ""],
  correct: 0,
  seconds: 30,
  explanation: "",
});
const freshQuiz = (): Quiz => ({ title: "", questions: [blankQuestion()] });
const letters = ["A", "B", "C", "D", "E", "F"];
export default function Home() {
  const [view, setView] = useState("home");
  const [admin, setAdmin] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [draft, setDraft] = useState<Quiz>(freshQuiz);
  const [room, setRoom] = useState<any>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [live, setLive] = useState(false);
  const [token, setToken] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(true);
  const offset = useRef(0);
  const lastQuestion = useRef("");
  const lastState = useRef({ code: "", revision: -1 });
  const [preview, setPreview] = useState(false);
  const [hostId, setHostId] = useState<string | undefined>();
  const [mode, setMode] = useState("teacher");
  const [feedback, setFeedback] = useState("end");
  const [shuffleQuestions, setShuffleQuestions] = useState(false),
    [shuffleChoices, setShuffleChoices] = useState(false),
    [timerMode, setTimerMode] = useState("question"),
    [minutes, setMinutes] = useState(20);
  const [analysisData, setAnalysisData] = useState<any>(null),
    [draftList, setDraftList] = useState<any[]>([]),
    [restoredDraft, setRestoredDraft] = useState<any>(null);
  const editorDraft = useRef<DraftHandle>(null);
  async function request(body?: any, query = "", authToken = token) {
    return backendRequest(body, query, authToken);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function dashboard() {
    const d = await request();
    setAdmin(d.admin);
    if (d.admin) {
      setQuizzes(d.quizzes);
      setHistory(d.rooms);
      try {
        setDraftList(await request({ action: "draft_list" }));
      } catch {
        setDraftList([]);
      }
    }
  }
  function acceptRoom(r: any) {
    if (
      lastState.current.code === r.code &&
      r.revision < lastState.current.revision
    )
      return;
    lastState.current = { code: r.code, revision: r.revision };
    offset.current = r.serverNow - Date.now();
    setRoom(r);
    setOnline(true);
    const key = `${r.code}:${r.question?.id}`;
    if (lastQuestion.current !== key) {
      lastQuestion.current = key;
      setSelection(null);
    }
  }
  useEffect(() => {
    void dashboard().catch(() => {});
    const saved = sessionStorage.getItem(playerStorageKey);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        const requested = new URLSearchParams(location.search)
          .get("room")
          ?.toUpperCase();
        if (requested && requested !== p.code) {
          setCode(requested);
          setView("join");
          return;
        }
        setToken(p.token);
        setPlayerId(p.playerId);
        setCode(p.code);
        setView("player");
      } catch {}
    } else {
      const q = new URLSearchParams(location.search).get("room");
      if (q) {
        setCode(q.toUpperCase());
        setView("join");
      }
    }
  }, []);
  useEffect(() => {
    if (!["host", "player"].includes(view) || !code) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let eventTimer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let pending = false;
    let subscribed = false;
    let failures = 0;
    setLive(false);
    async function poll() {
      if (!active) return;
      if (inFlight) {
        pending = true;
        return;
      }
      clearTimeout(timer);
      inFlight = true;
      let nextDelay = cloudMode ? (subscribed ? 10000 : 2000) : 750;
      try {
        const r = await request(
          undefined,
          `?code=${encodeURIComponent(code)}${view === "host" ? "&host=1" : ""}`,
        );
        if (active) {
          acceptRoom(r);
          failures = 0;
          if (
            r.deadline &&
            r.phase !== "FINISHED" &&
            r.phase !== "ATTEMPT_FINISHED"
          )
            nextDelay = Math.min(
              nextDelay,
              Math.max(150, r.deadline - r.serverNow + 100),
            );
        }
      } catch (e) {
        if (active) {
          setOnline(false);
          setError((e as Error).message);
          failures++;
          nextDelay = Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
        }
      } finally {
        inFlight = false;
        if (active) {
          timer = setTimeout(poll, pending ? 80 : nextDelay);
          pending = false;
        }
      }
    }
    void poll();
    const unsubscribe = subscribeRoom(
      code,
      view === "host",
      () => {
        clearTimeout(eventTimer);
        eventTimer = setTimeout(poll, 80);
      },
      (connected) => {
        subscribed = connected;
        if (active) setLive(connected);
      },
    );
    const refresh = () => {
      if (!document.hidden) void poll();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(eventTimer);
      unsubscribe();
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [view, code, token]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const seconds = room?.deadline
    ? Math.max(0, Math.ceil((room.deadline - now - offset.current) / 1000))
    : 0;
  const revealed = ["ANSWER_REVEALED", "FINISHED"].includes(room?.phase);
  const host = view === "host";
  const locked =
    room?.phase !== "QUESTION_OPEN" || seconds <= 0 || room?.ownAnswer !== null;
  function go(view: string) {
    setError("");
    setNotice("");
    setView(view);
  }
  async function hostQuiz(id?: string) {
    const r = await request({
      action: "host",
      id,
      mode,
      feedback,
      shuffleQuestions,
      shuffleChoices,
      timerMode: mode === "self" ? timerMode : "question",
      quizDurationSeconds: minutes * 60,
    });
    setCode(r.code);
    setRoom(null);
    go("host");
  }
  async function control(action: string) {
    try {
      const r = await request({ action, code, revision: room.revision });
      acceptRoom(r);
    } catch (e) {
      const r = await request(undefined, `?code=${code}&host=1`);
      acceptRoom(r);
      throw e;
    }
  }
  function updateQuestion(index: number, changes: Partial<Question>) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i === index ? { ...q, ...changes } : q,
      ),
    }));
  }
  function leave() {
    if (busy) return;
    if (
      view === "editor" &&
      editorDraft.current?.isDirty() &&
      !confirm(
        "Leave before the draft finishes saving? Check the device recovery copy when you return.",
      )
    )
      return;
    go(admin ? "dashboard" : "home");
    setRoom(null);
    void dashboard();
  }
  async function exportCSV() {
    const { csv } = await request({ action: "export", code });
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `classroom-${code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function openAnalysis() {
    setAnalysisData(await request({ action: "session_analysis", code }));
    go("analysis");
  }
  async function resumeDraft(id: string) {
    const d = await request({ action: "draft_load", id });
    setRestoredDraft(d);
    if (d.kind === "editor") {
      setDraft(d.payload.quiz);
      go("editor");
    } else go("import");
  }
  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={leave}>
          <span className="brand-icon">
            C<span>•</span>
          </span>{" "}
          classroom<span className="brand-live">live</span>
        </button>
        <div className="top-actions">
          <span className="local-badge">
            {cloudMode ? "LIVE CLASSROOM" : "LOCAL WORKSPACE"}
          </span>
          {admin && (
            <button
              className="text-button"
              onClick={() =>
                run(async () => {
                  await request({ action: "logout" });
                  setAdmin(false);
                  go("home");
                })
              }
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="page">
        {error && (
          <div className="alert" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {view === "home" && (
          <>
            <section className="hero">
              <div className="eyebrow">
                <span className="dot" /> YOUR CLASS. ONE SHARED MOMENT.
              </div>
              <h1>
                Big questions.
                <br />
                <em>Brighter classrooms.</em>
              </h1>
              <p>
                A little friendly competition. A lot of discovery.
                <br />
                Join your class or bring your next quiz to life.
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={() => go("join")}>
                  Join a quiz <span>↗</span>
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    go(admin ? "dashboard" : "login");
                    void dashboard();
                  }}
                >
                  Host a session →
                </button>
              </div>
              <div className="hero-notes">
                <span>01 &nbsp; Join the room</span>
                <span>02 &nbsp; Think together</span>
                <span>03 &nbsp; See what you know</span>
              </div>
            </section>
            <section className="hero-art" aria-label="Live quiz illustration">
              <div className="art-orbit" />
              <div className="float-label">
                <span className="dot" /> EVERYONE'S IN
              </div>
              <div className="sample-card">
                <div className="card-meta">
                  CLASSROOM WARM-UP <span>01 / 03</span>
                </div>
                <h2>
                  Ready for your
                  <br />
                  lightbulb moment?
                </h2>
                <div className="sample-choice">
                  A <span>A fresh perspective</span>
                </div>
                <div className="sample-choice selected">
                  B <span>A little curiosity</span>
                  <b>✓</b>
                </div>
                <div className="sample-choice">
                  C <span>All of the above</span>
                </div>
                <div className="sample-bottom">
                  <span>✦ Made for your class</span>
                  <span>00:30</span>
                </div>
              </div>
              <div className="score-sticker">
                ✦<strong>Let's play.</strong>
                <span>Learning looks good on you.</span>
              </div>
            </section>
            <div className="home-footer">
              ONE QUESTION AT A TIME. EVERYONE TOGETHER.
              <span>Built for 40–50 curious minds.</span>
            </div>
          </>
        )}
        {view === "join" && (
          <section className="narrow">
            <button className="text-button" onClick={leave}>
              ← Back
            </button>
            <div className="eyebrow">TAKE YOUR SEAT</div>
            <h1>
              You're in the
              <br />
              <em>right place.</em>
            </h1>
            <p>
              Get the room code from your teacher and pick a name your class
              will recognize.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const p = await request({ action: "join", code, name });
                  sessionStorage.setItem(playerStorageKey, JSON.stringify(p));
                  setToken(p.token);
                  setPlayerId(p.playerId);
                  setCode(p.code);
                  setRoom(null);
                  go("player");
                });
              }}
            >
              <label>
                Room code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="E.g. A1B2C3"
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={30}
                  placeholder="What should we call you?"
                  required
                  autoComplete="nickname"
                />
              </label>
              <button className="primary full" disabled={busy}>
                Join the room →
              </button>
            </form>
          </section>
        )}
        {view === "login" && (
          <section className="narrow">
            <button className="text-button" onClick={leave}>
              ← Back
            </button>
            <div className="eyebrow">THE TEACHER'S DESK</div>
            <h1>
              Make room
              <br />
              for <em>curiosity.</em>
            </h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await request({ action: "login", email, password });
                  setPassword("");
                  await dashboard();
                  go("dashboard");
                });
              }}
            >
              {cloudMode && (
                <label>
                  Teacher email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="Your authorized teacher email"
                  />
                </label>
              )}
              <label>
                Admin password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button className="primary full" disabled={busy}>
                Open dashboard →
              </button>
            </form>
            <p className="small">
              {cloudMode
                ? "Use the teacher account created in Supabase and authorized by your project owner. Students join without an email or password."
                : "Use your locally configured administrator password."}
            </p>
          </section>
        )}
        {view === "dashboard" && (
          <>
            <div className="section-heading">
              <div>
                <div className="eyebrow">THE TEACHER'S DESK</div>
                <h1>
                  Your next <em>great question.</em>
                </h1>
                <p>
                  Create a quiz, gather your class, and let curiosity take over.
                </p>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => {
                    setRestoredDraft(null);
                    go("import");
                  }}
                >
                  ↑ Import quiz
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setDraft(freshQuiz());
                    setRestoredDraft(null);
                    go("editor");
                  }}
                >
                  + Create quiz
                </button>
              </div>
            </div>
            <div className="section-title">
              Your quizzes <span>{quizzes.length} in your collection</span>
            </div>
            <div className="quiz-grid">
              {quizzes.map((q, i) => (
                <article className="quiz-card" key={q.id}>
                  <div className={`quiz-cover cover-${i % 3}`}>
                    <span>CLASSROOM COLLECTION</span>
                    <strong>{["✦", "↗", "◎"][i % 3]}</strong>
                    <small>{String(i + 1).padStart(2, "0")}</small>
                  </div>
                  <div className="quiz-info">
                    <span className="eyebrow">
                      {q.questions.length} QUESTIONS · LIVE QUIZ
                    </span>
                    <h2>{q.title}</h2>
                    <div className="quiz-buttons">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => {
                          setHostId(q.id);
                          setMode("teacher");
                          setShuffleQuestions(false);
                          setShuffleChoices(false);
                          setTimerMode("question");
                          setMinutes(20);
                          setFeedback("end");
                          go("setup");
                        }}
                      >
                        Host quiz ↗
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          setDraft(structuredClone(q));
                          setRestoredDraft(null);
                          go("editor");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button"
                        aria-label={`Duplicate ${q.title}`}
                        onClick={() => {
                          setDraft({
                            ...structuredClone(q),
                            id: undefined,
                            title: `${q.title} (copy)`,
                          });
                          setRestoredDraft(null);
                          go("editor");
                        }}
                      >
                        Copy
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete “${q.title}”? Existing games keep their copy.`,
                            )
                          )
                            void run(async () => {
                              await request({ action: "delete", id: q.id });
                              await dashboard();
                            });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="section-title history-title">
              Private drafts <span>Resume unfinished work</span>
            </div>
            {!draftList.length ? (
              <p className="small">Drafts appear here after autosave.</p>
            ) : (
              <div className="history">
                {draftList.map((d) => (
                  <div className="draft-list-row" key={d.id}>
                    <button
                      className="text-button"
                      onClick={() => run(() => resumeDraft(d.id))}
                    >
                      {d.title || "Untitled draft"} · {d.kind} · Resume →
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => {
                        if (
                          confirm(
                            "Discard this cloud draft? Your published quizzes stay unchanged.",
                          )
                        )
                          void run(async () => {
                            await request({
                              action: "draft_discard",
                              id: d.id,
                              revision: d.revision,
                            });
                            await dashboard();
                          });
                      }}
                    >
                      Discard
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="section-title history-title">
              Recent sessions <span>Resume a room or review results</span>
            </div>
            {history.length === 0 ? (
              <div className="empty">
                Your first live session starts here. Host a quiz above.
              </div>
            ) : (
              <div className="history">
                {history.map((r) => (
                  <button
                    key={r.code}
                    onClick={() => {
                      setCode(r.code);
                      setRoom(null);
                      go("host");
                    }}
                  >
                    <div>
                      <strong>{r.title}</strong>
                      <small>
                        {new Date(r.createdAt).toLocaleString()} · {r.players}{" "}
                        players
                      </small>
                    </div>
                    <span className="pill">{r.phase.replaceAll("_", " ")}</span>
                    <b>{r.code} →</b>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {view === "analysis" && analysisData && (
          <Analysis data={analysisData} onBack={leave} />
        )}
        {view === "import" && (
          <ImportQuiz
            restore={restoredDraft}
            busy={busy}
            onBack={leave}
            onSave={async (imported, publish) => {
              setBusy(true);
              setError("");
              try {
                const quiz = {
                  title: imported.title.trim(),
                  questions: imported.questions.map(
                    ({ prompt, choices, correct, seconds, explanation }) => ({
                      prompt: prompt.trim(),
                      choices: choices.map((c) => c.trim()),
                      correct,
                      seconds,
                      explanation,
                    }),
                  ),
                };
                await publish();
                await dashboard();
                go("dashboard");
                setNotice(
                  `Imported ${quiz.questions.length} questions. Ready to host in either mode.`,
                );
                return true;
              } catch (e) {
                setError((e as Error).message);
                return false;
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {view === "setup" && (
          <section className="narrow session-setup">
            <button className="text-button" onClick={leave}>
              ← Your quizzes
            </button>
            <div className="eyebrow">MAKE IT YOUR SESSION</div>
            <h1>
              Choose the <em>pace.</em>
            </h1>
            <p>{quizzes.find((q) => q.id === hostId)?.title}</p>
            <fieldset>
              <legend>How should students progress?</legend>
              <label
                className={`mode-option ${mode === "teacher" ? "chosen" : ""}`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="teacher"
                  checked={mode === "teacher"}
                  onChange={() => setMode("teacher")}
                />
                <span>
                  <strong>Teacher-paced</strong>
                  <small>
                    You control each question, answer reveal, and next step.
                  </small>
                </span>
              </label>
              <label
                className={`mode-option ${mode === "self" ? "chosen" : ""}`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="self"
                  checked={mode === "self"}
                  onChange={() => setMode("self")}
                />
                <span>
                  <strong>Self-paced</strong>
                  <small>
                    Start once. Students answer and move ahead independently.
                  </small>
                </span>
              </label>
            </fieldset>
            {mode === "self" && (
              <fieldset>
                <legend>When should answers appear?</legend>
                <label
                  className={`mode-option ${feedback === "each" ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="feedback"
                    checked={feedback === "each"}
                    onChange={() => setFeedback("each")}
                  />
                  <span>
                    <strong>After each question</strong>
                    <small>
                      Show correctness and explanation after submission or
                      timeout.
                    </small>
                  </span>
                </label>
                <label
                  className={`mode-option ${feedback === "end" ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="feedback"
                    checked={feedback === "end"}
                    onChange={() => setFeedback("end")}
                  />
                  <span>
                    <strong>After finishing the quiz</strong>
                    <small>
                      Hide scores and answers until that student finishes. Then
                      show their complete review.
                    </small>
                  </span>
                </label>
                <p className="small">
                  An early finisher can review answers while classmates are
                  still answering.
                </p>
                <label
                  className={`mode-option ${feedback === "session_end" ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="feedback"
                    checked={feedback === "session_end"}
                    onChange={() => setFeedback("session_end")}
                  />
                  <span>
                    <strong>After the whole session ends</strong>
                    <small>
                      Early finishers wait. No scores or answers until everyone
                      finishes or you close the session.
                    </small>
                  </span>
                </label>
              </fieldset>
            )}
            <fieldset>
              <legend>Randomization</legend>
              <label>
                <input
                  type="checkbox"
                  checked={shuffleQuestions}
                  onChange={(e) => setShuffleQuestions(e.target.checked)}
                />{" "}
                Shuffle questions{" "}
                {mode === "teacher"
                  ? "(one shared sequence)"
                  : "(individual sequences)"}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={shuffleChoices}
                  onChange={(e) => setShuffleChoices(e.target.checked)}
                />{" "}
                Shuffle choices for each student
              </label>
              <p className="small">
                With shuffled choices, reveal by answer text—students may see
                different letters.
              </p>
            </fieldset>
            {mode === "self" && (
              <fieldset>
                <legend>Timing</legend>
                <label className="mode-option">
                  <input
                    type="radio"
                    name="timing"
                    checked={timerMode === "question"}
                    onChange={() => setTimerMode("question")}
                  />{" "}
                  Individual question timers
                </label>
                <label className="mode-option">
                  <input
                    type="radio"
                    name="timing"
                    checked={timerMode === "quiz"}
                    onChange={() => setTimerMode("quiz")}
                  />{" "}
                  One whole-quiz timer
                </label>
                {timerMode === "quiz" && (
                  <label>
                    Total minutes (1–180)
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />
                    <small>
                      Starts when you start the class. Continues between
                      questions, through feedback, and during disconnections.
                    </small>
                  </label>
                )}
              </fieldset>
            )}
            <button
              className="primary full"
              disabled={
                busy ||
                (mode === "self" &&
                  timerMode === "quiz" &&
                  (!Number.isInteger(minutes) || minutes < 1 || minutes > 180))
              }
              onClick={() => run(() => hostQuiz(hostId))}
            >
              Create lobby →
            </button>
            <p className="small">
              Mode and feedback are fixed for this session. Students join the
              lobby before you start.
            </p>
          </section>
        )}
        {view === "editor" && (
          <fieldset className="editor-fields" disabled={busy}>
            <div className="section-heading">
              <div>
                <button className="text-button" onClick={leave}>
                  ← Your quizzes
                </button>
                <h1>
                  Shape the <em>challenge.</em>
                </h1>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "Back to editing" : "Preview"}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await editorDraft.current!.publish();
                      await dashboard();
                      go("dashboard");
                      setNotice("Quiz saved. Ready when your class is.");
                    })
                  }
                >
                  Save quiz ✓
                </button>
              </div>
            </div>
            <label className="title-input">
              Quiz title
              <input
                placeholder="Give your quiz a name"
                value={draft.title}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <DraftPanel
              ref={editorDraft}
              kind="editor"
              payload={{ quiz: draft }}
              restore={restoredDraft}
              onRecover={(p) => setDraft(p.quiz)}
            />
            {draft.questions.map((q, i) => (
              <article className="editor-card" key={i}>
                <div className="editor-toolbar">
                  <span className="eyebrow">
                    QUESTION {i + 1} / {draft.questions.length}
                  </span>
                  {!preview && (
                    <div className="button-row">
                      <button
                        disabled={i === 0}
                        onClick={() =>
                          setDraft((d) => {
                            const a = [...d.questions];
                            [a[i - 1], a[i]] = [a[i], a[i - 1]];
                            return { ...d, questions: a };
                          })
                        }
                      >
                        ↑ Move up
                      </button>
                      <button
                        disabled={i === draft.questions.length - 1}
                        onClick={() =>
                          setDraft((d) => {
                            const a = [...d.questions];
                            [a[i], a[i + 1]] = [a[i + 1], a[i]];
                            return { ...d, questions: a };
                          })
                        }
                      >
                        ↓ Move down
                      </button>
                      <button
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            questions: [
                              ...d.questions.slice(0, i + 1),
                              structuredClone(q),
                              ...d.questions.slice(i + 1),
                            ],
                          }))
                        }
                      >
                        Duplicate
                      </button>
                      <button
                        className="danger-text"
                        disabled={draft.questions.length === 1}
                        onClick={() => {
                          if (confirm("Delete this question?"))
                            setDraft((d) => ({
                              ...d,
                              questions: d.questions.filter((_, j) => j !== i),
                            }));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {preview ? (
                  <>
                    <h2>{q.prompt || "Your question goes here"}</h2>
                    <div className="choice-grid">
                      {q.choices.map((c, n) => (
                        <div
                          className={`choice ${n === q.correct ? "correct" : ""}`}
                          key={n}
                        >
                          <b>{letters[n]}</b>
                          {c || "Choice text"}
                          {n === q.correct && <span>✓ Correct</span>}
                        </div>
                      ))}
                    </div>
                    <p>
                      {q.seconds} seconds · {q.explanation}
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Question
                      <textarea
                        value={q.prompt}
                        maxLength={2000}
                        placeholder="What would you like to ask?"
                        onChange={(e) =>
                          updateQuestion(i, { prompt: e.target.value })
                        }
                      />
                    </label>
                    <div className="editor-choices">
                      {q.choices.map((c, n) => (
                        <div className="edit-choice" key={n}>
                          <input
                            type="radio"
                            name={`correct-${i}`}
                            aria-label={`Mark choice ${letters[n]} correct`}
                            checked={q.correct === n}
                            onChange={() => updateQuestion(i, { correct: n })}
                          />
                          <span>{letters[n]}</span>
                          <input
                            aria-label={`Question ${i + 1} choice ${letters[n]}`}
                            value={c}
                            placeholder="Answer choice"
                            maxLength={500}
                            onChange={(e) =>
                              updateQuestion(i, {
                                choices: q.choices.map((s, j) =>
                                  j === n ? e.target.value : s,
                                ),
                              })
                            }
                          />
                          <button
                            aria-label={`Remove choice ${letters[n]}`}
                            disabled={q.choices.length <= 2}
                            onClick={() =>
                              updateQuestion(i, {
                                choices: q.choices.filter((_, j) => j !== n),
                                correct:
                                  q.correct === n
                                    ? 0
                                    : q.correct > n
                                      ? q.correct - 1
                                      : q.correct,
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="editor-bottom">
                      <button
                        className="text-button"
                        disabled={q.choices.length >= 6}
                        onClick={() =>
                          updateQuestion(i, { choices: [...q.choices, ""] })
                        }
                      >
                        + Add choice
                      </button>
                      <span className="small">
                        Select the circle beside the correct answer.
                      </span>
                      <label>
                        Seconds
                        <input
                          type="number"
                          min={5}
                          max={300}
                          value={q.seconds}
                          onChange={(e) =>
                            updateQuestion(i, {
                              seconds: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Explanation{" "}
                      <span className="muted">(optional, shown on reveal)</span>
                      <textarea
                        rows={2}
                        value={q.explanation}
                        maxLength={2000}
                        onChange={(e) =>
                          updateQuestion(i, { explanation: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
              </article>
            ))}
            {!preview && (
              <button
                className="add-question"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    questions: [...d.questions, blankQuestion()],
                  }))
                }
              >
                + Add another question
              </button>
            )}
          </fieldset>
        )}
        {["host", "player"].includes(view) && !room && (
          <div className="empty">Connecting to your classroom…</div>
        )}
        {["host", "player"].includes(view) && room && (
          <>
            <div className="game-top">
              <button className="text-button" onClick={leave}>
                ← {host ? "Dashboard" : "Home"}
              </button>
              <span className={`connection ${online ? "" : "offline"}`}>
                ●{" "}
                {online
                  ? cloudMode
                    ? live
                      ? "Live connection"
                      : "Connected · checking updates"
                    : "Connected · local sync"
                  : "Reconnecting…"}
              </span>
              <span className="pill">ROOM {room.code}</span>
            </div>
            {room.phase === "LOBBY" ? (
              <section className="lobby">
                <div className="eyebrow">
                  {host ? "INVITE A LITTLE COMPETITION" : "YOU’RE ON THE LIST"}
                </div>
                <h1>
                  {host ? (
                    <>
                      Your classroom,
                      <br />
                      <em>coming together.</em>
                    </>
                  ) : (
                    <>
                      Take a breath.
                      <br />
                      <em>You're up soon.</em>
                    </>
                  )}
                </h1>
                <p>{room.title}</p>
                {host && <LobbyQR code={room.code} />}
                <p className="small">
                  {room.mode === "self"
                    ? `Self-paced · Answers ${room.feedback === "each" ? "after each question" : room.feedback === "session_end" ? "after the whole session ends" : "after finishing the quiz"}`
                    : "Teacher-paced · Your teacher controls the next question"}
                </p>
                {host ? (
                  <div className="room-code">
                    <span>JOIN WITH THIS CODE</span>
                    <strong>{room.code}</strong>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await navigator.clipboard.writeText(
                            `${location.origin}/?room=${room.code}`,
                          );
                          setNotice("Join link copied.");
                        })
                      }
                    >
                      Copy join link ↗
                    </button>
                  </div>
                ) : (
                  <div className="waiting">
                    <span className="dot" /> Waiting for your teacher to start
                  </div>
                )}
                <div className="lobby-roster">
                  <div className="section-title">
                    The curious crowd{" "}
                    <span>{room.players.length} / 50 joined</span>
                  </div>
                  <div className="players">
                    {room.players.map((p: any, i: number) => (
                      <div
                        className={`player-chip ${p.id === playerId ? "you" : ""}`}
                        key={p.id}
                      >
                        <span className={`avatar avatar-${i % 4}`}>
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        {p.name}
                        {p.id === playerId && <small>You</small>}
                        {host && (
                          <button
                            aria-label={`Remove ${p.name}`}
                            onClick={() =>
                              run(async () =>
                                acceptRoom(
                                  await request({
                                    action: "remove",
                                    code,
                                    playerId: p.id,
                                  }),
                                ),
                              )
                            }
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {!room.players.length && (
                      <p>Share the code. Your students will appear here.</p>
                    )}
                  </div>
                </div>
                {host && (
                  <button
                    className="primary"
                    disabled={busy || !room.players.length}
                    onClick={() => run(() => control("start"))}
                  >
                    Start the quiz →
                  </button>
                )}
              </section>
            ) : room.mode === "self" ? (
              <SelfSession
                room={room}
                host={host}
                seconds={seconds}
                selection={selection}
                busy={busy}
                online={online}
                onSelect={setSelection}
                onAnswer={() =>
                  run(async () =>
                    acceptRoom(
                      await request({
                        action: "answer",
                        code,
                        questionId: room.question.id,
                        choice: selection,
                        choiceId: room.question.choiceIds?.[selection!],
                      }),
                    ),
                  )
                }
                onNext={() =>
                  run(async () =>
                    acceptRoom(
                      await request({
                        action: "next_self",
                        code,
                        questionId: room.question.id,
                      }),
                    ),
                  )
                }
                onClose={() => {
                  if (
                    confirm(
                      "Close this session for everyone? Remaining unanswered questions receive zero points.",
                    )
                  )
                    void run(() => control("close_session"));
                }}
                onExport={() => run(exportCSV)}
              />
            ) : room.phase === "CANCELLED" ? (
              <section className="narrow">
                <h1>
                  Session <em>ended.</em>
                </h1>
                <p>
                  Your teacher ended this game early. Scores cover{" "}
                  {room.revealedCount} revealed questions.
                </p>
                {host && (
                  <button className="secondary" onClick={() => run(exportCSV)}>
                    Export partial results
                  </button>
                )}
              </section>
            ) : room.phase === "FINISHED" ? (
              <section className="results">
                <div className="eyebrow">A ROUND OF APPLAUSE</div>
                <h1>
                  Curiosity <em>takes the podium.</em>
                </h1>
                <p>
                  {room.title} · {room.total} questions · {room.players.length}{" "}
                  players
                </p>
                <div className="leaderboard">
                  {room.leaderboard.map((p: any) => (
                    <div
                      className={p.id === playerId ? "my-row" : ""}
                      key={p.id}
                    >
                      <span className="rank">
                        {p.rank <= 3
                          ? ["🥇", "🥈", "🥉"][p.rank - 1]
                          : `#${p.rank}`}
                      </span>
                      <strong>
                        {p.name} {p.id === playerId && <small>(You)</small>}
                      </strong>
                      <span>
                        {p.score}
                        <small> / {room.total}</small>
                      </span>
                    </div>
                  ))}
                </div>
                {host && (
                  <div className="button-row">
                    <button className="primary" onClick={() => run(exportCSV)}>
                      Download results ↓
                    </button>
                    <button className="secondary" onClick={leave}>
                      Back to quizzes
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <section className="question-stage">
                <div className="question-meta">
                  <span className="eyebrow">{room.title}</span>
                  <span>
                    QUESTION {room.index + 1} OF {room.total}
                  </span>
                  {!host && (
                    <strong>
                      Score {room.score} / {room.total}
                    </strong>
                  )}
                </div>
                <div className="timer-track">
                  <div
                    style={{
                      width: `${room.phase === "QUESTION_OPEN" ? Math.min(100, (seconds / room.question.seconds) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="question-heading">
                  <h1>{room.question.prompt}</h1>
                  <div
                    className={`timer ${seconds <= 5 && !revealed ? "urgent" : ""}`}
                  >
                    {room.phase === "QUESTION_OPEN"
                      ? seconds
                      : revealed
                        ? "✓"
                        : "0"}
                    <small>{revealed ? "REVEALED" : "SECONDS"}</small>
                  </div>
                </div>
                <div className="choice-grid">
                  {room.question.choices.map((c: string, i: number) => {
                    const own = room.ownAnswer === i;
                    const correct = revealed && room.question.correct === i;
                    const wrong = revealed && own && !correct;
                    return (
                      <button
                        key={i}
                        className={`choice choice-${i % 4} ${!revealed && (selection === i || own) ? "picked" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                        disabled={host || locked || busy}
                        onClick={() => setSelection(i)}
                      >
                        <b>{letters[i]}</b>
                        <span>{c}</span>
                        {correct && <strong>✓ Correct</strong>}
                        {wrong && <strong>✕ Your answer</strong>}
                        {!revealed && own && <strong>Submitted</strong>}
                      </button>
                    );
                  })}
                </div>
                <div className="answer-status" aria-live="polite">
                  {revealed ? (
                    <>
                      <strong>
                        {host
                          ? "The answer is out. Give your class a moment."
                          : room.ownAnswer === null
                            ? "Time’s up — no answer submitted. +0 points"
                            : room.ownAnswer === room.question.correct
                              ? "✓ You got it! +1 point"
                              : "Not this time. +0 points"}
                      </strong>
                      <p>{room.question.explanation}</p>
                    </>
                  ) : host ? (
                    <strong>
                      {room.submitted} / {room.players.length} answers submitted
                    </strong>
                  ) : room.ownAnswer !== null ? (
                    <strong>✓ Answer submitted. Waiting for the reveal.</strong>
                  ) : room.phase === "QUESTION_OPEN" && seconds > 0 ? (
                    <>
                      <span>
                        Select an answer, then submit. You can’t change it
                        afterward.
                      </span>
                      <button
                        className="primary"
                        disabled={busy || selection === null || !online}
                        onClick={() =>
                          run(async () =>
                            acceptRoom(
                              await request({
                                action: "answer",
                                code,
                                questionId: room.question.id,
                                choice: selection,
                                choiceId: room.question.choiceIds?.[selection!],
                              }),
                            ),
                          )
                        }
                      >
                        Submit answer →
                      </button>
                    </>
                  ) : (
                    <strong>
                      Answers locked. Waiting for your teacher to reveal.
                    </strong>
                  )}
                </div>
                {host && (
                  <div className="host-controls">
                    <span className="small">You set the pace.</span>
                    {room.phase === "QUESTION_OPEN" && (
                      <button
                        className="primary"
                        disabled={
                          busy || room.submitted !== room.players.length
                        }
                        onClick={() => run(() => control("close"))}
                      >
                        Close answers early
                      </button>
                    )}
                    {room.phase === "QUESTION_LOCKED" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(() => control("reveal"))}
                      >
                        Show answer ✦
                      </button>
                    )}
                    {room.phase === "ANSWER_REVEALED" && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            control(
                              room.index === room.total - 1 ? "finish" : "next",
                            ),
                          )
                        }
                      >
                        {room.index === room.total - 1
                          ? "Show final results →"
                          : "Next question →"}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {host && room.phase !== "LOBBY" && (
              <div className="end-session">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => run(openAnalysis)}
                >
                  Question results dashboard →
                </button>
              </div>
            )}
            {host &&
              (room.mode !== "self" || room.phase === "LOBBY") &&
              !["FINISHED", "CANCELLED"].includes(room.phase) && (
                <div className="end-session">
                  <button
                    className="danger-text"
                    onClick={() => {
                      if (
                        confirm(
                          "End this session early? It will be saved as incomplete.",
                        )
                      )
                        void run(() => control("cancel"));
                    }}
                  >
                    End session
                  </button>
                </div>
              )}
          </>
        )}
      </div>
      <footer className="footer">
        <span>classroom live</span>
        <span>
          {cloudMode
            ? "One question at a time. Everyone together."
            : "Local development · saved on this computer"}
        </span>
      </footer>
    </main>
  );
}
