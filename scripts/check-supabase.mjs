// Read-only connectivity check. Does not create users or change project settings.
try {
  process.loadEnvFile(".env.local");
} catch {}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error(
    "Set your project URL and publishable key in .env.local first.",
  );
try {
  const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Supabase settings returned HTTP ${response.status}. Check the project URL, key, and project status.`,
    );
  const settings = await response.json();
  console.log("Supabase project is reachable and accepts the publishable key.");
  console.log(
    `Anonymous sign-in: ${settings.external?.anonymous_users ? "enabled" : "not enabled (or not reported by settings API)"}.`,
  );
  console.log(
    "This does not verify the SQL migration, teacher authorization, Realtime, or Cron; complete the setup guide.",
  );
} catch (error) {
  console.error(`Connectivity check failed: ${error.message}`);
  process.exitCode = 1;
}
