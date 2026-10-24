import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { transaction } from "../../../lib/store";
import {
  GameError,
  validateQuiz,
  createRoom,
  join,
  command,
  submit,
  snapshot,
  reconcile,
  rankings,
} from "../../../lib/engine.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const password = () => process.env.LOCAL_ADMIN_PASSWORD || "classroom-local";
const sign = (value: string) =>
  createHmac("sha256", password()).update(value).digest("hex");
function isAdmin(req: NextRequest) {
  const value = req.cookies.get("quiz_admin")?.value || "";
  const [expires, signature] = value.split(".");
  return (
    !!signature &&
    /^\d+$/.test(expires) &&
    Number(expires) > Date.now() &&
    signature.length === 64 &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(sign(expires)))
  );
}
function requireAdmin(req: NextRequest) {
  if (!isAdmin(req)) throw new GameError("Sign in as administrator.", 401);
}
function roomFor(db: any, code: string) {
  const r = db.rooms.find((r: any) => r.code === code?.toUpperCase());
  if (!r) throw new GameError("Room not found. Check your code.", 404);
  reconcile(r);
  return r;
}
function playerFor(req: NextRequest, room: any) {
  const token = req.headers.get("x-player-token");
  const p = room.players.find((p: any) => p.token === token);
  if (!p) throw new GameError("Your player session is no longer valid.", 401);
  return p;
}
function failure(e: unknown) {
  const error = e as Error & { status?: number };
  console.error(error.status ? error.message : error);
  return NextResponse.json(
    {
      error: error.status
        ? error.message
        : "The local server could not complete this action.",
    },
    { status: error.status || 500 },
  );
}
export async function GET(req: NextRequest) {
  if (process.env.VERCEL || process.env.NEXT_PUBLIC_BACKEND === "supabase")
    return NextResponse.json(
      { error: "Local API is disabled in cloud mode." },
      { status: 404 },
    );
  try {
    const code = req.nextUrl.searchParams.get("code");
    const admin = isAdmin(req);
    if (code)
      return NextResponse.json(
        transaction((db) => {
          const r = roomFor(db, code);
          const p =
            admin && req.nextUrl.searchParams.get("host") === "1"
              ? null
              : playerFor(req, r);
          return snapshot(r, p?.id, !p);
        }),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (!admin) return NextResponse.json({ admin: false });
    return NextResponse.json(
      transaction((db) => ({
        admin: true,
        quizzes: db.quizzes,
        rooms: db.rooms
          .map((r: any) => {
            reconcile(r);
            return {
              code: r.code,
              title: r.quiz.title,
              phase: r.phase,
              createdAt: r.createdAt,
              players: r.players.length,
            };
          })
          .reverse(),
      })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  if (process.env.VERCEL || process.env.NEXT_PUBLIC_BACKEND === "supabase")
    return NextResponse.json(
      { error: "Local API is disabled in cloud mode." },
      { status: 404 },
    );
  try {
    // Next's internal URL can use 0.0.0.0 while the browser uses localhost
    // or a LAN address. Compare the actual request Host, not the bind address.
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host"))
      throw new GameError("Cross-origin requests are not allowed.", 403);
    const text = await req.text();
    if (text.length > 300000) throw new GameError("Request is too large.", 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new GameError("Invalid request.");
    }
    if (body.action === "login") {
      if (body.password !== password())
        throw new GameError("Incorrect administrator password.", 401);
      const expires = String(Date.now() + 12 * 60 * 60 * 1000);
      const response = NextResponse.json({ ok: true });
      response.cookies.set("quiz_admin", `${expires}.${sign(expires)}`, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 43200,
      });
      return response;
    }
    if (body.action === "logout") {
      const r = NextResponse.json({ ok: true });
      r.cookies.delete("quiz_admin");
      return r;
    }
    const result = transaction((db) => {
      if (body.action === "join") {
        const r = roomFor(db, body.code);
        const p = join(r, body.name);
        return { token: p.token, playerId: p.id, code: r.code };
      }
      if (body.action === "answer") {
        const r = roomFor(db, body.code);
        const p = playerFor(req, r);
        submit(r, p.id, body.questionId, body.choice);
        return snapshot(r, p.id);
      }
      requireAdmin(req);
      if (body.action === "save") {
        const quiz = {
          ...validateQuiz(body.quiz),
          id: body.quiz.id || randomUUID(),
          updatedAt: Date.now(),
        };
        const i = db.quizzes.findIndex((q: any) => q.id === quiz.id);
        if (i >= 0) db.quizzes[i] = quiz;
        else db.quizzes.push(quiz);
        return { quiz };
      }
      if (body.action === "delete") {
        db.quizzes = db.quizzes.filter((q: any) => q.id !== body.id);
        return { ok: true };
      }
      if (body.action === "host") {
        const q = db.quizzes.find((q: any) => q.id === body.id);
        if (!q) throw new GameError("Quiz not found.", 404);
        let r = createRoom(q);
        while (db.rooms.some((x: any) => x.code === r.code)) r = createRoom(q);
        db.rooms.push(r);
        return { code: r.code };
      }
      const room = roomFor(db, body.code);
      if (body.action === "remove") {
        if (room.phase !== "LOBBY")
          throw new GameError("Remove players before starting.");
        room.players = room.players.filter((p: any) => p.id !== body.playerId);
        room.revision++;
      } else if (body.action === "export") {
        const escape = (v: any) =>
          '"' +
          String(v)
            .replace(/^[=+@\-\t\r]/, "'$&")
            .replaceAll('"', '""') +
          '"';
        const count =
          room.phase === "FINISHED"
            ? room.quiz.questions.length
            : snapshot(room, null, true).revealedCount;
        const rows = [
          [
            "Rank",
            "Name",
            "Score",
            "Revealed questions",
            "Status",
            ...room.quiz.questions
              .slice(0, count)
              .map((q: any, i: number) => `Q${i + 1}: ${q.prompt}`),
          ],
          ...rankings(room).map((p: any) => [
            p.rank,
            p.name,
            p.score,
            count,
            room.phase,
            ...room.quiz.questions.slice(0, count).map((q: any, i: number) => {
              const a = room.answers[`${i}:${p.id}`];
              return !a
                ? "Unanswered"
                : a.choice === q.correct
                  ? "Correct"
                  : "Incorrect";
            }),
          ]),
        ];
        return {
          csv:
            "\uFEFF" +
            rows.map((row) => row.map(escape).join(",")).join("\r\n"),
        };
      } else {
        if (body.revision !== room.revision)
          throw new GameError(
            "The room changed. Refreshing its state; try again.",
            409,
          );
        command(room, body.action);
      }
      return snapshot(room, null, true);
    });
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
