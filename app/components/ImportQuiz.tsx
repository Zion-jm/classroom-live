"use client";
import { useState } from "react";
import { validateImportedQuestion } from "../../lib/quiz-import.mjs";
type Item = {
  source: string;
  prompt: string;
  choices: string[];
  correct: number;
  seconds: number;
  explanation: string;
  issues: { message: string; acknowledged: boolean }[];
};
type Result = { title: string; questions: Item[]; warnings: string[] };
export default function ImportQuiz({
  busy,
  onBack,
  onSave,
}: {
  busy: boolean;
  onBack: () => void;
  onSave: (quiz: { title: string; questions: Item[] }) => Promise<boolean>;
}) {
  const [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false),
    [seconds, setSeconds] = useState(30),
    [fileName, setFileName] = useState("");
  const [dirty, setDirty] = useState(false);
  async function load(file: File | undefined) {
    if (!file) return;
    if (
      result &&
      dirty &&
      !confirm(
        "Replace this import preview? Your unsaved review edits will be lost.",
      )
    )
      return;
    setError("");
    setReading(true);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a file smaller than 5 MB.");
      const { parseQuizFile } = await import("../../lib/quiz-import.mjs");
      const parsed = parseQuizFile(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        seconds,
      );
      setResult(parsed);
      setFileName(file.name);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  function change(index: number, patch: Partial<Item>) {
    setDirty(true);
    setResult(
      (r) =>
        r && {
          ...r,
          questions: r.questions.map((q, i) =>
            i === index ? { ...q, ...patch } : q,
          ),
        },
    );
  }
  const issues =
    result?.questions.reduce(
      (n, q) => n + q.issues.filter((i) => !i.acknowledged).length,
      0,
    ) || 0;
  const invalid =
    result?.questions.filter((q) => validateImportedQuestion(q).length) || [];
  const ready =
    !!result &&
    result.questions.length > 0 &&
    result.questions.length <= 100 &&
    result.title.trim().length > 0 &&
    result.title.length <= 120 &&
    issues === 0 &&
    invalid.length === 0;
  return (
    <section className="import-page">
      <button
        className="text-button"
        disabled={busy || reading}
        onClick={() => {
          if (
            !dirty ||
            confirm("Leave this preview? Unsaved import edits will be lost.")
          )
            onBack();
        }}
      >
        ← Your quizzes
      </button>
      <div className="section-heading">
        <div>
          <div className="eyebrow">LESS TYPING. MORE TEACHING.</div>
          <h1>
            Bring your <em>questions.</em>
          </h1>
          <p>
            Import Word or Excel, review the answer key, then save all questions
            as one quiz.
          </p>
        </div>
      </div>
      <div className="import-help">
        <strong>Word (.docx)</strong>
        <p>
          Use numbered questions (1., 2.) and lettered choices (A., B.).
          Highlight exactly one correct choice, or bold only that choice. Notes
          after the choices become the explanation. Tables and explicit line
          breaks are supported; automatic list numbering, images, and complex
          layouts need review.
        </p>
        <strong>Excel (.xlsx)</strong>
        <p>
          Use a worksheet named <b>Questions</b> (or the first worksheet).
          Required headers: <b>Question, Choice A, Choice B, Correct answer</b>.
          Optional: <b>Choice C–F, Seconds, Explanation</b>. Correct answer can
          be A–F, 1–6, or unique matching choice text. Use plain values, not
          formulas.
        </p>
        <p className="small">
          Up to 100 questions · 2–6 choices each · 5 MB file limit · Files are
          parsed on this device. No document is uploaded.
        </p>
      </div>
      <div className="import-upload">
        <label>
          Default timer (when the file has no timer)
          <input
            type="number"
            min={5}
            max={300}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            disabled={reading || busy}
          />
        </label>
        <label>
          Choose a quiz file
          <input
            type="file"
            accept=".docx,.xlsx"
            disabled={reading || busy}
            onChange={(e) => {
              void load(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {reading && <p role="status">Reading your quiz…</p>}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {result && (
        <>
          <div className="import-summary" aria-live="polite">
            <strong>
              {result.questions.length} questions from {fileName}
            </strong>
            <span>
              {invalid.length} incomplete · {issues} source notes need review
            </span>
          </div>
          {result.warnings.map((warning, i) => (
            <div className="notice" key={i}>
              {warning}
            </div>
          ))}
          <label>
            Quiz title
            <input
              value={result.title}
              maxLength={120}
              disabled={busy}
              onChange={(e) => {
                setDirty(true);
                setResult({ ...result, title: e.target.value });
              }}
            />
          </label>
          <div className="button-row">
            <button
              className="secondary"
              disabled={
                busy ||
                reading ||
                !Number.isInteger(seconds) ||
                seconds < 5 ||
                seconds > 300
              }
              onClick={() => {
                setDirty(true);
                setResult({
                  ...result,
                  questions: result.questions.map((q) => ({ ...q, seconds })),
                });
              }}
            >
              Apply {seconds || "default"} seconds to all questions
            </button>
            <span className="small">
              Expand any question to edit. Flagged questions open automatically.
            </span>
          </div>
          {result.questions.map((q, i) => {
            const errors = validateImportedQuestion(q);
            return (
              <details
                className="import-question"
                key={`${q.source}:${i}`}
                open={
                  q.issues.some((issue) => !issue.acknowledged) ||
                  errors.length > 0
                    ? true
                    : undefined
                }
              >
                <summary>
                  <span>
                    {i + 1}. {q.prompt || "Missing question text"}
                  </span>
                  <span className="pill">
                    {errors.length
                      ? "Incomplete"
                      : q.issues.some((issue) => !issue.acknowledged)
                        ? "Review required"
                        : `${q.choices.length} choices · ${q.seconds}s`}
                  </span>
                </summary>
                <div className="import-question-body">
                  <div className="editor-toolbar">
                    <span className="eyebrow">SOURCE: {q.source}</span>
                    <button
                      className="danger-text"
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Remove this question from the import?")) {
                          setDirty(true);
                          setResult({
                            ...result,
                            questions: result.questions.filter(
                              (_, n) => n !== i,
                            ),
                          });
                        }
                      }}
                    >
                      Remove question
                    </button>
                  </div>
                  {errors.length > 0 && (
                    <div className="alert">
                      <ul>
                        {errors.map((e: string) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {q.issues.map((issue, n) => (
                    <label className="import-source-note" key={n}>
                      <input
                        type="checkbox"
                        checked={issue.acknowledged}
                        disabled={busy}
                        onChange={(e) =>
                          change(i, {
                            issues: q.issues.map((v, j) =>
                              j === n
                                ? { ...v, acknowledged: e.target.checked }
                                : v,
                            ),
                          })
                        }
                      />
                      <span>
                        <strong>{issue.message}</strong>
                        <small>
                          Check this box after reviewing and correcting the
                          question, or remove the question.
                        </small>
                      </span>
                    </label>
                  ))}
                  <label>
                    Question
                    <textarea
                      value={q.prompt}
                      maxLength={2000}
                      disabled={busy}
                      onChange={(e) => change(i, { prompt: e.target.value })}
                    />
                  </label>
                  {q.choices.map((c, n) => (
                    <div className="edit-choice" key={n}>
                      <input
                        type="radio"
                        name={`import-answer-${i}`}
                        checked={q.correct === n}
                        disabled={busy}
                        aria-label={`${q.source}: mark ${"ABCDEF"[n]} correct`}
                        onChange={() => change(i, { correct: n })}
                      />
                      <span>{"ABCDEF"[n]}</span>
                      <input
                        value={c}
                        maxLength={500}
                        disabled={busy}
                        aria-label={`${q.source} choice ${"ABCDEF"[n]}`}
                        onChange={(e) =>
                          change(i, {
                            choices: q.choices.map((v, j) =>
                              j === n ? e.target.value : v,
                            ),
                          })
                        }
                      />
                      <button
                        disabled={busy || q.choices.length <= 2}
                        aria-label={`${q.source}: remove choice ${"ABCDEF"[n]}`}
                        onClick={() =>
                          change(i, {
                            choices: q.choices.filter((_, j) => j !== n),
                            correct:
                              q.correct === n
                                ? -1
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
                  <div className="editor-bottom">
                    <button
                      className="text-button"
                      disabled={busy || q.choices.length >= 6}
                      onClick={() => change(i, { choices: [...q.choices, ""] })}
                    >
                      + Add choice
                    </button>
                    <label>
                      Seconds
                      <input
                        type="number"
                        min={5}
                        max={300}
                        disabled={busy}
                        value={q.seconds}
                        onChange={(e) =>
                          change(i, { seconds: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Explanation
                    <textarea
                      rows={2}
                      value={q.explanation}
                      maxLength={2000}
                      disabled={busy}
                      onChange={(e) =>
                        change(i, { explanation: e.target.value })
                      }
                    />
                  </label>
                </div>
              </details>
            );
          })}
          <div className="import-save">
            <p className="small">
              {ready
                ? "All questions are ready. Check the source answer key before saving."
                : "Resolve incomplete fields and review the flagged source notes before saving."}
            </p>
            <button
              className="primary"
              disabled={!ready || busy || reading}
              onClick={() => {
                void (async () => {
                  if (await onSave(result)) setDirty(false);
                })();
              }}
            >
              Save {result.questions.length} questions as a quiz ✓
            </button>
          </div>
        </>
      )}
    </section>
  );
}
