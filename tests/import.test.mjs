import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {
  parseQuizFile,
  validateImportedQuestion,
} from "../lib/quiz-import.mjs";
const p = (t, style = "") =>
  `<w:p><w:r>${style ? `<w:rPr>${style}</w:rPr>` : ""}<w:t>${t}</w:t></w:r></w:p>`;
const doc = (body) =>
  zipSync({
    "word/document.xml": strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
const highlight = '<w:shd w:fill="D9EAD3"/>';
test("Word preserves marked keys, notes, and source labels while excluding references", () => {
  const file = doc(
    p("Science Quiz") +
      p("1. Which answer?") +
      p("A. Wrong") +
      p("B. Right", highlight) +
      p("An explanation.") +
      p("2. Another question?") +
      p("A. Correct", "<w:b/>") +
      p("B. Incorrect") +
      p("Verification references") +
      p("https://example.com"),
  );
  const r = parseQuizFile(file, "quiz.docx", 45);
  assert.equal(r.title, "Science Quiz");
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].correct, 1);
  assert.equal(r.questions[0].seconds, 45);
  assert.equal(r.questions[0].explanation, "An explanation.");
  assert.equal(r.questions[1].correct, 0);
  assert.deepEqual(validateImportedQuestion(r.questions[0]), []);
});
test("Word flags missing/multiple correct answers, correction notes, placeholders, and duplicates", () => {
  const r = parseQuizFile(
    doc(
      p("1. Same question?") +
        p("A. Option 1", highlight) +
        p("B. Two", highlight) +
        p("Correct answer: neither of these choices.") +
        p("2. Same question?") +
        p("A. One") +
        p("B. Two"),
    ),
    "quiz.docx",
  );
  assert.equal(r.questions[0].correct, -1);
  assert.ok(r.questions[0].issues.length >= 3);
  assert.equal(r.questions[1].correct, -1);
  assert.ok(r.questions[1].issues.some((i) => /duplicate/.test(i.message)));
  assert.ok(validateImportedQuestion(r.questions[1]).length);
});
test("Word line breaks and table paragraphs are read in order", () => {
  const r = parseQuizFile(
    doc(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>1. A question?</w:t><w:br/><w:t>A. First</w:t></w:r><w:r><w:rPr>${highlight}</w:rPr><w:br/><w:t>B. Second</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    ),
    "table.docx",
  );
  assert.equal(r.questions[0].correct, 1);
  assert.deepEqual(r.questions[0].choices, ["First", "Second"]);
});
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
function workbook(rows, { shared = [], formula = false } = {}) {
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => (value === null ? "" : typeof value === "number" ? `<c r="${"ABCDEFGH"[j]}${i + 1}" t="s"><v>${value}</v></c>` : `<c r="${"ABCDEFGH"[j]}${i + 1}" t="inlineStr">${formula && i === 1 && j === 0 ? "<f>UNSUPPORTED()</f>" : ""}<is><t>${esc(value)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="urn:rels"><sheets><sheet name="Questions" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(
      `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    ),
  });
}
const headers = [
  "Question",
  "Choice A",
  "Choice B",
  "Choice C",
  "Correct answer",
  "Seconds",
  "Explanation",
];
test("Excel supports inline/shared strings, sparse cells, choice letters and timer overrides", () => {
  const r = parseQuizFile(
    workbook(
      [
        headers,
        [0, "No", "Yes", null, "B", "45", "Explanation"],
        ["Second?", "A&B", "Other", null, "1", "", ""],
      ],
      { shared: ["A shared question?"] },
    ),
    "quiz.xlsx",
    20,
  );
  assert.equal(r.questions[0].prompt, "A shared question?");
  assert.equal(r.questions[0].correct, 1);
  assert.equal(r.questions[0].seconds, 45);
  assert.equal(r.questions[1].seconds, 20);
  assert.equal(r.questions[1].correct, 0);
  assert.equal(r.questions[1].choices[0], "A&B");
  assert.deepEqual(validateImportedQuestion(r.questions[0]), []);
});
test("Excel warns about formulas and rejects absent headers", () => {
  const r = parseQuizFile(
    workbook([headers, ["Q?", "One", "Two", null, "Two", "30", ""]], {
      formula: true,
    }),
    "quiz.xlsx",
  );
  assert.equal(r.questions[0].correct, 1);
  assert.match(r.questions[0].issues[0].message, /formula/);
  assert.throws(
    () => parseQuizFile(workbook([["Unknown", "Wrong"]]), "bad.xlsx"),
    /header row/,
  );
});
test("Malformed/unsupported documents, entities, oversized files and too many questions are rejected", () => {
  assert.throws(() => parseQuizFile(new Uint8Array(), "bad.doc"), /\.docx/);
  assert.throws(
    () => parseQuizFile(new Uint8Array(5 * 1024 * 1024 + 1), "big.docx"),
    /5 MB/,
  );
  assert.throws(
    () => parseQuizFile(new Uint8Array([1, 2, 3]), "bad.docx"),
    /Could not open/,
  );
  assert.throws(
    () => parseQuizFile(doc("<!DOCTYPE bad>"), "entity.docx"),
    /entity/,
  );
  assert.throws(
    () => parseQuizFile(doc(p("No quiz here")), "empty.docx"),
    /No questions/,
  );
  assert.throws(
    () =>
      parseQuizFile(
        doc(
          Array.from(
            { length: 101 },
            (_, i) => p(`${i + 1}. Q?`) + p("A. One", highlight) + p("B. Two"),
          ).join(""),
        ),
        "many.docx",
      ),
    /at most 100/,
  );
});
