"use client";
type Props = {
  room: any;
  host: boolean;
  seconds: number;
  selection: number | null;
  busy: boolean;
  online: boolean;
  onSelect: (choice: number) => void;
  onAnswer: () => void;
  onNext: () => void;
  onClose: () => void;
  onExport: () => void;
};
const letters = ["A", "B", "C", "D", "E", "F"];
function Review({ items }: { items: any[] }) {
  return (
    <section className="attempt-review">
      <div className="section-title">Your answer review</div>
      {items.map((q, i) => (
        <article className="editor-card" key={i}>
          <div className="eyebrow">
            QUESTION {i + 1} ·{" "}
            {q.ownAnswer === null
              ? "NO ANSWER · 0 POINTS"
              : q.ownAnswer === q.correct
                ? "CORRECT · 1 POINT"
                : "INCORRECT · 0 POINTS"}
          </div>
          <h2>{q.prompt}</h2>
          <div className="choice-grid">
            {q.choices.map((c: string, n: number) => (
              <div
                key={n}
                className={`choice ${n === q.correct ? "correct" : ""} ${q.ownAnswer === n && n !== q.correct ? "wrong" : ""}`}
              >
                <b>{letters[n]}</b>
                <span>{c}</span>
                {n === q.correct && <strong>✓ Correct</strong>}
                {q.ownAnswer === n && <strong>Your answer</strong>}
              </div>
            ))}
          </div>
          {q.explanation && (
            <p className="review-explanation">{q.explanation}</p>
          )}
        </article>
      ))}
    </section>
  );
}
export default function SelfSession({
  room,
  host,
  seconds,
  selection,
  busy,
  online,
  onSelect,
  onAnswer,
  onNext,
  onClose,
  onExport,
}: Props) {
  const done = ["ATTEMPT_FINISHED", "FINISHED"].includes(room.phase);
  const revealed = room.phase === "ANSWER_REVEALED";
  const open = room.phase === "QUESTION_OPEN" && seconds > 0;
  if (room.phase === "CANCELLED")
    return (
      <section className="narrow">
        <h1>
          Session <em>cancelled.</em>
        </h1>
        <p>
          Your teacher ended this session. Your saved answers remain recorded.
        </p>
      </section>
    );
  if (host && room.phase !== "FINISHED")
    return (
      <section>
        <div className="eyebrow">
          SELF-PACED ·{" "}
          {room.feedback === "each"
            ? "FEEDBACK AFTER EACH QUESTION"
            : room.feedback === "session_end"
              ? "FEEDBACK AFTER SESSION ENDS"
              : "FEEDBACK AFTER FINISHING"}
        </div>
        <div className="section-heading">
          <div>
            <h1>
              Every mind.
              <br />
              <em>Its own rhythm.</em>
            </h1>
            <p>
              {room.title} · Students move through {room.total} questions
              independently.
            </p>
            {room.timerMode === "quiz" && (
              <p role="timer">
                Quiz time remaining: {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </p>
            )}
          </div>
          <div className="completion-stat">
            <strong>
              {room.finishedCount} / {room.players.length}
            </strong>
            <span>students finished</span>
          </div>
        </div>
        <div className="progress-table">
          <div className="progress-row progress-header">
            <span>Student</span>
            <span>Progress</span>
            <span>Submitted</span>
            <span>Status</span>
          </div>
          {room.progress.map((p: any) => (
            <div className="progress-row" key={p.id}>
              <strong>{p.name}</strong>
              <span>
                {p.status === "FINISHED"
                  ? "Completed"
                  : `Question ${p.index + 1} / ${room.total}`}
              </span>
              <span>
                {p.answered} / {room.total}
              </span>
              <span className="pill">
                {p.status === "FINISHED"
                  ? "Finished"
                  : p.status === "OPEN"
                    ? "Answering"
                    : "Between questions"}
              </span>
            </div>
          ))}
        </div>
        <div className="host-controls">
          <span className="small">
            Results open automatically when everyone finishes.
          </span>
          <button className="primary" disabled={busy} onClick={onClose}>
            Close session & show results
          </button>
        </div>
        <p className="small">
          Closing early ends every remaining attempt. All unanswered questions
          count as zero.
        </p>
      </section>
    );
  if (done)
    return (
      <section className="results">
        <div className="eyebrow">
          {room.phase === "FINISHED"
            ? "THE CLASS HAS FINISHED"
            : "YOUR ATTEMPT IS COMPLETE"}
        </div>
        <h1>
          {room.phase === "FINISHED" ? (
            <>
              Curiosity <em>takes the podium.</em>
            </>
          ) : (
            <>
              Well done.
              <br />
              <em>You made it.</em>
            </>
          )}
        </h1>
        <p>
          {room.title} · {room.total} questions
        </p>
        {!host && room.score !== null && (
          <div className="personal-score">
            Your score{" "}
            <strong>
              {room.score} / {room.total}
            </strong>
          </div>
        )}
        {room.phase === "ATTEMPT_FINISHED" && (
          <p>
            Your answers are locked. Final rankings appear when everyone
            finishes or your teacher closes the session.
          </p>
        )}
        {!host && room.score === null && (
          <p>
            Your attempt is complete. Scores and answers stay hidden until the
            whole session ends.
          </p>
        )}
        {!host && room.finishReason === "overall_timeout" && (
          <p>
            The whole-quiz timer expired. Your accepted answers were saved;
            unanswered questions receive zero.
          </p>
        )}
        {room.phase === "FINISHED" && (
          <div className="leaderboard">
            {room.leaderboard.map((p: any) => (
              <div key={p.id}>
                <span className="rank">#{p.rank}</span>
                <strong>{p.name}</strong>
                <span>
                  {p.score}
                  <small> / {room.total}</small>
                </span>
              </div>
            ))}
          </div>
        )}
        {host && (
          <button className="primary" disabled={busy} onClick={onExport}>
            Download results ↓
          </button>
        )}
        {!host && <Review items={room.review || []} />}
      </section>
    );
  const q = room.question;
  if (!q) return <div className="empty">Restoring your attempt…</div>;
  return (
    <section className="question-stage">
      <div className="question-meta">
        <span className="eyebrow">SELF-PACED · {room.title}</span>
        <span>
          QUESTION {room.index + 1} OF {room.total}
        </span>
        <strong>
          {room.score === null
            ? room.feedback === "session_end"
              ? "Score after session ends"
              : "Score after finishing"
            : `Score ${room.score} / ${room.total}`}
        </strong>
      </div>
      <div className="timer-track">
        <div
          style={{
            width: `${open ? Math.min(100, (seconds / (room.timerMode === "quiz" ? room.quizDurationSeconds : q.seconds)) * 100) : 0}%`,
          }}
        />
      </div>
      <div className="question-heading">
        <h1>{q.prompt}</h1>
        <div className={`timer ${open && seconds <= 5 ? "urgent" : ""}`}>
          {room.timerMode === "quiz" && seconds > 0
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : open
              ? seconds
              : revealed
                ? "✓"
                : "—"}
          <small>
            {room.timerMode === "quiz"
              ? "QUIZ TIME"
              : open
                ? "SECONDS"
                : revealed
                  ? "REVEALED"
                  : "LOCKED"}
          </small>
        </div>
      </div>
      <div className="choice-grid">
        {q.choices.map((c: string, i: number) => {
          const own = room.ownAnswer === i,
            correct = revealed && q.correct === i,
            wrong = revealed && own && !correct;
          return (
            <button
              key={i}
              className={`choice choice-${i % 4} ${!revealed && (selection === i || own) ? "picked" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
              disabled={!open || room.ownAnswer !== null || busy}
              onClick={() => onSelect(i)}
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
          <div>
            <strong>
              {room.ownAnswer === null
                ? "Time’s up — no answer. +0 points"
                : room.ownAnswer === q.correct
                  ? "✓ Correct! +1 point"
                  : "Incorrect. +0 points"}
            </strong>
            <p>{q.explanation}</p>
          </div>
        ) : !open ? (
          <strong>
            {room.ownAnswer === null
              ? "Time’s up. No answer submitted."
              : "Answer recorded."}{" "}
            {room.feedback === "end"
              ? "Correct answers and your score appear after you finish."
              : room.feedback === "session_end"
                ? "Correct answers and your score appear after the whole session ends."
                : "Waiting for your answer feedback…"}
          </strong>
        ) : (
          <span>Select your answer, then submit to lock it.</span>
        )}
        {open ? (
          <button
            className="primary"
            disabled={busy || selection === null || !online}
            onClick={onAnswer}
          >
            Submit answer →
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              busy ||
              !online ||
              room.phase === "QUESTION_OPEN" ||
              (room.timerMode === "quiz" && seconds <= 0)
            }
            onClick={onNext}
          >
            {room.index === room.total - 1
              ? "Finish quiz →"
              : "Next question →"}
          </button>
        )}
      </div>
      <p className="small">
        {room.feedback === "each"
          ? "Feedback appears after each question."
          : room.feedback === "session_end"
            ? "Scores and answer reviews appear only when the whole session ends."
            : "Your full answer review appears after you finish all questions."}{" "}
        {room.timerMode === "quiz"
          ? "The whole-quiz timer continues between questions and during disconnections."
          : "Each new timer starts when you click Next."}
      </p>
    </section>
  );
}
