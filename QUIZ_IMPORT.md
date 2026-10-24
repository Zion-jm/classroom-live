# Bulk quiz import

Teacher dashboard → **Import quiz** → choose `.docx` or `.xlsx` → review → **Save questions as a quiz**.

The preview extracts all questions at once. Edit only the items that need attention, select a title/default timer, and save once. Saving creates a new quiz; it does not replace another saved quiz or alter a running session. The imported quiz works in both teacher-paced and self-paced modes.

## Word format

Use text like this, with each question/choice on its own paragraph or explicit line:

```text
Example quiz

1. What is 2 + 2?
A. 3
B. 4
C. 5
D. 6
Optional explanation after the choices.
```

Highlight the correct choice in Word, or bold only the correct choice. Exactly one marked choice is needed. If highlighting exists, it takes precedence over bold formatting. Ambiguous or absent markings require manual answer selection in the preview. Correct choices are inferred from document formatting; the importer does not independently determine factual correctness.

Notes following the choices become explanations. A paragraph titled References, Verification references, or Sources ends question extraction. Numbered question text must be explicit (`1.` or `1)`) and choices must use A–F. Word's automatic list numbers are not currently resolved. Images, equations, external links, and complex page layouts are not converted to question media. Text in ordinary table paragraphs and explicit line breaks is supported.

## Excel format

Use a worksheet named **Questions**, or put the quiz on the first worksheet. Put column headers near the top, with one question per row:

| Question | Choice A | Choice B | Choice C | Choice D | Correct answer | Seconds | Explanation |
|---|---|---|---|---|---|---|---|
| What is 2 + 2? | 3 | 4 | 5 | 6 | B | 30 | Two plus two equals four. |

Required: Question, Choice A, Choice B, Correct answer. Optional: Choice C–F, Seconds, Explanation. Choice labels must be contiguous: do not put Choice D after a missing Choice C. Correct answer accepts A–F, a one-based choice number 1–6, or exact unique choice text (case-insensitive). Use A–F for clarity.

Trailing empty choices are ignored. Missing timers use the chosen import default. A nonempty invalid timer must be corrected. Only the selected Questions/first worksheet is imported; other sheets produce a notice. Shared strings and inline strings are supported. Formulas are never executed: rows containing formulas are flagged because a saved cached result may be stale; replace them with reviewed plain values before approving.

## Review and limits

- At most 100 questions per quiz, 2–6 choices per question.
- Question text up to 2,000 characters; choices up to 500; explanations up to 2,000.
- Timers are whole seconds from 5 through 300.
- Maximum source file 5 MB, declared expanded archive limit 16 MB, at most 500 archive entries.
- Password-protected files, macros, `.doc`, `.xls`, PDF, and XML entity declarations are not supported.
- Missing/ambiguous answer markings, nonsequential labels, correction notes, placeholder choices, possible duplicates, and formula rows are flagged.
- Every source warning needs an explicit review checkbox. Structural errors and missing answers must also be corrected before Save is enabled. Removing a flagged question is another option.

Possible duplicates are identified by normalized question text (ignoring punctuation, casing, and the word “the”). This is a review aid, not a guarantee that duplicates are found or that flagged questions are identical.

All parsing happens in the browser; the original document is not uploaded. Only the title, question text, choices, chosen correct answer, timer, and explanation are sent through the existing authorized quiz-save operation. Review metadata and original files are not stored. Existing server validation and teacher permissions still apply. Quiz files may contain answer keys; keep the originals in teacher-controlled storage.

## Verification with the supplied Word document

The supplied `Infor-Sec 2 Quiz.docx` extracts 80 numbered questions with marked answers. Review alerts include:

- Question 7: highlighted 73% conflicts with a note stating 74%, with no matching choice.
- Question 50: one choice is the placeholder “Option 1.”
- Question 60: possible duplicate of question 59 after normalization.

The importer preserves source content and does not silently change answers. Review/correct these items or remove them before saving. The teacher must verify all source facts; importing does not fact-check the quiz.

## Deploy

No new Supabase migration or environment variable is needed for import. Use the existing schema and quiz-save RPC.

```powershell
npm test
npm run typecheck
npm run build
git add .
git commit -m "Add Word and Excel bulk quiz import with review"
git push origin main
```

Wait for Vercel to finish its automatic deployment, then refresh the teacher dashboard and test with a small quiz before importing the full class quiz.
