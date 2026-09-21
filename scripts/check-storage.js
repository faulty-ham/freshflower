// Daily Supabase usage check across both projects in the org (the shared
// FreshFlower/VaporTrails project, and ListenLog's own project).
//
// Checks BOTH quotas that are actually "storage" in Supabase's sense:
//   - Storage size  (file buckets)      -- Free plan limit: 1024 MB
//   - Database size (Postgres data)     -- Free plan limit:  500 MB
// (Egress/bandwidth is a separate, non-storage quota and isn't covered
// here.) Both are billed org-wide, so this sums each metric across both
// projects before comparing it to the limit -- matching how Supabase
// actually enforced the September 2026 restriction.
//
// Emails you whenever either metric crosses a new 10% checkpoint (10%,
// 20%, ... 100%, and beyond) since the last run, in either direction --
// so you hear about it both as usage climbs and when a cleanup brings it
// back down. Each email also reports whether usage is trending up or
// down, based on a small history file (scripts/storage-state.json) that
// the workflow commits back to the repo after every run.
//
// Runs on Node 22. Needs the "pg" package in addition to the existing
// "nodemailer" dependency -- see the package.json note in the setup
// instructions.

import nodemailer from "nodemailer";
import pg from "pg";
import fs from "fs";

const STORAGE_LIMIT_MB = Number(process.env.STORAGE_LIMIT_MB || 1024); // Free plan: 1 GB Storage
const DB_LIMIT_MB      = Number(process.env.DB_LIMIT_MB || 500);       // Free plan: 500 MB Database
const CHECKPOINT_STEP  = 10; // percent
const STATE_FILE       = "storage-state.json";
const HISTORY_LENGTH   = 14; // days kept, for trend calculation
const TREND_WINDOW     = 7;  // compare today vs ~this many readings back
const TREND_DEADBAND_PCT = 1; // % of limit -- smaller moves are "holding steady"

const PROJECTS = [
  {
    label: "FreshFlower / VaporTrails (shared)",
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    dbUrl: process.env.SUPABASE_DB_URL,
  },
  {
    label: "ListenLog",
    url: process.env.LISTENLOG_SUPABASE_URL,
    serviceKey: process.env.LISTENLOG_SUPABASE_SERVICE_KEY,
    dbUrl: process.env.LISTENLOG_DB_URL,
  },
];

// ---------- Storage (file bucket) size, via the Storage REST API ----------

async function listAllObjects(url, key, bucket, prefix = "") {
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`Unexpected response listing ${bucket}/${prefix}: ${JSON.stringify(body)}`);
  let total = 0;
  for (const entry of body) {
    if (entry.id === null) {
      total += await listAllObjects(url, key, bucket, `${prefix}${entry.name}/`);
    } else {
      total += entry.metadata?.size ?? 0;
    }
  }
  return total;
}

async function projectStorageBytes(project) {
  if (!project.url || !project.serviceKey) {
    console.log(`  [${project.label}] Storage — skipped, no URL/service key configured`);
    return { label: project.label, bytes: 0, buckets: [] };
  }
  const res = await fetch(`${project.url}/storage/v1/bucket`, {
    headers: { apikey: project.serviceKey, Authorization: `Bearer ${project.serviceKey}` },
  });
  const buckets = await res.json();
  if (!Array.isArray(buckets)) throw new Error(`Could not list buckets for ${project.label}: ${JSON.stringify(buckets)}`);
  let total = 0;
  const perBucket = [];
  for (const b of buckets) {
    const bytes = await listAllObjects(project.url, project.serviceKey, b.name);
    perBucket.push({ name: b.name, bytes });
    total += bytes;
  }
  return { label: project.label, bytes: total, buckets: perBucket };
}

// ---------- Database size, via a direct Postgres query ----------

async function projectDbBytes(project) {
  if (!project.dbUrl) {
    console.log(`  [${project.label}] Database — skipped, no DB connection string configured`);
    return { label: project.label, bytes: 0 };
  }
  const client = new pg.Client({ connectionString: project.dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query("select pg_database_size(current_database()) as bytes");
    return { label: project.label, bytes: Number(rows[0].bytes) };
  } finally {
    await client.end();
  }
}

// ---------- State file: history + checkpoint/trend math ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { storage: { history: [] }, db: { history: [] } };
  }
}

function updateHistory(history, todayMB) {
  const today = new Date().toISOString().slice(0, 10);
  const withoutToday = history.filter(h => h.date !== today);
  const updated = [...withoutToday, { date: today, mb: todayMB }];
  updated.sort((a, b) => a.date.localeCompare(b.date));
  return updated.slice(-HISTORY_LENGTH);
}

function checkpointBucket(mb, limitMB) {
  return Math.floor((mb / limitMB) * 100 / CHECKPOINT_STEP) * CHECKPOINT_STEP;
}

function describeTrend(history, limitMB) {
  if (history.length < 2) return "not enough history yet to show a trend";
  const latest = history[history.length - 1].mb;
  const idx = Math.max(0, history.length - 1 - TREND_WINDOW);
  const compareEntry = history[idx];
  const deltaMB = latest - compareEntry.mb;
  const days = history.length - 1 - idx;
  const deadband = (TREND_DEADBAND_PCT / 100) * limitMB;
  const dayLabel = days === 1 ? "1 day" : `${days} days`;
  if (Math.abs(deltaMB) < deadband) return `holding steady (${deltaMB >= 0 ? "+" : ""}${deltaMB.toFixed(1)} MB over the last ${dayLabel})`;
  return `trending ${deltaMB > 0 ? "up" : "down"} ${Math.abs(deltaMB).toFixed(1)} MB over the last ${dayLabel}`;
}

