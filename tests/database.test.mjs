import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Supabase migration: role isolation, complete 50-player game, deadlines, rankings, private events", async () => {
  const db = new PGlite();
  try {
    // PostgreSQL engine is real; hosted Auth, Realtime, and Cron are simulated.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text, is_anonymous boolean default false);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create schema realtime;
      create table realtime.messages(id bigint generated always as identity, extension text, topic text);
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to authenticated;
      grant select, insert on realtime.messages to authenticated;
      create table realtime.test_events(payload jsonb, event text, topic text, private boolean);
      create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $$insert into realtime.test_events values(payload,event,topic,private)$$;
      create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic', true)$$;
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610240001_classroom.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610240002_self_paced.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // Upgrade an existing active session with an accepted answer, not just an empty schema.
    const legacyTeacher = randomUUID(),
      legacyStudent = randomUUID();
    await db.query("insert into auth.users(id) values($1),($2)", [
      legacyTeacher,
      legacyStudent,
    ]);
    await db.query("insert into classroom_private.admins values($1)", [
      legacyTeacher,
    ]);
    async function legacyRpc(who, body) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        who,
      ]);
      return (
        await db.query("select public.classroom_request($1::jsonb) result", [
          JSON.stringify(body),
        ])
      ).rows[0].result;
    }
    const legacyQuiz = (
      await legacyRpc(legacyTeacher, {
        action: "save",
        quiz: {
          title: "Existing before upgrade",
          questions: [
            {
              prompt: "Legacy",
              choices: ["Yes", "No"],
              correct: 0,
              seconds: 300,
              explanation: "Existing key",
            },
          ],
        },
      })
    ).quiz;
    const legacyCode = (
      await legacyRpc(legacyTeacher, {
        action: "host",
        id: legacyQuiz.id,
        mode: "self",
        feedback: "end",
      })
    ).code;
    await legacyRpc(legacyStudent, {
      action: "join",
      code: legacyCode,
      name: "Existing player",
    });
    let legacyState = await legacyRpc(legacyTeacher, {
      action: "snapshot",
      code: legacyCode,
      hosting: true,
    });
    await legacyRpc(legacyTeacher, {
      action: "start",
      code: legacyCode,
      revision: legacyState.revision,
    });
    const beforeUpgrade = await legacyRpc(legacyStudent, {
      action: "snapshot",
      code: legacyCode,
    });
    await legacyRpc(legacyStudent, {
      action: "answer",
      code: legacyCode,
      questionId: beforeUpgrade.question.id,
      choice: 0,
    });
    const upgrade = await readFile(
      new URL(
        "../supabase/migrations/202610240003_expansion.sql",
        import.meta.url,
      ),
      "utf8",
    );
    try {
      await db.exec(upgrade);
    } catch (e) {
      console.error(
        "SQL location:",
        e.position,
        upgrade.slice(Number(e.position) - 180, Number(e.position) + 180),
        e.internalQuery,
        e.where,
      );
      throw e;
    }
    const teacher = randomUUID(),
      otherTeacher = randomUUID();
    const students = Array.from({ length: 51 }, () => randomUUID());
    for (const id of [teacher, otherTeacher, ...students])
      await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into classroom_private.admins values($1),($2)", [
      teacher,
      otherTeacher,
    ]);
    async function rpc(who, body = {}) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        who || "",
      ]);
      await db.exec("set role authenticated");
      return (
        await db.query("select public.classroom_request($1::jsonb) as result", [
          JSON.stringify(body),
        ])
      ).rows[0].result;
    }
    const afterUpgrade = await rpc(legacyStudent, {
      action: "snapshot",
      code: legacyCode,
    });
    assert.equal(afterUpgrade.ownAnswer, 0);
    assert.equal(afterUpgrade.question.id, beforeUpgrade.question.id);
    assert.equal(afterUpgrade.question.correct, undefined);
    const legacyFinished = await rpc(legacyStudent, {
      action: "next_self",
      code: legacyCode,
      questionId: beforeUpgrade.question.id,
    });
    assert.equal(legacyFinished.score, 1);
    assert.equal(legacyFinished.review.length, 1);
    assert.equal(
      (
        await rpc(legacyTeacher, {
          action: "session_analysis",
          code: legacyCode,
        })
      ).questions[0].reached,
      null,
    );
    assert.equal((await rpc(students[0])).admin, false);
    await assert.rejects(rpc(null), /Sign in/);
    await assert.rejects(
      rpc(students[0], { action: "save", quiz: {} }),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select * from classroom_private.quizzes"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select classroom_private.expire_questions()"),
      /permission denied/,
    );
    const question = {
      prompt: "Choose green",
      choices: ["Green", "Red"],
      correct: 0,
      seconds: 300,
      explanation: "Green is correct.",
    };
    await assert.rejects(
      rpc(teacher, {
        action: "save",
        quiz: { title: "Bad", questions: [{ ...question, correct: 9 }] },
      }),
      /Invalid correct/,
    );
    const { quiz } = await rpc(teacher, {
      action: "save",
      quiz: {
        title: "Database verification",
        questions: [question, { ...question, prompt: "Choose green again" }],
      },
    });
    await assert.rejects(
      rpc(otherTeacher, { action: "save", quiz }),
      /do not own/,
    );
    const { code } = await rpc(teacher, { action: "host", id: quiz.id });
    const players = [];
    for (let i = 0; i < 50; i++)
      players.push(
        await rpc(students[i], { action: "join", code, name: `Student ${i}` }),
      );
    assert.equal(
      (await rpc(students[0], { action: "join", code, name: "New name" }))
        .playerId,
      players[0].playerId,
    );
    await assert.rejects(
      rpc(students[50], { action: "join", code, name: "Overflow" }),
      /full/,
    );
    await assert.rejects(
      rpc(students[50], { action: "snapshot", code }),
      /session/,
    );
    let state = await rpc(teacher, { action: "snapshot", code, hosting: true });
    await assert.rejects(
      rpc(students[0], { action: "start", code, revision: state.revision }),
      /do not own/,
    );
    await assert.rejects(
      rpc(otherTeacher, { action: "snapshot", code, hosting: true }),
      /do not own/,
    );
    state = await rpc(teacher, {
      action: "start",
      code,
      revision: state.revision,
    });
    let own = await rpc(students[0], { action: "snapshot", code });
    assert.equal(own.question.correct, undefined);
    assert.equal(own.question.explanation, undefined);
    assert.deepEqual(own.leaderboard, []);
    await assert.rejects(
      rpc(teacher, { action: "reveal", code, revision: state.revision }),
      /lock/,
    );
    const originalId = state.question.id;
    // Editing the source quiz must not change the running room.
    await rpc(teacher, {
      action: "save",
      quiz: { ...quiz, questions: [{ ...question, correct: 1 }] },
    });
    for (let i = 0; i < 49; i++)
      await rpc(students[i], {
        action: "answer",
        code,
        questionId: originalId,
        choice: i % 2,
      });
    own = await rpc(students[0], {
      action: "answer",
      code,
      questionId: originalId,
      choice: 1,
    });
    assert.equal(own.ownAnswer, 0);
    assert.equal(own.score, 0);
    await db.exec("reset role");
    await db.query(
      "update classroom_private.rooms set state=jsonb_set(state,'{deadline}','1'::jsonb) where code=$1",
      [code],
    );
    await assert.rejects(
      rpc(students[49], {
        action: "answer",
        code,
        questionId: originalId,
        choice: 0,
      }),
      /locked/,
    );
    // Run the very same expiration function used by Cron.
    await db.exec("reset role");
    await db.query("select classroom_private.expire_questions()");
    state = await rpc(teacher, { action: "snapshot", code, hosting: true });
    assert.equal(state.phase, "QUESTION_LOCKED");
    state = await rpc(teacher, {
      action: "reveal",
      code,
      revision: state.revision,
    });
    assert.equal(
      (await rpc(students[0], { action: "snapshot", code })).score,
      1,
    );
    assert.equal(
      (await rpc(students[49], { action: "snapshot", code })).ownAnswer,
      null,
    );
    assert.equal(state.question.correct, 0);
    const oldRevision = state.revision;
    state = await rpc(teacher, {
      action: "next",
      code,
      revision: state.revision,
    });
    await assert.rejects(
      rpc(teacher, { action: "next", code, revision: oldRevision }),
      /room changed/,
    );
    await assert.rejects(
      rpc(students[0], {
        action: "answer",
        code,
        questionId: originalId,
        choice: 0,
      }),
      /no longer active/,
    );
    for (const id of students.slice(0, 50))
      await rpc(id, {
        action: "answer",
        code,
        questionId: state.question.id,
        choice: 0,
      });
    state = await rpc(teacher, { action: "snapshot", code, hosting: true });
    state = await rpc(teacher, {
      action: "close",
      code,
      revision: state.revision,
    });
    state = await rpc(teacher, {
      action: "reveal",
      code,
      revision: state.revision,
    });
    state = await rpc(teacher, {
      action: "finish",
      code,
      revision: state.revision,
    });
    assert.equal(state.leaderboard.length, 50);
    assert.equal(state.leaderboard.filter((p) => p.score === 2).length, 25);
    assert.equal(state.leaderboard[25].rank, 26);
    const exported = await rpc(teacher, { action: "export", code });
    assert.equal(exported.questions.length, 2);
    assert.equal(exported.answers.length, 99);
    await assert.rejects(
      rpc(students[0], { action: "export", code }),
      /do not own/,
    );
    await rpc(students[0]);
    assert.equal(
      (
        await db.query("select public.classroom_can_listen($1) as allowed", [
          `classroom-room:${code}`,
        ])
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await db.query("select public.classroom_can_listen($1) as allowed", [
          `classroom-host:${code}`,
        ])
      ).rows[0].allowed,
      false,
    );
    await rpc(students[50]);
    assert.equal(
      (
        await db.query("select public.classroom_can_listen($1) as allowed", [
          `classroom-room:${code}`,
        ])
      ).rows[0].allowed,
      false,
    );
    await db.exec("reset role");
    const events = (await db.query("select * from realtime.test_events")).rows;
    assert.ok(events.length > 0);
    assert.ok(
      events.every(
        (e) => e.private && Object.keys(e.payload).join() === "revision",
      ),
    );
    const lobby = await rpc(teacher, { action: "host", id: quiz.id });
    await rpc(students[0], { action: "join", code: lobby.code, name: "Alice" });
    await assert.rejects(
      rpc(students[1], { action: "join", code: lobby.code, name: " ALICE " }),
      /already/,
    );
    await rpc(teacher, {
      action: "remove",
      code: lobby.code,
      playerId: (
        await rpc(students[0], { action: "snapshot", code: lobby.code })
      ).players[0].id,
    });
    await assert.rejects(
      rpc(students[0], { action: "snapshot", code: lobby.code }),
      /session/,
    );
    await rpc(students[1], { action: "join", code: lobby.code, name: "Bob" });
    let partial = await rpc(teacher, {
      action: "snapshot",
      code: lobby.code,
      hosting: true,
    });
    partial = await rpc(teacher, {
      action: "start",
      code: lobby.code,
      revision: partial.revision,
    });
    await rpc(students[1], {
      action: "answer",
      code: lobby.code,
      questionId: partial.question.id,
      choice: 1,
    });
    partial = await rpc(teacher, {
      action: "snapshot",
      code: lobby.code,
      hosting: true,
    });
    partial = await rpc(teacher, {
      action: "close",
      code: lobby.code,
      revision: partial.revision,
    });
    partial = await rpc(teacher, {
      action: "reveal",
      code: lobby.code,
      revision: partial.revision,
    });
    partial = await rpc(teacher, {
      action: "cancel",
      code: lobby.code,
      revision: partial.revision,
    });
    assert.equal(partial.revealedCount, 1);
    assert.equal(partial.leaderboard[0].score, 1);
    assert.equal(
      (await rpc(teacher, { action: "export", code: lobby.code })).state.phase,
      "CANCELLED",
    );
    const selfQuiz = (
      await rpc(teacher, {
        action: "save",
        quiz: {
          title: "Self-paced verification",
          questions: [question, { ...question, prompt: "Question two" }],
        },
      })
    ).quiz;
    await assert.rejects(
      rpc(teacher, { action: "host", id: selfQuiz.id, mode: "invalid" }),
      /valid session/,
    );
    await assert.rejects(
      rpc(teacher, { action: "host", id: selfQuiz.id, timerMode: "quiz" }),
      /Invalid session settings/,
    );
    await assert.rejects(
      rpc(teacher, {
        action: "host",
        id: selfQuiz.id,
        mode: "self",
        timerMode: "quiz",
        quizDurationSeconds: 59,
      }),
      /1–180/,
    );
    for (const feedback of ["each", "end"]) {
      const c = (
        await rpc(teacher, {
          action: "host",
          id: selfQuiz.id,
          mode: "self",
          feedback,
        })
      ).code;
      const cohort =
        feedback === "end" ? students.slice(0, 50) : students.slice(0, 2);
      for (const [i, id] of cohort.entries())
        await rpc(id, { action: "join", code: c, name: `Self ${i}` });
      let h = await rpc(teacher, {
        action: "snapshot",
        code: c,
        hosting: true,
      });
      assert.equal(h.mode, "self");
      h = await rpc(teacher, {
        action: "start",
        code: c,
        revision: h.revision,
      });
      assert.equal(h.phase, "RUNNING");
      let first = await rpc(cohort[0], { action: "snapshot", code: c });
      const firstId = first.question.id;
      assert.equal(first.question.correct, undefined);
      assert.deepEqual(first.review, []);
      await assert.rejects(
        rpc(cohort[0], { action: "next_self", code: c, questionId: firstId }),
        /Submit/,
      );
      await assert.rejects(
        rpc(students[50], { action: "snapshot", code: c }),
        /session/,
      );
      await assert.rejects(
        rpc(cohort[0], {
          action: "close_session",
          code: c,
          revision: h.revision,
        }),
        /do not own/,
      );
      first = await rpc(cohort[0], {
        action: "answer",
        code: c,
        questionId: firstId,
        choice: 0,
      });
      assert.equal(first.question.correct, feedback === "each" ? 0 : undefined);
      assert.equal(first.score, feedback === "each" ? 1 : null);
      assert.deepEqual(first.review, []);
      first = await rpc(cohort[0], {
        action: "answer",
        code: c,
        questionId: firstId,
        choice: 1,
      });
      assert.equal(first.ownAnswer, 0);
      first = await rpc(cohort[0], {
        action: "next_self",
        code: c,
        questionId: firstId,
      });
      assert.equal(first.index, 1);
      assert.equal(
        (await rpc(cohort[1], { action: "snapshot", code: c })).index,
        0,
      );
      await assert.rejects(
        rpc(cohort[0], { action: "next_self", code: c, questionId: firstId }),
        /no longer/,
      );
      first = await rpc(cohort[0], {
        action: "answer",
        code: c,
        questionId: first.question.id,
        choice: 0,
      });
      first = await rpc(cohort[0], {
        action: "next_self",
        code: c,
        questionId: first.question.id,
      });
      assert.equal(first.phase, "ATTEMPT_FINISHED");
      assert.equal(first.score, 2);
      assert.equal(first.review.length, 2);
      assert.deepEqual(first.leaderboard, []);
      const unfinished = await rpc(cohort[1], { action: "snapshot", code: c });
      assert.equal(unfinished.phase, "QUESTION_OPEN");
      assert.deepEqual(unfinished.review, []);
      assert.equal(unfinished.question.correct, undefined);
      await db.exec("reset role");
      await db.query(
        "update classroom_private.attempts set deadline=1 where room_id=(select id from classroom_private.rooms where code=$1) and player_id=(select id from classroom_private.players where user_id=$2 and room_id=(select id from classroom_private.rooms where code=$1))",
        [c, cohort[1]],
      );
      await db.query("select classroom_private.expire_questions()");
      const timed = await rpc(cohort[1], { action: "snapshot", code: c });
      assert.equal(
        timed.phase,
        feedback === "each" ? "ANSWER_REVEALED" : "QUESTION_LOCKED",
      );
      assert.equal(timed.ownAnswer, null);
      await assert.rejects(
        rpc(cohort[1], {
          action: "answer",
          code: c,
          questionId: timed.question.id,
          choice: 0,
        }),
        /locked/,
      );
      let second = await rpc(cohort[1], {
        action: "next_self",
        code: c,
        questionId: timed.question.id,
      });
      second = await rpc(cohort[1], {
        action: "answer",
        code: c,
        questionId: second.question.id,
        choice: 0,
      });
      second = await rpc(cohort[1], {
        action: "next_self",
        code: c,
        questionId: second.question.id,
      });
      if (feedback === "each") assert.equal(second.phase, "FINISHED");
      else {
        // A 50-player room can close with mixed independent progress.
        h = await rpc(teacher, { action: "snapshot", code: c, hosting: true });
        assert.equal(h.finishedCount, 2);
        assert.equal(h.progress.length, 50);
        h = await rpc(teacher, {
          action: "close_session",
          code: c,
          revision: h.revision,
        });
        assert.equal(h.phase, "FINISHED");
        const closed = await rpc(cohort[2], { action: "snapshot", code: c });
        assert.equal(closed.score, 0);
        assert.equal(closed.review.length, 2);
        assert.equal(closed.leaderboard.length, 50);
      }
      const finalExport = await rpc(teacher, { action: "export", code: c });
      assert.equal(finalExport.questions.length, 2);
      assert.equal(finalExport.state.leaderboard[0].score, 2);
    }
    // Every supported self-paced configuration uses canonical grading and stable presentation.
    for (const feedback of ["each", "end", "session_end"])
      for (const timerMode of ["question", "quiz"])
        for (const shuffleQuestions of [false, true])
          for (const shuffleChoices of [false, true]) {
            const c = (
              await rpc(teacher, {
                action: "host",
                id: selfQuiz.id,
                mode: "self",
                feedback,
                timerMode,
                quizDurationSeconds: 60,
                shuffleQuestions,
                shuffleChoices,
              })
            ).code;
            for (let i = 0; i < 2; i++)
              await rpc(students[i], {
                action: "join",
                code: c,
                name: `Matrix ${i}`,
              });
            let h = await rpc(teacher, {
              action: "snapshot",
              code: c,
              hosting: true,
            });
            await rpc(teacher, {
              action: "start",
              code: c,
              revision: h.revision,
            });
            let a = await rpc(students[0], { action: "snapshot", code: c });
            const firstDeadline = a.deadline,
              seen = [];
            for (let step = 0; step < 2; step++) {
              seen.push(a.question.id);
              const again = await rpc(students[0], {
                action: "snapshot",
                code: c,
              });
              assert.deepEqual(again.question, a.question);
              assert.equal(a.question.correct, undefined);
              assert.equal(a.question.explanation, undefined);
              assert.equal(a.questionOrders, undefined);
              assert.deepEqual(a.review, []);
              const selected = a.question.choices.indexOf("Green");
              if (shuffleChoices)
                await assert.rejects(
                  rpc(students[0], {
                    action: "answer",
                    code: c,
                    questionId: a.question.id,
                    choice: selected,
                  }),
                  /choice IDs/,
                );
              const qid = a.question.id;
              a = await rpc(students[0], {
                action: "answer",
                code: c,
                questionId: qid,
                choiceId: a.question.choiceIds[selected],
              });
              assert.equal(a.ownAnswer, selected);
              assert.equal(
                a.question.correct,
                feedback === "each" ? selected : undefined,
              );
              assert.equal(a.score, feedback === "each" ? step + 1 : null);
              a = await rpc(students[0], {
                action: "next_self",
                code: c,
                questionId: qid,
              });
              if (timerMode === "quiz" && step === 0)
                assert.equal(a.deadline, firstDeadline);
            }
            assert.equal(new Set(seen).size, 2);
            assert.equal(a.phase, "ATTEMPT_FINISHED");
            assert.equal(a.score, feedback === "session_end" ? null : 2);
            assert.equal(a.review.length, feedback === "session_end" ? 0 : 2);
            assert.deepEqual(a.leaderboard, []);
            const activeAnalysis = await rpc(teacher, {
              action: "session_analysis",
              code: c,
            });
            assert.equal(activeAnalysis.questions[0].unanswered, null);
            await assert.rejects(
              rpc(students[0], { action: "session_analysis", code: c }),
              /do not own/,
            );
            await assert.rejects(
              rpc(otherTeacher, { action: "session_analysis", code: c }),
              /do not own/,
            );
            h = await rpc(teacher, {
              action: "snapshot",
              code: c,
              hosting: true,
            });
            await rpc(teacher, {
              action: "close_session",
              code: c,
              revision: h.revision,
            });
            a = await rpc(students[0], { action: "snapshot", code: c });
            assert.equal(a.score, 2);
            assert.equal(a.review.length, 2);
            assert.deepEqual(
              a.review.map((q) => q.id),
              seen,
            );
            for (const q of a.review)
              assert.equal(q.choices[q.correct], "Green");
            const metrics = await rpc(teacher, {
              action: "session_analysis",
              code: c,
            });
            for (const q of metrics.questions) {
              assert.equal(q.submitted, 1);
              assert.equal(q.correct, 1);
              assert.equal(q.incorrect, 0);
              assert.equal(q.unanswered, 1);
              assert.equal(q.correctRate, 0.5);
              assert.equal(q.submissionAccuracy, 1);
              assert.equal(q.timingSamples, 1);
              assert.ok(q.medianResponseMs >= 0);
              assert.deepEqual(
                q.distribution.map((x) => x.count),
                [1, 0],
              );
            }
          }
    for (const shuffleQuestions of [false, true])
      for (const shuffleChoices of [false, true]) {
        const c = (
          await rpc(teacher, {
            action: "host",
            id: selfQuiz.id,
            mode: "teacher",
            shuffleQuestions,
            shuffleChoices,
          })
        ).code;
        for (let i = 0; i < 2; i++)
          await rpc(students[i], {
            action: "join",
            code: c,
            name: `Teacher matrix ${i}`,
          });
        let h = await rpc(teacher, {
          action: "snapshot",
          code: c,
          hosting: true,
        });
        h = await rpc(teacher, {
          action: "start",
          code: c,
          revision: h.revision,
        });
        for (let step = 0; step < 2; step++) {
          for (const id of students.slice(0, 2)) {
            let a = await rpc(id, { action: "snapshot", code: c });
            assert.equal(a.question.id, h.question.id);
            assert.equal(a.question.correct, undefined);
            await rpc(id, {
              action: "answer",
              code: c,
              questionId: a.question.id,
              choiceId:
                a.question.choiceIds[a.question.choices.indexOf("Green")],
            });
          }
          h = await rpc(teacher, {
            action: "snapshot",
            code: c,
            hosting: true,
          });
          h = await rpc(teacher, {
            action: "close",
            code: c,
            revision: h.revision,
          });
          h = await rpc(teacher, {
            action: "reveal",
            code: c,
            revision: h.revision,
          });
          for (const id of students.slice(0, 2)) {
            const a = await rpc(id, { action: "snapshot", code: c });
            assert.equal(a.question.choices[a.question.correct], "Green");
            assert.equal(a.ownAnswer, a.question.correct);
          }
          if (step === 0)
            h = await rpc(teacher, {
              action: "next",
              code: c,
              revision: h.revision,
            });
        }
        h = await rpc(teacher, {
          action: "finish",
          code: c,
          revision: h.revision,
        });
        assert.ok(h.leaderboard.every((p) => p.score === 2));
      }
    // An overall timeout applies between questions, and strict feedback never unlocks on cancellation.
    for (const cancel of [false, true]) {
      const c = (
        await rpc(teacher, {
          action: "host",
          id: selfQuiz.id,
          mode: "self",
          feedback: "session_end",
          timerMode: "quiz",
          quizDurationSeconds: 60,
        })
      ).code;
      await rpc(students[0], { action: "join", code: c, name: "Timed" });
      let h = await rpc(teacher, {
        action: "snapshot",
        code: c,
        hosting: true,
      });
      await rpc(teacher, { action: "start", code: c, revision: h.revision });
      const a = await rpc(students[0], { action: "snapshot", code: c });
      await rpc(students[0], {
        action: "answer",
        code: c,
        questionId: a.question.id,
        choiceId: a.question.choiceIds[0],
      });
      if (cancel) {
        h = await rpc(teacher, { action: "snapshot", code: c, hosting: true });
        await rpc(teacher, { action: "cancel", code: c, revision: h.revision });
      } else {
        await db.exec("reset role");
        await db.query(
          "update classroom_private.attempts set overall_deadline=1 where room_id=(select id from classroom_private.rooms where code=$1)",
          [c],
        );
        await db.query("select classroom_private.expire_questions()");
      }
      const final = await rpc(students[0], { action: "snapshot", code: c });
      assert.equal(final.phase, cancel ? "CANCELLED" : "FINISHED");
      assert.equal(final.score, cancel ? null : 1);
      assert.equal(final.review.length, cancel ? 0 : 2);
    }
    // Private incomplete drafts, stale writes, validation, and idempotent promotion.
    const did = randomUUID();
    let d = await rpc(teacher, {
      action: "draft_save",
      id: did,
      kind: "editor",
      revision: 0,
      payload: { quiz: { title: "Incomplete", questions: [] } },
    });
    assert.equal(d.revision, 1);
    await assert.rejects(
      rpc(students[0], { action: "draft_load", id: did }),
      /Administrator/,
    );
    await assert.rejects(
      rpc(otherTeacher, { action: "draft_load", id: did }),
      /do not own/,
    );
    assert.deepEqual(await rpc(otherTeacher, { action: "draft_list" }), []);
    await assert.rejects(
      rpc(teacher, {
        action: "draft_save",
        id: did,
        kind: "editor",
        revision: 0,
        payload: {},
      }),
      /conflict/,
    );
    await assert.rejects(
      rpc(teacher, { action: "draft_publish", id: did, revision: 1 }),
      /question/i,
    );
    d = await rpc(teacher, {
      action: "draft_save",
      id: did,
      kind: "editor",
      revision: 1,
      payload: { quiz: { title: "Published draft", questions: [question] } },
    });
    const promoted = await rpc(teacher, {
      action: "draft_publish",
      id: did,
      revision: d.revision,
    });
    assert.equal(
      (
        await rpc(teacher, {
          action: "draft_publish",
          id: did,
          revision: d.revision,
        })
      ).quiz.id,
      promoted.quiz.id,
    );
    assert.equal((await rpc(teacher, { action: "draft_list" })).length, 0);
    const importId = randomUUID();
    let imp = await rpc(teacher, {
      action: "draft_save",
      id: importId,
      kind: "import",
      revision: 0,
      payload: {
        result: {
          title: "Review import",
          questions: [
            {
              ...question,
              issues: [{ message: "Check key", acknowledged: false }],
            },
          ],
        },
      },
    });
    await assert.rejects(
      rpc(teacher, {
        action: "draft_publish",
        id: importId,
        revision: imp.revision,
      }),
      /flagged/,
    );
    await assert.rejects(
      rpc(teacher, { action: "draft_discard", id: importId, revision: 0 }),
      /changed/,
    );
    await rpc(teacher, {
      action: "draft_discard",
      id: importId,
      revision: imp.revision,
    });
    await assert.rejects(
      rpc(teacher, {
        action: "draft_save",
        id: importId,
        kind: "import",
        revision: imp.revision,
        payload: {},
      }),
      /discarded/,
    );
    assert.equal(
      (await rpc(teacher, { action: "capabilities" })).schemaVersion,
      3,
    );
    const sourceQuiz = (
      await rpc(teacher, { action: "dashboard" })
    ).quizzes.find((q) => q.id === promoted.quiz.id);
    const editId = randomUUID();
    const edited = await rpc(teacher, {
      action: "draft_save",
      id: editId,
      kind: "editor",
      revision: 0,
      payload: { quiz: sourceQuiz },
    });
    await rpc(teacher, {
      action: "save",
      quiz: { ...sourceQuiz, title: "Changed elsewhere" },
    });
    await assert.rejects(
      rpc(teacher, {
        action: "draft_publish",
        id: editId,
        revision: edited.revision,
      }),
      /changed/,
    );
    await rpc(teacher, { action: "delete", id: sourceQuiz.id });
    await assert.rejects(
      rpc(teacher, {
        action: "draft_publish",
        id: editId,
        revision: edited.revision,
      }),
      /deleted/,
    );
    const largeQuiz = (
      await rpc(teacher, {
        action: "save",
        quiz: {
          title: "100-question expiry boundary",
          questions: Array.from({ length: 100 }, (_, i) => ({
            ...question,
            prompt: `Boundary ${i}`,
          })),
        },
      })
    ).quiz;
    const largeCode = (
      await rpc(teacher, {
        action: "host",
        id: largeQuiz.id,
        mode: "self",
        feedback: "session_end",
        timerMode: "quiz",
        quizDurationSeconds: 10800,
        shuffleQuestions: true,
        shuffleChoices: true,
      })
    ).code;
    for (let i = 0; i < 50; i++)
      await rpc(students[i], {
        action: "join",
        code: largeCode,
        name: `Boundary ${i}`,
      });
    const largeLobby = await rpc(teacher, {
      action: "snapshot",
      code: largeCode,
      hosting: true,
    });
    await rpc(teacher, {
      action: "start",
      code: largeCode,
      revision: largeLobby.revision,
    });
    await db.exec("reset role");
    await db.query(
      "update classroom_private.attempts set overall_deadline=1 where room_id=(select id from classroom_private.rooms where code=$1)",
      [largeCode],
    );
    await db.query("select classroom_private.expire_questions()");
    const expired = await rpc(students[0], {
      action: "snapshot",
      code: largeCode,
    });
    assert.equal(expired.phase, "FINISHED");
    assert.equal(expired.review.length, 100);
    assert.equal(expired.leaderboard.length, 50);
    assert.equal(expired.finishReason, "overall_timeout");
    const largeReport = await rpc(teacher, {
      action: "session_analysis",
      code: largeCode,
    });
    assert.equal(largeReport.questions.length, 100);
    assert.ok(
      largeReport.questions.every(
        (q) => q.unanswered === 50 && q.submitted === 0,
      ),
    );
    assert.equal(
      largeReport.questions.reduce((n, q) => n + q.reached, 0),
      50,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query("select public.classroom_request('{}')"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
