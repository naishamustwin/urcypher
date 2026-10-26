# URCypher.com

The RSVP site for URCypher, South Florida's Biggest Cypher, an Urban Relations production. One page; every RSVP lands in a Google Sheet.

```
public/                     The website
  index.html                The page
  404.html                  "Page not found" page
  assets/styles.css         URCypher brand and layout
  assets/app.js             The RSVP form
  assets/fonts/             Self-hosted Archivo and IBM Plex Mono
  og-image.png              Link preview for Instagram, iMessage, X
  favicon-32.png, apple-touch-icon.png, icon-512.png
netlify/functions/rsvp.mjs  Relay: browser > Netlify > Google Sheet (also the setup check)
apps-script/Code.gs         Paste into the Google Sheet's Apps Script editor
netlify.toml                Netlify settings and security headers
```

## How an RSVP travels

Form on urcypher.com → `/api/rsvp` (Netlify function) → Apps Script web app → **RSVPs** tab in the Sheet.
The form shows "You're in the queue" **only** after the Sheet confirms it wrote the row. Anything else shows an error, keeps the artist's answers, and points them to URCypherTeam@gmail.com.

## What's different from URVoteMatters (lessons built in)

| What went wrong on URVoteMatters | What URCypher does |
|---|---|
| Browser autofill filled the hidden spam field, so real signups were thrown away with a fake success message | Nothing is ever thrown away. Suspected spam is saved with Status **Review** and a note saying why |
| `ALLOWED_ORIGIN` blocked the netlify.app test address | The site's own address is always allowed: urcypher.com, www, and every *.netlify.app preview. `ALLOWED_ORIGIN` is optional |
| Rows went to a "Signups" tab people didn't see | `setup` puts the **RSVPs** tab first and opens it |
| Hard to tell which link in the chain was broken | Open **urcypher.com/api/rsvp** in a browser for a setup check that names the exact fix |
| GitHub upload flattened the folders | Push with the folder structure intact (Claude can push it for you) |

## Setup

### 1. The Google Sheet (about 10 minutes)

1. Create a blank Google Sheet named **URCypher RSVPs** (sign in as the account that should own the data, e.g. URCypherTeam@gmail.com).
2. **Extensions > Apps Script.** Delete what's there, paste all of `apps-script/Code.gs`, click Save.
3. Gear icon (**Project Settings**) > **Script properties** > **Add script property**:
   - `RSVP_SECRET` = the long password Claude gave you (or any 32+ random characters)
   - Optional: `NOTIFY_EMAIL` = URCypherTeam@gmail.com to get an email for every new RSVP
   - Click **Save script properties**.
4. Back in the editor (`< >` icon), pick **setup** in the function dropdown and click **Run**. Approve the permissions (on "Google hasn't verified this app": **Advanced > Go to … (unsafe)** > **Allow**; it's your own script). An **RSVPs** tab with blue headers appears.
5. **Deploy > New deployment** > gear > **Web app**. Execute as: **Me**. Who has access: **Anyone**. **Deploy**. Copy the **Web app URL** (ends in `/exec`).

"Anyone" lets Netlify reach the script. Your data is still protected: the script ignores any request without the secret, and opening the URL only shows `{"ok":true,"service":"URCypher RSVP receiver"}`.

**Changed the script later?** Deploy > Manage deployments > pencil > Version: **New version** > Deploy. Saving alone doesn't update the live script.

### 2. Netlify

1. Put this folder in a GitHub repo with the folders intact, then Netlify: **Add new site > Import an existing project > GitHub** and pick it. Leave the build settings; `netlify.toml` handles them. (Drag-and-drop deploys don't run the form function.)
2. **Site configuration > Environment variables**:

   | Key | Value |
   |---|---|
   | `APPS_SCRIPT_URL` | the `/exec` URL from step 1.5 |
   | `RSVP_SECRET` | exactly the same password as in Apps Script |

3. **Deploys > Trigger deploy.** Netlify only reads new variables on the next deploy.
4. **Domain management > Add a domain > urcypher.com**, then follow Netlify's DNS steps at your registrar. HTTPS is automatic.

### 3. Test before you post

1. Open `https://<your-site>.netlify.app/api/rsvp`. It should say `"Everything is connected."` If not, it tells you the one thing to fix.
2. Send a real RSVP with your own details. Check the RSVPs tab for the row.
3. Send it again with the same email. You'll get a second row marked **Repeat**.

## Working the Sheet

- **Status** is a dropdown: New, Review, Confirmed, Waitlist, Declined, Details sent. Change it as the team works through RSVPs.
- **Review** rows were flagged by the spam checks (hidden field filled, or sent in under 4 seconds). Most are real people whose browser autofilled; glance and move them to New.
- **Repeat** means the same email RSVP'd before; the note gives the earlier row.
- Date and location never appear on the site. Send them to Confirmed artists yourself, then set Status to **Details sent**.

## Troubleshooting

Look in **Netlify > Logs > Functions > rsvp**. Every failure is logged in plain English:

| Log line | Fix |
|---|---|
| `Not configured` | Add both variables, then Trigger deploy |
| `did not return JSON … It returned a web page` | Deployment isn't "Anyone", or the URL ends in `/dev`. Redeploy as a New version with Anyone |
| `Apps Script refused the RSVP: unauthorized` | The two `RSVP_SECRET` values don't match |
| `Blocked: request came from a site that is not allowed` | Add that address to `ALLOWED_ORIGIN` |
| `RSVP saved for review (possible spam)` | Not an error. The row is in the Sheet with Status Review |
