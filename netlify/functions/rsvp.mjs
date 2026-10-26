/**
 * /api/rsvp  — relay between the URCypher RSVP form and the Google Sheet.
 *
 *   POST /api/rsvp   save one RSVP (called by the form)
 *   GET  /api/rsvp   setup check: shows which link in the chain works, never any data
 *
 * The browser never sees the Apps Script URL or the shared secret.
 * Netlify > Site configuration > Environment variables:
 *   APPS_SCRIPT_URL   the Apps Script web app URL (ends in /exec)
 *   RSVP_SECRET       a long random string, identical to the one in Apps Script
 *   ALLOWED_ORIGIN    optional extra sites, comma separated (the site's own address is always allowed)
 *   MAILCHIMP_API_KEY     optional: adds each RSVP to Mailchimp (key ends in -us21 or similar)
 *   MAILCHIMP_AUDIENCE_ID optional: the Mailchimp audience to add them to
 *   MAILCHIMP_TAG         optional: tag to apply (default "URCypher RSVP")
 *
 * Lessons from URVoteMatters, built in:
 *   - Suspected spam is SAVED with Status "Review", never silently thrown away.
 *   - The site's own address (urcypher.com, www, any *.netlify.app preview) is always allowed.
 *   - The form only shows success when the Sheet confirms the row was written.
 *   - Every failure is logged with a plain-English reason (Netlify > Logs > Functions > rsvp).
 */

import { createHash } from "node:crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IG_RE = /^[A-Za-z0-9._]{1,30}$/;
const YT_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/\S+$/i;
const GENRES = new Set(["Hip-hop / Rap", "R&B / Singer", "Dancehall", "Reggae", "Pop", "Bouyon", "Other"]);
const HEARD = new Set(["Instagram or Facebook ad", "Instagram post or story", "TikTok", "Friend or another artist",
  "WhatsApp or text", "Flyer", "At an event", "Other"]);
const LOCATIONS = new Set(["Broward", "Miami", "West Palm Beach", "Other"]);
const SCRIPT_VERSION = 5; // bump together with SCRIPT_VERSION in apps-script/Code.gs
const MIN_FILL_MS = 4000;
const BUILT_IN_ORIGINS = ["https://urcypher.com", "https://www.urcypher.com"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

const clean = (v, max) =>
  String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);

function normUrl(v) {
  v = String(v ?? "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.href.slice(0, 300);
  } catch {
    return null;
  }
}

function originAllowed(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin requests from some browsers omit it
  let oHost;
  try { oHost = new URL(origin).host; } catch { return false; }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host && oHost === host) return true; // the page and the function are the same site
  const list = [
    ...BUILT_IN_ORIGINS,
    process.env.URL, process.env.DEPLOY_URL, process.env.DEPLOY_PRIME_URL,
    ...String(process.env.ALLOWED_ORIGIN || "").split(",")
  ].map((s) => String(s || "").trim().replace(/\/+$/, "")).filter(Boolean);
  if (list.includes(origin.replace(/\/+$/, ""))) return true;
  const site = process.env.SITE_NAME;
  if (site && (oHost === `${site}.netlify.app` || oHost.endsWith(`--${site}.netlify.app`))) return true;
  return false;
}

