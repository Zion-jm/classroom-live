import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const cloudMode = process.env.NEXT_PUBLIC_BACKEND === "supabase";
export const playerStorageKey = cloudMode
  ? "classroom-player-supabase"
  : "classroom-player";
let client: SupabaseClient | undefined;
export function supabaseClient() {
  if (typeof window === "undefined")
    throw new Error("Authentication requires a browser.");
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      throw new Error(
        "Set the Supabase project URL and publishable key in your environment, then restart the app.",
      );
    client = createClient(url, key, {
      auth: {
        storage: window.sessionStorage,
        storageKey: "classroom-supabase-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
function friendlyError(error: {
  message: string;
  code?: string;
  status?: number;
}) {
  if (
    error.code === "PGRST202" ||
    /classroom_request.*schema cache/i.test(error.message)
  )
    return new Error(
      "The classroom database is not installed yet. Run the migration in Supabase SQL Editor first.",
    );
  if (error.status === 429)
    return new Error(
      "Too many sign-in attempts from this network. Ask your teacher to check Supabase Auth rate limits.",
    );
  return new Error(error.message);
}
export function exportCsv(payload: any) {
  const { state, answers } = payload;
  const questions = payload.questions
    .map((q: any, i: number) => ({ ...q, canonicalIndex: i }))
    .sort(
      (a: any, b: any) =>
        (a.sourceIndex ?? a.canonicalIndex) -
        (b.sourceIndex ?? b.canonicalIndex),
    );
  const escape = (v: unknown) =>
    '"' +
    String(v)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const answerMap = new Map(
    answers.map((a: any) => [`${a.playerId}:${a.index}`, a.choice]),
  );
  const rows = [
    [
      "Rank",
      "Name",
      "Score",
      "Revealed questions",
      "Status",
      ...questions.map((q: any, i: number) => `Q${i + 1}: ${q.prompt}`),
    ],
    ...state.leaderboard.map((p: any) => [
      p.rank,
      p.name,
      p.score,
      state.revealedCount,
      state.phase,
      ...questions.map((q: any, i: number) => {
        const c = answerMap.get(`${p.id}:${q.canonicalIndex}`);
        return c === undefined
          ? "Unanswered"
          : c === q.correct
            ? "Correct"
            : "Incorrect";
      }),
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
export async function backendRequest(
  body?: any,
  query = "",
  token = "",
): Promise<any> {
  if (!cloudMode) {
    const response = await fetch(`/api/local${query}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-player-token": token },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  const supabase = supabaseClient();
  if (body?.action === "login") {
    const { error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error) throw friendlyError(error);
    const { data, error: accessError } = await supabase.rpc(
      "classroom_request",
      { body: { action: "dashboard" } },
    );
    if (accessError || !data?.admin) {
      await supabase.auth.signOut({ scope: "local" });
      throw accessError
        ? friendlyError(accessError)
        : new Error(
            "This account is not authorized as a teacher. Run the teacher authorization SQL first.",
          );
    }
    return { ok: true };
  }
  if (body?.action === "logout") {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw friendlyError(error);
    sessionStorage.removeItem(playerStorageKey);
    return { ok: true };
  }
  let {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw friendlyError(sessionError);
  if (body?.action === "join" && !session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw friendlyError(error);
    session = data.session;
  }
  const params = new URLSearchParams(query);
  const operation =
    body ||
    (params.get("code")
      ? {
          action: "snapshot",
          code: params.get("code"),
          hosting: params.get("host") === "1",
        }
      : { action: "dashboard" });
  if (!session) {
    if (operation.action === "dashboard") return { admin: false };
    throw new Error(
      "Your session expired. Rejoin the classroom or sign in again.",
    );
  }
  if (operation.action === "host" && operation.mode === "self") {
    const capability = await supabase.rpc("classroom_request", {
      body: { action: "capabilities" },
    });
    if (capability.error || !capability.data?.selfPaced)
      throw new Error(
        "Install the new self-paced SQL migration (202610240002_self_paced.sql) in Supabase before hosting this mode.",
      );
  }
  if (
    operation.action === "host" &&
    (operation.shuffleQuestions ||
      operation.shuffleChoices ||
      operation.timerMode === "quiz" ||
      operation.feedback === "session_end")
  ) {
    const { data, error } = await supabase.rpc("classroom_request", {
      body: { action: "capabilities" },
    });
    if (error || !data?.expansion)
      throw new Error(
        "Install migration 003 (expansion) before using these session settings.",
      );
  }
  const { data, error } = await supabase.rpc("classroom_request", {
    body: operation,
  });
  if (error) throw friendlyError(error);
  return operation.action === "export" ? { csv: exportCsv(data) } : data;
}

export function subscribeRoom(
  code: string,
  hosting: boolean,
  onChange: () => void,
  onStatus: (live: boolean) => void,
) {
  if (!cloudMode) return () => {};
  const supabase = supabaseClient();
  let disposed = false;
  let channel: ReturnType<SupabaseClient["channel"]> | undefined;
  // Let the SDK obtain and refresh the current JWT; do not persist a manual token.
  void supabase.realtime
    .setAuth()
    .then(() => {
      if (disposed) return;
      channel = supabase
        .channel(`${hosting ? "classroom-host" : "classroom-room"}:${code}`, {
          config: { private: true },
        })
        .on("broadcast", { event: "changed" }, onChange)
        .subscribe((status) => {
          if (!disposed) {
            onStatus(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") onChange();
          }
        });
    })
    .catch(() => {
      if (!disposed) onStatus(false);
    });
  return () => {
    disposed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
