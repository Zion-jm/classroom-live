// Maintainer helper: materialize reviewed replacement functions into migration 003.
// The emitted SQL is standalone; Supabase does not execute this generator.
import { readFileSync, writeFileSync } from "node:fs";
const base = "supabase/migrations/";
const old = readFileSync(base + "202610240002_self_paced.sql", "utf8");
function fn(name) {
  const start = old.indexOf(`create function ${name}(`);
  if (start < 0) throw Error(name);
  const end = old.indexOf("\n$$;", start);
  return old
    .slice(start, end + 4)
    .replace("create function", "create or replace function");
}
let snapshot = fn("classroom_private.self_snapshot");
snapshot = snapshot.replace(
  "q jsonb; board",
  "canonical integer; allowed boolean; q jsonb; board",
);
snapshot = snapshot.replace(
  "idx:=coalesce(a.question_index,0);",
  "idx:=coalesce(a.question_index,0); canonical:=classroom_private.canonical_index(s,p,idx); allowed:=s->>'phase'<>'CANCELLED' and (s->>'feedback'<>'session_end' or s->>'phase'='FINISHED');",
);
snapshot = snapshot.replace(
  "q:=s->'quiz'->'questions'->idx",
  "q:=s->'quiz'->'questions'->canonical",
);
snapshot = snapshot.replace("question_index=idx;", "question_index=canonical;");
snapshot = snapshot.replace(
  "'mode','self','feedback'",
  "'timerMode',coalesce(s->>'timerMode','question'),'quizDurationSeconds',s->'quizDurationSeconds','finishReason',a.finish_reason,'mode','self','feedback'",
);
snapshot = snapshot.replace(
  "'deadline',case when a.status='OPEN' then a.deadline else null end",
  "'deadline',case when hosting and s->>'timerMode'='quiz' and s->>'phase'='RUNNING' then (select min(overall_deadline) from classroom_private.attempts where room_id=room) when a.status<>'FINISHED' and s->>'timerMode'='quiz' then a.overall_deadline when a.status='OPEN' then a.deadline else null end",
);
snapshot = snapshot
  .replace("'each' or done then", "'each' or done) and allowed then")
  .replace(
    "case when s->>'feedback'='each' or done)",
    "case when (s->>'feedback'='each' or done)",
  );
snapshot = snapshot.replace(
  "not hosting and done then (",
  "not hosting and done and allowed then (",
);
// Wrapper maps displayed choices/reviews. Base snapshot retains canonical indexes.
let request = fn("classroom_private.self_request");
request = request.replace(
  "idx integer; total integer;",
  "idx integer; canonical integer; total integer;",
);
request = request.replace(
  "idx:=a.question_index; q:=s->'quiz'->'questions'->idx;",
  "idx:=a.question_index; canonical:=classroom_private.canonical_index(s,p,idx); q:=s->'quiz'->'questions'->canonical;",
);
request = request.replaceAll(
  "question_index=idx;",
  "question_index=canonical;",
);
request = request.replaceAll(
  "and question_index=idx)",
  "and question_index=canonical)",
);
request = request.replace(
  "values(r.id,p,idx,choice,to_timestamp",
  "values(r.id,p,canonical,choice,to_timestamp",
);
request = request.replace(
  "set status='FINISHED',deadline=null,finished_at=clock_timestamp()",
  "set status='FINISHED',deadline=null,finished_at=clock_timestamp(),finish_reason='student_finished'",
);
request = request.replace(
  "deadline=now_ms+(s->'quiz'->'questions'->(idx+1)->>'seconds')::bigint*1000",
  "deadline=coalesce(a.overall_deadline,now_ms+(s->'quiz'->'questions'->classroom_private.canonical_index(s,p,idx+1)->>'seconds')::bigint*1000)",
);
request = request.replace(
  "select r.id,id,'OPEN',now_ms+(s->'quiz'->'questions'->0->>'seconds')::bigint*1000",
  "select r.id,id,'OPEN',case when s->>'timerMode'='quiz' then now_ms+(s->>'quizDurationSeconds')::bigint*1000 else now_ms+(s->'quiz'->'questions'->classroom_private.canonical_index(s,id,0)->>'seconds')::bigint*1000 end",
);
request = request.replace(
  "s:=s || jsonb_build_object('phase','RUNNING');",
  "update classroom_private.attempts set started_at=to_timestamp(now_ms/1000.0), overall_deadline=case when s->>'timerMode'='quiz' then deadline else null end where room_id=r.id; s:=s || jsonb_build_object('phase','RUNNING');",
);
request = request.replace(
  "finished_at=coalesce(finished_at,clock_timestamp())",
  "finished_at=coalesce(finished_at,clock_timestamp()),finish_reason=coalesce(finish_reason,'teacher_closed')",
);
const prefix = readFileSync("supabase/expansion-prefix.sql", "utf8");
const suffix = readFileSync("supabase/expansion-suffix.sql", "utf8");
writeFileSync(
  base + "202610240003_expansion.sql",
  prefix + "\n" + snapshot + "\n" + request + "\n" + suffix,
);
