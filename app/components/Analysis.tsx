"use client";
import { useState } from "react";
const percent = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;
export default function Analysis({
  data,
  onBack,
}: {
  data: any;
  onBack: () => void;
}) {
  const [missed, setMissed] = useState(true);
  const rows = [...data.questions].sort((a, b) =>
    missed
      ? (a.correctRate ?? 0) - (b.correctRate ?? 0) ||
        a.sourceIndex - b.sourceIndex
      : a.sourceIndex - b.sourceIndex,
  );
  function csv() {
    const esc = (v: unknown) =>
      '"' +
      String(v)
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const lines = [
      [
        "Question",
        "Eligible",
        "Reached",
        "Submitted",
        "Correct",
        "Incorrect",
        "Unanswered",
        "Correct rate",
        "Submission accuracy",
        "Median response milliseconds",
        "Timing samples",
      ],
      ...rows.map((q) => [
        q.prompt,
        q.eligible,
        q.reached ?? "Unavailable",
        q.submitted,
        q.correct,
        q.incorrect,
        q.unanswered ?? "Not final",
        q.correctRate ?? "",
        q.submissionAccuracy ?? "",
        q.medianResponseMs ?? "Unavailable",
        q.timingSamples,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + lines.map((row) => row.map(esc).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "question-analysis.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        ← Back to sessions
      </button>
      <div className="section-heading">
        <div>
          <div className="eyebrow">WHAT YOUR CLASS KNOWS</div>
          <h1>
            Look beyond <em>the score.</em>
          </h1>
          <p>
            {data.title} · {data.eligible} students · {data.phase} · {data.mode}
          </p>
        </div>
        <button className="secondary" onClick={csv}>
          Download question summary ↓
        </button>
      </div>
      <p className="small">
        Correct rate uses all eligible students. Submission accuracy uses
        accepted submissions only. Unanswered is final only for finished
        sessions. Missing historical reach/timing is shown as unavailable.
      </p>
      <button className="text-button" onClick={() => setMissed(!missed)}>
        Order: {missed ? "Most missed first" : "Quiz order"} ⇅
      </button>
      {rows.map((q) => (
        <details className="import-question" key={q.id}>
          <summary>
            <span>
              {q.sourceIndex + 1}. {q.prompt}
            </span>
            <strong>{percent(q.correctRate)} correct</strong>
          </summary>
          <div className="import-question-body">
            <div className="metric-grid">
              <span>
                Submitted{" "}
                <b>
                  {q.submitted}/{q.eligible}
                </b>
              </span>
              <span>
                Correct <b>{q.correct}</b>
              </span>
              <span>
                Incorrect submissions <b>{q.incorrect}</b>
              </span>
              <span>
                Unanswered <b>{q.unanswered ?? "Not final"}</b>
              </span>
              <span>
                Reached <b>{q.reached ?? "Unavailable"}</b>
              </span>
              <span>
                Submission accuracy <b>{percent(q.submissionAccuracy)}</b>
              </span>
              <span>
                Median response{" "}
                <b>
                  {q.medianResponseMs === null
                    ? "Unavailable"
                    : `${(q.medianResponseMs / 1000).toFixed(1)} s`}
                </b>{" "}
                ({q.timingSamples} samples)
              </span>
            </div>
            {q.distribution.map((d: any, i: number) => (
              <div
                className={`analysis-choice ${i === q.correctChoice ? "correct" : ""}`}
                key={i}
              >
                <span>
                  {d.text}
                  {i === q.correctChoice ? " ✓ Correct" : ""}
                </span>
                <strong>{d.count}</strong>
              </div>
            ))}
            <p>{q.explanation}</p>
          </div>
        </details>
      ))}
    </section>
  );
}