async function callScript(payload, timeoutMs = 15000) {
  const res = await fetch(process.env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  try {
    return { http: res.status, data: JSON.parse(text) };
  } catch {
    // An HTML page here almost always means a Google sign-in page:
    // the deployment is not set to "Who has access: Anyone", or the URL ends in /dev.
    return { http: res.status, data: null, html: /<html/i.test(text) };
  }
}

async function setupCheck() {
  const checks = {
    settings: !!(process.env.APPS_SCRIPT_URL && process.env.RSVP_SECRET),
    scriptUrlLooksRight: /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(process.env.APPS_SCRIPT_URL || ""),
    scriptReachable: false,
    secretMatches: false,
    sheetReady: false,
    scriptUpToDate: false,
    mailchimp: mailchimpConfigured() ? false : "not connected (optional)"
  };
  let fix = null;
  if (!checks.settings) fix = "Add APPS_SCRIPT_URL and RSVP_SECRET in Netlify, then trigger a new deploy.";
  else {
    try {
      const r = await callScript({ action: "ping", secret: process.env.RSVP_SECRET }, 12000);
      if (!r.data) fix = r.html
        ? "Google returned a sign-in page. In Apps Script: Deploy > Manage deployments > edit > Who has access: Anyone > Version: New version > Deploy."
        : "The Apps Script URL did not answer correctly. Re-copy the Web app URL into APPS_SCRIPT_URL and redeploy.";
      else {
        checks.scriptReachable = true;
        if (r.data.error === "unauthorized") fix = "RSVP_SECRET in Netlify does not match the RSVP_SECRET script property in Apps Script. Make them identical (no spaces), then redeploy.";
        else if (r.data.ok) {
          checks.secretMatches = true;
          checks.sheetReady = !!r.data.sheetReady;
          checks.scriptUpToDate = Number(r.data.version || 1) >= SCRIPT_VERSION;
          checks.scriptVersionFound = Number(r.data.version || 1);
          checks.scriptVersionNeeded = SCRIPT_VERSION;
          if (!checks.sheetReady) fix = "Run the setup function once in Apps Script to create the RSVPs tab.";
          else if (!checks.scriptUpToDate) fix = "The script this site is connected to is version " + checks.scriptVersionFound + ", not " + SCRIPT_VERSION + ". Either APPS_SCRIPT_URL in Netlify points to a different (older) script or deployment, or the new code was pasted without deploying a New version. Paste the latest Code.gs, Save, then Deploy > Manage deployments > pencil > Version: New version > Deploy. RSVPs still save meanwhile, just without the newest columns.";
        } else fix = "Apps Script answered with: " + r.data.error;
      }
    } catch (err) {
      fix = "Could not reach Apps Script (" + (err && err.message) + "). Check APPS_SCRIPT_URL.";
    }
  }
  if (checks.settings && !checks.scriptUrlLooksRight && !fix)
    fix = "APPS_SCRIPT_URL should start with https://script.google.com/macros/s/ and end in /exec (not /dev).";
  if (mailchimpConfigured()) {
    try {
      const mc = await mailchimpRequest("GET", `/lists/${process.env.MAILCHIMP_AUDIENCE_ID}?fields=name`);
      if (mc.ok) checks.mailchimp = true;
      else if (!fix) fix = mc.status === 401
        ? "Mailchimp rejected the API key. Re-copy MAILCHIMP_API_KEY (it ends in something like -us21), then redeploy."
        : mc.status === 404
          ? "Mailchimp can't find that audience. Re-copy MAILCHIMP_AUDIENCE_ID from Audience > Settings > Audience name and defaults, then redeploy."
          : "Mailchimp answered with an error (" + mc.status + "). Check both Mailchimp settings.";
    } catch (err) {
      if (!fix) fix = "Could not reach Mailchimp: " + (err && err.message);
    }
  }
  const allGood = Object.values(checks).every(Boolean);
  return json(allGood ? 200 : 503, { ok: allGood, checks, fix: allGood ? "Everything is connected. Submit a test RSVP." : fix });
}

export default async (req) => {
  if (req.method === "GET") return setupCheck();
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  if (!originAllowed(req)) {
    console.error("Blocked: request came from a site that is not allowed:", req.headers.get("origin"),
      "— add it to ALLOWED_ORIGIN if it is yours.");
    return json(403, { ok: false, error: "forbidden" });
  }

  const { APPS_SCRIPT_URL, RSVP_SECRET } = process.env;
  if (!APPS_SCRIPT_URL || !RSVP_SECRET) {
    console.error("Not configured: set APPS_SCRIPT_URL and RSVP_SECRET in Netlify, then redeploy.");
    return json(500, { ok: false, error: "not_configured" });
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return json(413, { ok: false, error: "too_large" });
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }

  const bad = (field, message) => json(400, { ok: false, field, message });

  const firstName = clean(body.firstName, 60);
  const lastName = clean(body.lastName, 60);
  const stageName = clean(body.stageName, 80);
  const instagram = clean(body.instagram, 40).replace(/^@+/, "");
  const genre = clean(body.genre, 30);
  const phone = clean(body.phone, 25);
  const email = clean(body.email, 254).toLowerCase();
  const youtube = (Array.isArray(body.youtube) ? body.youtube : String(body.youtube || "").split(/\s+/))
    .map((s) => normUrl(s)).filter((s) => s !== "");
  const profile = normUrl(body.profile);
  const website = normUrl(body.website);

  if (!firstName) return bad("firstName", "Enter your first name.");
  if (!lastName) return bad("lastName", "Enter your last name.");
  if (!stageName) return bad("stageName", "Enter your stage name.");
  if (!IG_RE.test(instagram)) return bad("instagram", "Use only letters, numbers, periods and underscores.");
  if (!GENRES.has(genre)) return bad("genre", "Choose your genre.");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return bad("phone", "Enter a full phone number with area code.");
  if (!EMAIL_RE.test(email)) return bad("email", "Check your email address. It should look like name@example.com.");
  if (!youtube.length) return bad("youtube", "Add at least one YouTube link.");
  if (youtube.length > 5) return bad("youtube", "Send up to 5 YouTube links.");
  if (youtube.some((l) => l === null || !YT_RE.test(l))) return bad("youtube", "Each link should be a YouTube link, one per line.");
  if (!profile) return bad("profile", "Add a link to your artist profile.");
  if (website === null) return bad("website", "Check this link, or leave it empty.");
  const heardFrom = clean(body.heardFrom, 40);
  if (!HEARD.has(heardFrom)) return bad("heardFrom", "Tell us how you heard about URCypher.");
  const tracking = clean(body.tracking, 200);
  const locChoice = clean(body.location, 30);
  if (!LOCATIONS.has(locChoice)) return bad("location", "Choose your location.");
  const locOther = clean(body.locationOther, 60);
  if (locChoice === "Other" && !locOther) return bad("locationOther", "Type your location.");
  const location = locChoice === "Other" ? `Other: ${locOther}` : locChoice;

  // Spam signals are recorded, not used to throw RSVPs away.
  const flags = [];
  if (body.trap && String(body.trap).trim() !== "") flags.push("hidden field filled");
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_FILL_MS) flags.push(`sent in ${Math.round(body.elapsedMs / 100) / 10}s`);
  if (flags.length) console.warn("RSVP saved for review (possible spam):", flags.join(", "), "-", stageName);

  const record = {
    action: "rsvp",
    secret: RSVP_SECRET,
    firstName, lastName, stageName, instagram, genre, phone, email,
    youtube, profile, website: website || "", heardFrom, tracking, location,
    review: flags.join(", "),
    source: (() => { try { return new URL(req.url).host; } catch { return "urcypher.com"; } })()
  };

  try {
    const r = await callScript(record);
    if (!r.data) {
      console.error("Apps Script did not return JSON (HTTP " + r.http + ").",
        r.html ? "It returned a web page: the deployment is probably not set to 'Anyone', or the URL ends in /dev." : "");
      return json(502, { ok: false, error: "upstream" });
    }
    if (!r.data.ok || !r.data.row) {
      console.error("Apps Script refused the RSVP:", r.data.error || "no row number returned");
      return json(502, { ok: false, error: "upstream" });
    }
    console.log(`RSVP saved to row ${r.data.row}${r.data.status === "repeat" ? " (repeat email)" : ""}: ${stageName}` +
      (r.data.email ? ` | artist email: ${r.data.email}` : ""));
    // Mailchimp is a copy for future campaigns. It never blocks or undoes a saved RSVP.
    if (mailchimpConfigured() && !flags.length) {
      try {
        const res = await addToMailchimp({ email, firstName, lastName, stageName, genre, location });
        console.log("Mailchimp:", res);
      } catch (err) {
        console.error("Mailchimp sync failed (RSVP is still saved in the Sheet):", err && err.message);
      }
    }
    return json(200, { ok: true, saved: true, status: r.data.status === "repeat" ? "repeat" : "new" });
  } catch (err) {
    console.error("Could not reach Apps Script:", err && err.message);
    return json(502, { ok: false, error: "upstream" });
  }
};

