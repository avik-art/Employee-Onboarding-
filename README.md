# Healthy Mind by Avik — Onboarding Portal (Vercel)

Fast, professional hosting on **Vercel**, with your data in **Google Sheets + Drive**.
No iframe sandbox = PDFs open, Leegality opens, everything is quick.

```
Browser  →  Vercel static pages (public/)
         →  /api  →  Vercel function (api/index.js)
                   →  Google Sheets (database) + Drive (signed PDFs, KYC)
                   →  Gmail (emails) + Leegality (eSign) + Zoho (optional)
```

## Folder layout (this is your repo)
```
vercel.json              routing (/admin → admin.html)
package.json             dependencies (googleapis, pdf-lib)
public/index.html        candidate flow (opens with ?token=…)
public/admin.html        HR console — professional email+password login
public/assets/           logos used by the login screen
api/index.js             the backend (all actions)
api/leegality-webhook.js Leegality signed-doc callback
lib/                     store (Sheets+Drive), pdf, mail, leegality, zoho, config
```

---

## STEP 1 — Google service account (the "robot key")  ~8 min
This is what lets the site read/write your Sheet & Drive. Same on any host.

1. Go to **console.cloud.google.com** → top bar → **New Project** → name "Onboarding" → Create.
2. **Enable APIs** (search each, click Enable): **Google Sheets API**, **Google Drive API**,
   and **Gmail API** (for emails).
3. Left menu → **APIs & Services → Credentials → Create credentials → Service account** →
   name "onboarding-bot" → Create → Done.
4. Click the new service account → **Keys → Add key → Create new key → JSON** → it downloads a
   `.json` file. **Keep it safe.**
5. Open that JSON; copy the `client_email` value (looks like `onboarding-bot@…iam.gserviceaccount.com`).
6. **Share with the robot:**
   - Open your **Google Sheet** → Share → paste that email → **Editor** → Send.
   - Open your **Drive folder** (the one for candidate files) → Share → paste it → **Editor** → Send.

> Email sending: to send from your own address you'll enable "domain-wide delegation" later —
> the portal works without it first (it just logs instead of emailing). We'll add it after go-live.

---

## STEP 2 — Put the code on GitHub  ~3 min (no terminal)
1. **github.com → New repository** → name it `employee-onboarding` → Create.
2. Click **"uploading an existing file."**
3. Drag in **everything from this folder** — `vercel.json`, `package.json`, `README.md`, and the
   folders `public`, `api`, `lib`. (Keep `vercel.json` at the top level, not inside a subfolder.)
4. **Commit changes.**

---

## STEP 3 — Import into Vercel  ~3 min
1. **vercel.com → Add New → Project → Import** your GitHub repo.
2. Framework preset: **Other** (it auto-detects). Leave build settings default. Click **Deploy**.
3. After it deploys, go to **Settings → Environment Variables** and add these:

   | Key | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | paste the **entire** service-account JSON file contents |
   | `SHEET_ID` | `1mvZ-r9DBG9aV7hQcL8kwUlAx93CVnPXu95S3R6YNCfc` |
   | `PARENT_FOLDER_ID` | `1LQujsMUPg0IAdnz5dkVqnMUERSs7e81v` |
   | `ADMIN_EMAIL` | `avik@podhealth.club` |
   | `ADMIN_PASSWORD` | *(a strong password you choose — this is your login)* |
   | `ADMIN_KEY` | `HealthyMind-Avik-2026` *(internal; any long secret)* |
   | `COMPANY` | `Healthy Mind by Avik` |
   | `LINK_TTL_DAYS` | `7` |
   | `PUBLIC_URL` | your Vercel URL, e.g. `https://employee-onboarding.vercel.app` |
   | **Leegality (optional)** | |
   | `LEEGALITY_AUTH_TOKEN` | `LKMGf8MG4PgOMbCcR1Aa7oN0Zj1uHphK` |
   | `LEEGALITY_WEBHOOK_SECRET` | `A1sTAfwmR7gWPTUds83OMasymhW3GvHo` |
   | `LEEGALITY_BASE` | `https://app.leegality.com` |
   | **Zoho (optional)** | |
   | `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` | *(only if mirroring to Zoho)* |

4. **Deployments → ⋯ → Redeploy** so the variables take effect.

---

## STEP 4 — Use it
- **HR login:** `https://your-site.vercel.app/` → professional email + password screen.
  Sign in with `ADMIN_EMAIL` + `ADMIN_PASSWORD`. First load auto-creates the Sheet tabs.
- **Candidates:** created in the console → emailed a link `https://your-site.vercel.app/?token=…`.

### Leegality webhook
In Leegality, set the callback/webhook URL to:
```
https://your-site.vercel.app/api/leegality-webhook?secret=A1sTAfwmR7gWPTUds83OMasymhW3GvHo
```
Then HR console → Settings → Legal eSign → turn on + pick documents.

### Custom domain
Vercel → **Settings → Domains** → add `onboarding.podhealth.club` (or similar) and follow the DNS steps.

---

## Notes
- **Database** = Google Sheets (tabs auto-created: Candidates, Signatures, Logs, Details, Esign,
  Settings). **Storage** = Google Drive (per-candidate folder + `KYC` subfolder). Zoho mirrors if on.
- **Security:** keep `ADMIN_PASSWORD`, `ADMIN_KEY`, and the service-account JSON secret — they live
  only in Vercel env vars, never in the repo. Share the Sheet + Drive folder only with the service
  account and your HR team.
- **Leegality** field names vary by plan — if eSign errors, check `lib/leegality.js` `pick()` paths
  against your API docs.
