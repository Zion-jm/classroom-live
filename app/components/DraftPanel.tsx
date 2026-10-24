"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { backendRequest, cloudMode, supabaseClient } from "../../lib/backend";
export type DraftHandle = {
  publish: () => Promise<any>;
  isDirty: () => boolean;
};
const DraftPanel = forwardRef<
  DraftHandle,
  {
    kind: "editor" | "import";
    payload: any;
    restore?: any;
    onRecover: (payload: any) => void;
  }
>(function DraftPanel({ kind, payload, restore, onRecover }, ref) {
  const [status, setStatus] = useState("Draft not saved yet"),
    [key, setKey] = useState(""),
    [recovery, setRecovery] = useState<any>(null),
    [conflict, setConflict] = useState(false),
    [saving, setSaving] = useState(false);
  const record = useRef({
    id: restore?.id || crypto.randomUUID(),
    revision: restore?.revision || 0,
  });
  const pending = useRef(payload),
    saved = useRef(restore ? JSON.stringify(restore.payload) : ""),
    chain = useRef(Promise.resolve()),
    alive = useRef(true),
    blocked = useRef(false),
    sequence = useRef(0);
  const queued = useRef(saved.current),
    published = useRef(false);
  pending.current = payload;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        pending.current &&
        JSON.stringify(pending.current) !== saved.current
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void (async () => {
      const owner = cloudMode
        ? (await supabaseClient().auth.getUser()).data.user?.id
        : "local-teacher";
      if (!owner) throw Error("Sign in to save drafts.");
      const k = `classroom-draft:${cloudMode ? process.env.NEXT_PUBLIC_SUPABASE_URL : "local"}:${owner}:${kind}`;
      if (!active) return;
      setKey(k);
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const previous = JSON.parse(raw);
          if (
            previous.payload &&
            JSON.stringify(previous.payload) !==
              JSON.stringify(restore?.payload) &&
            (!restore ||
              previous.updatedAt > new Date(restore.updated_at).getTime())
          ) {
            blocked.current = true;
            setRecovery(previous);
            setStatus("Recovery copy available");
          }
        }
      } catch {
        setStatus(
          "Device recovery storage unavailable; cloud saving is still available.",
        );
      }
    })().catch((e) => {
      if (active) setStatus(e.message);
    });
    return () => {
      active = false;
      alive.current = false;
    };
  }, []);
  function persistLocal(value: any) {
    if (!key) return false;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          payload: value,
          ...record.current,
          updatedAt: Date.now(),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  function flush() {
    const value = structuredClone(pending.current),
      text = JSON.stringify(value);
    if (!value || published.current) return chain.current;
    if (blocked.current)
      return Promise.reject(
        Error("Resolve draft recovery/conflict before saving."),
      );
    if (text === queued.current) return chain.current;
    queued.current = text;
    const seq = ++sequence.current;
    if (alive.current) setSaving(true);
    chain.current = chain.current
      .catch(() => {})
      .then(async () => {
        if (alive.current) setStatus("Saving draft…");
        try {
          const r = await backendRequest({
            action: "draft_save",
            ...record.current,
            kind,
            payload: value,
          });
          record.current = { id: r.id, revision: r.revision };
          saved.current = text;
          if (alive.current) {
            persistLocal(pending.current);
            setStatus(
              seq === sequence.current
                ? "Draft saved"
                : "Saving newer changes…",
            );
          }
          return r;
        } catch (e) {
          const message = (e as Error).message;
          if (/conflict|discarded|changed/i.test(message)) {
            blocked.current = true;
            if (alive.current) setConflict(true);
          }
          if (alive.current)
            setStatus(
              `${persistLocal(pending.current) ? "Saved on this device; cloud save failed" : "Draft save failed"}: ${message}`,
            );
          if (seq === sequence.current) queued.current = saved.current;
          throw e;
        } finally {
          if (alive.current && seq === sequence.current) setSaving(false);
        }
      });
    return chain.current;
  }
  useEffect(() => {
    if (!payload || !key || blocked.current) return;
    const local = persistLocal(payload);
    if (JSON.stringify(payload) === saved.current) return;
    setStatus(
      local
        ? "Changes protected on this device"
        : "Saving changes; device recovery unavailable",
    );
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [JSON.stringify(payload), key, recovery, conflict]);
  useEffect(() => {
    const retry = () => {
      if (!blocked.current && !published.current && !document.hidden)
        void flush().catch(() => {});
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [key]);
  useImperativeHandle(ref, () => ({
    isDirty: () =>
      !!pending.current && JSON.stringify(pending.current) !== saved.current,
    publish: async () => {
      await flush();
      published.current = true;
      let result;
      try {
        result = await backendRequest({
          action: "draft_publish",
          ...record.current,
        });
      } catch (e) {
        published.current = false;
        throw e;
      }
      try {
        if (key) localStorage.removeItem(key);
      } catch {}
      saved.current = JSON.stringify(pending.current);
      return result;
    },
  }));
  return (
    <div className="draft-panel">
      <div role="status">{status}</div>
      <div className="button-row">
        <button
          type="button"
          className="text-button"
          disabled={!payload || !!recovery || conflict}
          onClick={() => void flush().catch(() => {})}
        >
          Save draft now
        </button>
        {payload?.quiz?.id && (
          <button
            type="button"
            className="text-button"
            disabled={saving}
            onClick={() => {
              const copy = structuredClone(pending.current);
              delete copy.quiz.id;
              delete copy.quiz.revision;
              record.current = { id: crypto.randomUUID(), revision: 0 };
              saved.current = "";
              queued.current = "";
              blocked.current = false;
              setConflict(false);
              onRecover(copy);
              setStatus("Detached copy ready. Save this as a new quiz.");
            }}
          >
            Keep edits as a new quiz
          </button>
        )}
        {conflict && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                record.current = { id: crypto.randomUUID(), revision: 0 };
                saved.current = "";
                queued.current = "";
                blocked.current = false;
                setConflict(false);
                void flush().catch(() => {});
              }}
            >
              Save recovery as new draft
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void (async () => {
                  if (!confirm("Replace local edits with the cloud version?"))
                    return;
                  const r = await backendRequest({
                    action: "draft_load",
                    id: record.current.id,
                  });
                  record.current = { id: r.id, revision: r.revision };
                  saved.current = JSON.stringify(r.payload);
                  queued.current = saved.current;
                  blocked.current = false;
                  setConflict(false);
                  onRecover(r.payload);
                  setStatus("Loaded cloud draft");
                })().catch((e) => setStatus(e.message))
              }
            >
              Reload cloud version
            </button>
          </>
        )}
      </div>
      {recovery && (
        <div className="notice">
          <p>
            Unfinished work from this teacher account is available on this
            device.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                record.current = { id: crypto.randomUUID(), revision: 0 };
                saved.current = "";
                queued.current = "";
                blocked.current = false;
                setRecovery(null);
                onRecover(recovery.payload);
              }}
            >
              Recover as new draft
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (!confirm("Discard this device recovery copy?")) return;
                localStorage.removeItem(key);
                blocked.current = false;
                setRecovery(null);
                setStatus("Recovery discarded");
              }}
            >
              Discard device recovery
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
export default DraftPanel;