// ---------- Mailchimp ----------
function mailchimpConfigured() {
  return !!(process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_AUDIENCE_ID);
}

async function mailchimpRequest(method, path, body) {
  const key = process.env.MAILCHIMP_API_KEY.trim();
  const dc = key.split("-")[1];
  if (!dc) throw new Error("MAILCHIMP_API_KEY should end in a data center like -us21");
  const base = process.env.MAILCHIMP_API_BASE || `https://${dc}.api.mailchimp.com/3.0`;
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from("urcypher:" + key).toString("base64"),
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000)
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function addToMailchimp({ email, firstName, lastName, stageName, genre, location }) {
  const list = process.env.MAILCHIMP_AUDIENCE_ID.trim();
  const hash = createHash("md5").update(email.toLowerCase()).digest("hex");
  const path = `/lists/${list}/members/${hash}?skip_merge_validation=true`;
  const full = { FNAME: firstName, LNAME: lastName, STAGENAME: stageName, GENRE: genre, LOCATION: location };
  let r = await mailchimpRequest("PUT", path, { email_address: email, status_if_new: "subscribed", merge_fields: full });
  if (!r.ok && r.status === 400) {
    // Usually a merge field that doesn't exist in the audience yet: retry with the built-in name fields only.
    console.warn("Mailchimp refused some fields, retrying with first and last name only:", r.data && r.data.detail);
    r = await mailchimpRequest("PUT", path, { email_address: email, status_if_new: "subscribed", merge_fields: { FNAME: firstName, LNAME: lastName } });
  }
  if (!r.ok) throw new Error(`member ${r.status} ${(r.data && (r.data.detail || r.data.title)) || ""}`.trim());
  const tag = (process.env.MAILCHIMP_TAG || "URCypher RSVP").trim();
  const t = await mailchimpRequest("POST", `/lists/${list}/members/${hash}/tags`, { tags: [{ name: tag, status: "active" }] });
  if (!t.ok) throw new Error(`tag ${t.status} ${(t.data && t.data.detail) || ""}`.trim());
  return `added ${email} (${r.data && r.data.status}), tagged "${tag}"`;
}

export const config = {
  path: "/api/rsvp",
  // Netlify's built-in rate limiting: 6 requests a minute per visitor.
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
