# Workout

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A tiny, offline-first **workout tracker PWA**. No accounts, no server, no tracking.
It shows your weekly plan with an **animated demo** for each exercise, the
weight (per hand or total), reps, and progression goals — and tracks your body
weight, height, age and BMI. All personal data stays **on your device**.

Ships with two plans — a home/dumbbell one and a commercial-gym one. Tap the
title in the header to switch; your logs are one continuous history either way.

> ⚠️ The plans shipped in `data/` are **samples for demonstration only** — not
> coaching or medical advice. Replace them with your own and consult a
> professional before starting any program.

## Use it on your phone (iPhone/Android)

1. Open the site URL in your browser.
2. **iPhone:** Share → **Add to Home Screen**. **Android:** menu → **Install app**.
3. Launch from the home-screen icon — it runs full-screen and works offline.

Your profile, weight log and workout logs live only in that browser
(IndexedDB). Use **Settings → Export data** to back them up; **Import** to restore
or move to a new phone.

## Offline

Everything works with no connection: the app itself, every plan listed in
`data/plans.json`, the exercise demos, the guided session and all logging.

On the first launch the app quietly downloads every exercise image of every
plan (a few MB, once) so a demo is there before you ever scroll to it. Later
launches fetch nothing — **Settings → Offline** shows how many are saved and
re-downloads any that are missing. Images survive app updates, and Data Saver
turns the automatic download off (the button still works).

The one thing that needs a connection is an exercise using `media: { video: … }`
— video is streamed, not cached. Use `db:`, `frames:` or `gif:` for anything you
want available offline.

## Make it your own plan

1. **Fork** this repo.
2. Edit **`data/workout.yml`** (or `data/gym.yml`) — a whole plan is one readable
   file. The schema and every field are documented in comments at the top.
3. Commit & push. In the app: **Settings → Reload plan**.

### Adding another plan

Static hosting can't list a directory, so `data/plans.json` is the index the
picker reads. Drop a new `.yml` in `data/` and add a line to it:

```json
[
  { "file": "workout.yml", "name": "Home · dumbbells" },
  { "file": "gym.yml",     "name": "Gym · machines" },
  { "file": "travel.yml",  "name": "Hotel · bodyweight" }
]
```

`name` is what the header picker shows. Logs are keyed by date + exercise name,
never by plan, so switching plans never splits or hides your history — and the
same exercise in two plans shares one "Last:" line.

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

## License
Released under the [MIT License](LICENSE) — free to use, modify, and distribute;
provided as-is, no warranty. © 2026 Ayoub Khayati.

### Third-party
- [js-yaml](https://github.com/nodeca/js-yaml) — MIT (bundled in `vendor/`).
- Exercise demo images from [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
  — public domain (The Unlicense); loaded at runtime, not redistributed here.

Not medical or coaching advice. Train at your own risk.
