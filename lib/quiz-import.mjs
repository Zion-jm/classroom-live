import { unzipSync, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
const MAX_FILE = 5 * 1024 * 1024;
const MAX_XML = 16 * 1024 * 1024;
const letters = "ABCDEF";
const fail = (message) => {
  throw new Error(message);
};
const array = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const plainParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
});
function xml(source, ordered = false) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    fail("Documents containing XML entity declarations are not supported.");
  if (XMLValidator.validate(source) !== true)
    fail(
      "The file contains invalid XML. Open it in Word or Excel and save a new .docx or .xlsx copy.",
    );
  return (ordered ? orderedParser : plainParser).parse(source);
}
function archive(bytes, extension) {
  if (bytes.length > MAX_FILE) fail("Choose a file smaller than 5 MB.");
  let size = 0,
    count = 0;
  try {
    return unzipSync(bytes, {
      filter: (entry) => {
        if (++count > 500)
          fail(
            "This document has too many embedded files. Use a simpler quiz-only document.",
          );
        size += entry.originalSize;
        if (size > MAX_XML || entry.originalSize > MAX_XML)
          fail("The expanded document is too large (16 MB limit).");
        return extension === "docx"
          ? entry.name === "word/document.xml"
          : /^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(
              entry.name,
            );
      },
    });
  } catch (e) {
    if (/too (large|many)/.test(e.message)) throw e;
    fail(
      "Could not open this file. Password-protected, damaged, .doc, and .xls files are not supported. Save a fresh .docx or .xlsx copy.",
    );
  }
}
function issue(message) {
  return { message, acknowledged: false };
}
export function validateImportedQuestion(q) {
  const errors = [];
  if (!q.prompt.trim() || q.prompt.length > 2000)
    errors.push("Question text must be 1–2,000 characters.");
  if (
    q.choices.length < 2 ||
    q.choices.length > 6 ||
    q.choices.some((c) => !c.trim() || c.length > 500)
  )
    errors.push("Use 2–6 nonempty choices, up to 500 characters each.");
  if (
    !Number.isInteger(q.correct) ||
    q.correct < 0 ||
    q.correct >= q.choices.length
  )
    errors.push("Select one correct answer.");
  if (!Number.isInteger(q.seconds) || q.seconds < 5 || q.seconds > 300)
    errors.push("Timer must be a whole number from 5 to 300 seconds.");
  if (q.explanation.length > 2000)
    errors.push("Explanation must be at most 2,000 characters.");
  return errors;
}
function descendants(nodes, tag) {
  const found = [];
  for (const node of array(nodes))
    for (const [key, value] of Object.entries(node)) {
      if (key === tag) found.push(node);
      else if (key !== ":@" && Array.isArray(value))
        found.push(...descendants(value, tag));
    }
  return found;
}
function text(nodes) {
  let result = "";
  for (const n of array(nodes))
    for (const [key, v] of Object.entries(n)) {
      if (key === "#text") result += String(v);
      else if (["del", "instrText", "drawing", "pict", ":@"].includes(key))
        continue;
      else if (key === "br" || key === "cr") result += "\n";
      else if (key === "tab") result += " ";
      else if (Array.isArray(v)) result += text(v);
    }
  return result;
}
function docxLines(source) {
  const paragraphs = descendants(xml(source, true), "p");
  const result = [];
  for (const paragraph of paragraphs) {
    let parts = [{ text: "", marked: false, bold: false }];
    for (const run of descendants(paragraph.p, "r")) {
      const rPr = run.r.find((x) => x.rPr)?.rPr || [];
      const marks =
        descendants(rPr, "shd").some(
          (x) =>
            !["auto", "FFFFFF", "ffffff"].includes(
              x[":@"]?.["@_fill"] || "auto",
            ),
        ) ||
        descendants(rPr, "highlight").some(
          (x) => !["none", "white"].includes(x[":@"]?.["@_val"] || "none"),
        );
      const bold = descendants(rPr, "b").some(
        (x) => !["0", "false", "off"].includes(x[":@"]?.["@_val"]),
      );
      const pieces = text(run.r).split(/\r?\n/);
      pieces.forEach((piece, i) => {
        if (i) parts.push({ text: "", marked: false, bold: false });
        const current = parts.at(-1);
        current.text += piece;
        if (piece.trim()) {
          current.marked ||= marks;
          current.bold ||= bold;
        }
      });
    }
    // Some generators place text directly in paragraphs rather than runs.
    if (!parts.some((p) => p.text.trim()))
      parts = [{ text: text(paragraph.p), marked: false, bold: false }];
    result.push(
      ...parts
        .map((p) => ({ ...p, text: p.text.trim() }))
        .filter((p) => p.text),
    );
  }
  return result;
}
function parseDocx(source, filename, seconds) {
  const lines = docxLines(source),
    questions = [];
  let current = null;
  let title = filename.replace(/\.docx$/i, "");
  const flush = () => {
    if (!current) return;
    const strong = current.marks
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    const bold = current.bold.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const chosen = strong.length ? strong : bold;
    current.correct = chosen.length === 1 ? chosen[0] : -1;
    if (chosen.length !== 1)
      current.issues.push(
        issue(
          chosen.length
            ? "More than one choice is marked correct. Select the intended answer."
            : "No single highlighted or bold correct answer was found. Select the intended answer.",
        ),
      );
    if (current.notes.length) {
      current.explanation = current.notes.join("\n");
      if (
        /correct answer\s*:|none of (the |these |supplied )?(choices|options)|no (supplied |listed )?(correct )?(answer|choice)|should (be|read)|incorrectly/i.test(
          current.explanation,
        )
      )
        current.issues.push(
          issue(
            "The source includes an answer correction or conflicting answer note. Review the choices and correct answer before saving.",
          ),
        );
    }
    const { marks, bold: unused, notes, ...question } = current;
    questions.push(question);
    current = null;
  };
  for (const line of lines) {
    if (/^(verification references|references|sources)\s*$/i.test(line.text)) {
      flush();
      break;
    }
    const question = line.text.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (question) {
      flush();
      current = {
        source: `Question ${question[1]}`,
        prompt: question[2],
        choices: [],
        correct: -1,
        seconds,
        explanation: "",
        issues: [],
        marks: [],
        bold: [],
        notes: [],
      };
      continue;
    }
    if (!current) {
      if (!questions.length && line.text.length <= 120) title = line.text;
      continue;
    }
    const choice = line.text.match(/^([A-F])[.)]\s+(.+)$/i);
    if (choice) {
      const expected = letters[current.choices.length];
      if (choice[1].toUpperCase() !== expected)
        current.issues.push(
          issue(
            `Choice labels are not sequential (expected ${expected}). Check the extracted choices.`,
          ),
        );
      current.choices.push(choice[2]);
      current.marks.push(line.marked);
      current.bold.push(line.bold);
    } else if (current.choices.length) current.notes.push(line.text);
    else current.prompt += "\n" + line.text;
  }
  flush();
  return { title, questions, warnings: [] };
}
function cellText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object") return String(value);
  if (value.t !== undefined) return cellText(value.t);
  if (value["#text"] !== undefined) return String(value["#text"]);
  if (value.r) return array(value.r).map(cellText).join("");
  return "";
}
function excelRows(files, path, shared) {
  const sheet = xml(strFromU8(files[path]));
  return array(sheet.worksheet?.sheetData?.row).map((row) => {
    const cells = [];
    let formula = false;
    for (const c of array(row.c)) {
      const col = (c["@_r"] || "").match(/^[A-Z]+/i)?.[0];
      if (!col) continue;
      let idx = 0;
      for (const letter of col.toUpperCase())
        idx = idx * 26 + letter.charCodeAt(0) - 64;
      idx--;
      if (idx > 50)
        fail("The worksheet is too wide. Use only the quiz columns.");
      if (c.f !== undefined) formula = true;
      let value =
        c["@_t"] === "s"
          ? shared[Number(cellText(c.v))]
          : c["@_t"] === "inlineStr"
            ? cellText(c.is)
            : cellText(c.v);
      cells[idx] = value ?? "";
    }
    return { cells, formula, number: row["@_r"] || "?" };
  });
}
const header = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function parseXlsx(files, filename, seconds) {
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"])
    fail("This is not a supported Excel workbook. Save it as .xlsx.");
  const wb = xml(strFromU8(files["xl/workbook.xml"]));
  const sheets = array(wb.workbook?.sheets?.sheet);
  const sheet =
    sheets.find((s) => String(s["@_name"]).toLowerCase() === "questions") ||
    sheets[0];
  const rels = array(
    xml(strFromU8(files["xl/_rels/workbook.xml.rels"])).Relationships
      ?.Relationship,
  );
  const rel = rels.find((r) => r["@_Id"] === sheet?.["@_id"]);
  if (
    !rel ||
    typeof rel["@_Target"] !== "string" ||
    rel["@_TargetMode"] === "External"
  )
    fail("The workbook has no readable Questions worksheet.");
  const path = rel["@_Target"].startsWith("/")
    ? rel["@_Target"].slice(1)
    : `xl/${rel["@_Target"]}`;
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path) || !files[path])
    fail(
      "The Questions worksheet could not be found. Save a standard .xlsx copy.",
    );
  const shared = files["xl/sharedStrings.xml"]
    ? array(xml(strFromU8(files["xl/sharedStrings.xml"])).sst?.si).map(cellText)
    : [];
  const rows = excelRows(files, path, shared);
  const headerIndex = rows.findIndex(
    (r, i) =>
      i < 20 &&
      r.cells.some((v) =>
        ["question", "questiontext", "prompt"].includes(header(v)),
      ),
  );
  if (headerIndex < 0)
    fail(
      "Add a header row with Question, Choice A, Choice B, and Correct answer columns.",
    );
  const headers = rows[headerIndex].cells.map(header);
  const column = (...names) => headers.findIndex((h) => names.includes(h));
  const prompt = column("question", "questiontext", "prompt"),
    correct = column("correctanswer", "correctchoice", "correct"),
    time = column("seconds", "timer", "timelimit", "duration"),
    explanation = column("explanation");
  const choiceColumns = [...letters].map((c) =>
    column(
      `choice${c.toLowerCase()}`,
      `option${c.toLowerCase()}`,
      `answer${c.toLowerCase()}`,
    ),
  );
  if (correct < 0 || choiceColumns[0] < 0 || choiceColumns[1] < 0)
    fail(
      "Required columns: Question, Choice A, Choice B, and Correct answer. Optional: Choice C–F, Seconds, Explanation.",
    );
  const questions = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.cells.some((v) => String(v || "").trim())) continue;
    const value = (i) => (i < 0 ? "" : String(row.cells[i] ?? "").trim());
    const choices = choiceColumns.map(value);
    while (choices.length && choices.at(-1) === "") choices.pop();
    const answer = value(correct);
    let answerIndex = /^[A-F]$/i.test(answer)
      ? letters.indexOf(answer.toUpperCase())
      : /^[1-6]$/.test(answer)
        ? Number(answer) - 1
        : -1;
    if (answerIndex < 0) {
      const matches = choices
        .map((v, i) => (v.toLowerCase() === answer.toLowerCase() ? i : -1))
        .filter((i) => i >= 0);
      if (matches.length === 1) answerIndex = matches[0];
    }
    questions.push({
      source: `Row ${row.number}`,
      prompt: value(prompt),
      choices,
      correct: answerIndex,
      seconds: value(time) ? Number(value(time)) : seconds,
      explanation: value(explanation),
      issues: row.formula
        ? [
            issue(
              "This row contains a formula. Formulas are not evaluated; replace the displayed cached values with the intended plain text and review this row.",
            ),
          ]
        : [],
    });
  }
  return {
    title: filename.replace(/\.xlsx$/i, ""),
    questions,
    warnings:
      sheets.length > 1
        ? [
            `Imported worksheet “${sheet["@_name"]}” only. Other worksheets were not imported.`,
          ]
        : [],
  };
}
export function parseQuizFile(bytes, filename, seconds = 30) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (!["docx", "xlsx"].includes(extension))
    fail(
      "Choose a .docx or .xlsx file. PDF, .doc, .xls, and macro-enabled workbooks are not supported.",
    );
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300)
    fail("Default timer must be a whole number from 5 to 300.");
  const files = archive(bytes, extension);
  const result =
    extension === "docx"
      ? files["word/document.xml"]
        ? parseDocx(strFromU8(files["word/document.xml"]), filename, seconds)
        : fail("No Word document was found in this file.")
      : parseXlsx(files, filename, seconds);
  if (!result.questions.length)
    fail(
      "No questions were found. Word needs numbered questions and lettered choices; Excel needs the documented column headers.",
    );
  if (result.questions.length > 100)
    fail(
      `Found ${result.questions.length} questions. Split the file into quizzes of at most 100 questions.`,
    );
  const seen = new Map();
  for (const q of result.questions) {
    const normalized = q.prompt
      .toLowerCase()
      .replace(/\bthe\b/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (seen.has(normalized))
      q.issues.push(
        issue(
          `Possible duplicate of ${seen.get(normalized)}. Keep it only if intentional.`,
        ),
      );
    else seen.set(normalized, q.source);
    if (q.choices.some((c) => /^(option|choice)\s*\d+$/i.test(c.trim())))
      q.issues.push(
        issue("A choice looks like placeholder text. Review it before saving."),
      );
  }
  return result;
}
