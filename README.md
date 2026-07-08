# Workout

A tiny, offline-first **workout tracker PWA**. No accounts, no server, no tracking.
It shows your weekly plan with an **animated demo** for each exercise, dumbbell
weight (per hand or total), reps, and progression goals — and tracks your body
weight, height, age and BMI. All personal data stays **on your device**.

> ⚠️ The plan shipped in `data/workout.yml` is a **sample for demonstration only** —
> not coaching or medical advice. Replace it with your own and consult a
> professional before starting any program.

## Use it on your phone (iPhone/Android)

1. Open the site URL in your browser.
2. **iPhone:** Share → **Add to Home Screen**. **Android:** menu → **Install app**.
3. Launch from the home-screen icon — it runs full-screen and works offline.

Your profile, weight log and workout logs live only in that browser
(IndexedDB). Use **Settings → Export data** to back them up; **Import** to restore
or move to a new phone.

## Make it your own plan

1. **Fork** this repo.
2. Edit **`data/workout.yml`** — the whole plan is one readable file. The schema
   and every field are documented in comments at the top of that file.
3. Commit & push. In the app: **Settings → Reload plan**.

### Exercise animations
Each exercise takes an optional `media:` block:

```yaml
media: { db: Dumbbell_Bench_Press }        # 2-frame loop from free-exercise-db
# media: { frames: [url0, url1], interval: 850 }   # your own images
# media: { gif: https://.../move.gif }
# media: { video: https://youtu.be/XXXXXXXXXXX }
```

`db:` is a folder id from the public-domain
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (browse
`exercises/` for names like `Goblet_Squat`, `One-Arm_Dumbbell_Row`).

## Deploy your own (free, GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Build from branch → `main` / root.**
3. Open the published URL, then Add to Home Screen.

> Note: GitHub Pages URLs are **public** — anyone with the link can view the app
> and your `workout.yml`. Your logged data still stays private on your device.
> Want the app itself private? Host the same files on Cloudflare Pages behind
> Cloudflare Access instead.

## Tech
Plain HTML/CSS/JS, [js-yaml](https://github.com/nodeca/js-yaml) for the plan,
IndexedDB for storage, a service worker for offline. No build step, no
dependencies to install.
