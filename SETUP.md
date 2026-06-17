# Flower Tracker — Setup Instructions

## What you need before starting
- Your VaporTrails Supabase project (already exists)
- A GitHub account
- A Gmail address for alerts (or any SMTP provider)

---

## Step 1 — Set up the database

1. Go to your VaporTrails Supabase project
2. Click **SQL Editor** in the left sidebar
3. Clear anything in the editor, paste the entire contents of **`supabase/schema.sql`**, and click **Run**
4. You should see a success message. The tracker now has its own `flower` schema with 3 tables: `products`, `availability_log`, and `favorites` — completely separate from your VaporTrails data.

---

## Step 2 — Create a GitHub repo

1. Go to github.com → **New repository**
2. Name it something like `flower-tracker`
3. Set it to **Public** (required for free GitHub Pages)
4. Don't initialize with any files — leave it empty

Then push this project folder to it:
```
cd dispensary-tracker-v4
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/flower-tracker.git
git push -u origin main
```

---

## Step 3 — Enable GitHub Pages

1. In your GitHub repo, go to **Settings → Pages**
2. Under "Source", select **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Click Save
5. After a minute, your dashboard will be live at `https://YOUR_USERNAME.github.io/flower-tracker/`

---

## Step 4 — Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets one at a time:

| Secret name | Where to find it |
|---|---|
| `SUPABASE_URL` | `https://oapjuqurbfimxopjpqgj.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API Keys → **Secret key** (reveal and copy) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | Your Gmail **App Password** (see note below) |
| `ALERT_TO` | the email address to send alerts to |

**Gmail App Password:** You need an App Password, not your regular Gmail password.
Go to myaccount.google.com → Security → 2-Step Verification → App passwords → create one named "Flower Tracker". Use the 16-character code it gives you as `SMTP_PASS`.

---

## Step 5 — Run the first scrape

1. In your GitHub repo, click the **Actions** tab
2. Click **Flower Scraper** in the left list
3. Click **Run workflow → Run workflow**
4. Watch the log — it should scrape both stores and populate your database

After it finishes, open your GitHub Pages URL and you should see all the flower products.

---

## Step 6 — Set up favorites and alerts in the dashboard

1. Open your dashboard
2. Browse products — click **☆** on any product card to favorite it (turns ⭐)
   - Favorited products get a gold border and sort to the top by default
   - Alerts are automatically **on** for favorited products (shown as 🔔 Alert on)
   - Click "🔔 Alert on" to toggle alerts off for a specific product
3. To favorite an entire **brand** (highlights all their products), click the brand dropdown → click the **★** next to the brand name
4. Use **⭐ Favorites only** to filter down to just your favorited brands and products

**Alerts fire when:** a product you've favorited (with alert on) comes back in stock after being unavailable. You'll get one email listing all such products.

---

## Schedule

The scraper runs automatically at **9:00 PM Pacific** every day via GitHub Actions.
No action needed — it just runs.

To change the time, edit `.github/workflows/scrape.yml` and update the cron value.
Current value `0 4 * * *` = 04:00 UTC = 9:00 PM PDT.
