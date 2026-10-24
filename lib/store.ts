import fs from "node:fs";
import path from "node:path";
import { seed } from "./engine.mjs";
const dir = path.join(process.cwd(), ".local");
const file = path.join(dir, "database.json");
// Synchronous read/mutate/atomic rename serializes requests in one local Node process.
// This adapter is intentionally forbidden on Vercel; replace with PostgreSQL RPCs.
export function transaction<T>(fn: (db: any) => T): T {
  if (process.env.VERCEL)
    throw new Error(
      "Local adapter cannot run on Vercel. Configure Supabase first.",
    );
  fs.mkdirSync(dir, { recursive: true });
  const db = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : seed();
  const result = fn(db);
  fs.writeFileSync(file + ".tmp", JSON.stringify(db));
  fs.renameSync(file + ".tmp", file);
  return result;
}