// ---------- Email ----------

async function sendAlert(crossedMetrics, metrics) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_TO) {
    console.log("  (email not configured, skipping alert send)");
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const anyUrgent = crossedMetrics.some(m => m.pct >= 90);
  const subjectBits = crossedMetrics.map(m => `${m.name} ${m.bucket}%`).join(", ");
  let html = `<h2>${anyUrgent ? "🚨" : "⚠️"} Supabase usage checkpoint: ${subjectBits}</h2><ul>`;
  for (const m of metrics) {
    const crossed = crossedMetrics.find(c => c.name === m.name);
    html += `<li><b>${m.name}</b>: ${m.totalMB.toFixed(1)} MB / ${m.limitMB} MB (${m.pct.toFixed(0)}%)`;
    html += crossed ? ` — <b>just crossed the ${crossed.bucket}% checkpoint</b>` : ` — no new checkpoint this run`;
    html += `<br>${m.trend}`;
    html += `<ul>${m.perProject.map(p => `<li>${p.label}: ${(p.bytes / 1048576).toFixed(1)} MB</li>`).join("")}</ul>`;
    html += `</li>`;
  }
  html += `</ul><p>Dashboard: https://supabase.com/dashboard/org/uvvhbquxuzhxccssgnsp/usage</p>`;
  await transporter.sendMail({
    from: `"Supabase Storage Monitor" <${SMTP_USER}>`, to: ALERT_TO,
    subject: `${anyUrgent ? "🚨" : "⚠️"} Supabase checkpoint: ${subjectBits}`,
    html,
  });
  console.log(`  Alert email sent to ${ALERT_TO}`);
}

// ---------- Main ----------

async function main() {
  console.log("Checking Supabase usage (Storage + Database size)...");
  const state = loadState();

  const storageResults = [];
  const dbResults = [];
  for (const project of PROJECTS) {
    const s = await projectStorageBytes(project);
    storageResults.push(s);
    console.log(`  [${s.label}] Storage: ${(s.bytes / 1048576).toFixed(1)} MB across ${s.buckets.length} bucket(s)`);

    const d = await projectDbBytes(project);
    dbResults.push(d);
    console.log(`  [${d.label}] Database: ${(d.bytes / 1048576).toFixed(1)} MB`);
  }

  const storageTotalMB = storageResults.reduce((sum, r) => sum + r.bytes, 0) / 1048576;
  const dbTotalMB = dbResults.reduce((sum, r) => sum + r.bytes, 0) / 1048576;

  const prevStorageBucket = state.storage.history.length
    ? checkpointBucket(state.storage.history[state.storage.history.length - 1].mb, STORAGE_LIMIT_MB)
    : 0;
  const prevDbBucket = state.db.history.length
    ? checkpointBucket(state.db.history[state.db.history.length - 1].mb, DB_LIMIT_MB)
    : 0;

  state.storage.history = updateHistory(state.storage.history, storageTotalMB);
  state.db.history = updateHistory(state.db.history, dbTotalMB);

  const storageBucket = checkpointBucket(storageTotalMB, STORAGE_LIMIT_MB);
  const dbBucket = checkpointBucket(dbTotalMB, DB_LIMIT_MB);

  const metrics = [
    {
      name: "Storage size", totalMB: storageTotalMB, limitMB: STORAGE_LIMIT_MB,
      pct: (storageTotalMB / STORAGE_LIMIT_MB) * 100,
      trend: describeTrend(state.storage.history, STORAGE_LIMIT_MB),
      perProject: storageResults,
    },
    {
      name: "Database size", totalMB: dbTotalMB, limitMB: DB_LIMIT_MB,
      pct: (dbTotalMB / DB_LIMIT_MB) * 100,
      trend: describeTrend(state.db.history, DB_LIMIT_MB),
      perProject: dbResults,
    },
  ];

  console.log(`\nStorage size: ${storageTotalMB.toFixed(1)} / ${STORAGE_LIMIT_MB} MB (${metrics[0].pct.toFixed(1)}%) — ${metrics[0].trend}`);
  console.log(`Database size: ${dbTotalMB.toFixed(1)} / ${DB_LIMIT_MB} MB (${metrics[1].pct.toFixed(1)}%) — ${metrics[1].trend}`);

  const crossed = [];
  if (storageBucket !== prevStorageBucket) crossed.push({ name: "Storage size", bucket: storageBucket, pct: metrics[0].pct });
  if (dbBucket !== prevDbBucket) crossed.push({ name: "Database size", bucket: dbBucket, pct: metrics[1].pct });

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

  if (crossed.length) {
    console.log(`  Checkpoint(s) crossed: ${crossed.map(c => `${c.name} -> ${c.bucket}%`).join(", ")}`);
    await sendAlert(crossed, metrics);
  } else {
    console.log("  No new checkpoint crossed, no email sent.");
  }
}

main().catch(err => {
  console.error("Storage check failed:", err);
  process.exit(1);
});
