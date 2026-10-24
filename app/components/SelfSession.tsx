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
      <section className="teacher-live-dashboard">
        <div className="teacher-session-tags">
          <span className="teacher-live-tag">
            <span aria-hidden="true">●</span> Self-paced session
          </span>
          <span className="teacher-feedback-tag">
            {room.feedback === "each"
              ? "Feedback after each question"
              : room.feedback === "session_end"
                ? "Feedback after session ends"
                : "Feedback after finishing"}
          </span>
        </div>
        <div className="teacher-live-heading">
          <div>
            <h1>{room.title}</h1>
            <p>{room.total} questions · Students move at their own pace.</p>
          </div>
          {room.timerMode === "quiz" && (
            <div className="teacher-time-left" role="timer">
              <span>Quiz time left</span>
              <strong>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </strong>
            </div>
          )}
        </div>
        <div className="teacher-class-summary">
          <div className="teacher-stat-grid">
            <div>
              <span>Students</span>
              <strong>{room.players.length}</strong>
            </div>
            <div className="teacher-finished-stat">
              <span>Finished</span>
              <strong>{room.finishedCount}</strong>
            </div>
            <div>
              <span>Still working</span>
              <strong>
                {Math.max(0, room.players.length - room.finishedCount)}
              </strong>
            </div>
          </div>
          <div className="teacher-completion-label">
            <span>Class completion</span>
            <strong>
              {room.players.length
                ? Math.round((room.finishedCount / room.players.length) * 100)
                : 0}
              %
            </strong>
          </div>
          <div
            className="teacher-completion-track"
            role="progressbar"
            aria-label="Students finished"
            aria-valuemin={0}
            aria-valuemax={room.players.length || 1}
            aria-valuenow={room.finishedCount}
          >
            <div
              style={{
                width: `${room.players.length ? (room.finishedCount / room.players.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="teacher-roster-heading">
          <h2>Student progress</h2>
          <span>{room.progress.length} in this session</span>
        </div>
        <div
          className="teacher-roster"
          role="list"
          aria-label="Student progress"
        >
          {room.progress.map((p: any) => (
            <div className="teacher-student-row" role="listitem" key={p.id}>
              <div className="teacher-student-identity">
                <span className="teacher-student-avatar" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <strong>{p.name}</strong>
              </div>
              <div className="teacher-student-position">
                <small>Progress</small>
                <span>
                  {p.status === "FINISHED"
                    ? "Completed"
                    : `Question ${p.index + 1} / ${room.total}`}
                </span>
              </div>
              <div className="teacher-student-submitted">
                <small>Answers submitted</small>
                <span>
                  <b>{p.answered}</b> / {room.total}
                </span>
                <div className="teacher-answer-track">
                  <div
                    style={{ width: `${(p.answered / room.total) * 100}%` }}
                  />
                </div>
              </div>
              <span
                className={`teacher-student-status ${p.status === "FINISHED" ? "is-finished" : p.status === "OPEN" ? "is-answering" : "is-waiting"}`}
              >
                <span aria-hidden="true">
                  {p.status === "FINISHED" ? "✓" : "●"}
                </span>
                {p.status === "FINISHED"
                  ? "Finished"
                  : p.status === "OPEN"
                    ? "Answering"
                    : "Between questions"}
              </span>
            </div>
          ))}
        </div>
        <div className="teacher-session-controls">
          <div>
            <strong>Ready to wrap up?</strong>
            <p>
              Results open automatically when everyone finishes. Closing now
              ends all remaining attempts; unanswered questions receive zero.
            </p>
          </div>
          <button className="primary" disabled={busy} onClick={onClose}>
            Close session & show results
          </button>
        </div>
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
    <section className="question-stage self-question-stage">
      <div className="self-session-meta">
        <div className="self-quiz-identity">
          <span className="self-mode-label">Self-paced quiz</span>
          <span className="self-quiz-title">{room.title}</span>
        </div>
        <strong className="self-score-chip">
          {room.score === null
            ? room.feedback === "session_end"
              ? "Score after session ends"
              : "Score after finishing"
            : `Score ${room.score} / ${room.total}`}
        </strong>
      </div>
      <div className="self-progress-label">
        <span>
          Question <b>{room.index + 1}</b> of {room.total}
        </span>
        <span>{Math.round(((room.index + 1) / room.total) * 100)}%</span>
      </div>
      <div
        className="self-progress-track"
        role="progressbar"
        aria-label="Current question"
        aria-valuemin={0}
        aria-valuemax={room.total}
        aria-valuenow={room.index + 1}
      >
        <div
          style={{
            width: `${((room.index + 1) / room.total) * 100}%`,
          }}
        />
      </div>
      <div className="self-question-tools">
        <span>
          {revealed
            ? "Answer review"
            : open
              ? "Choose one answer"
              : "Answer locked"}
        </span>
        <div className={`timer ${open && seconds <= 5 ? "urgent" : ""}`}>
          <span className="self-timer-value">
            {room.timerMode === "quiz" && seconds > 0
              ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : open
                ? seconds
                : revealed
                  ? "✓"
                  : "—"}
          </span>
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
      <div className="question-heading">
        <h1>{q.prompt}</h1>
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
          <div
            className={`self-answer-feedback ${room.ownAnswer !== null && room.ownAnswer === q.correct ? "is-correct" : "is-incorrect"}`}
          >
            <strong>
              {room.ownAnswer === null
                ? "Time’s up — no answer. +0 points"
                : room.ownAnswer === q.correct
                  ? "✓ Correct! +1 point"
                  : "Incorrect. +0 points"}
            </strong>
            {q.explanation && <p>{q.explanation}</p>}
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
      <p className="small self-question-note">
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
