/* app.js — UI + logic. No framework, no build step. */
(function () {
  "use strict";

  const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const FREE_DB = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";

  const state = { plan: null, tab: "today", err: null };

  // Live media-animation timers, cleared on every re-render (else they leak).
  let activeTimers = [];
  // Debounced log writes, keyed by record key, flushed before any re-render or on hide.
  const pending = new Map();
  // Guards renderTab against its own async races (stale append after a newer render).
  let renderToken = 0;

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const todayName = () => DAYS[new Date().getDay()];
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

  // ---------- plan loading ----------
  async function loadPlan() {
    const url = localStorage.getItem("planUrl") || "data/workout.yml";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`workout.yml: HTTP ${res.status}`);
    return jsyaml.load(await res.text());
  }

  // ---------- media (exercise animation) ----------
  function resolveFrames(media) {
    if (!media) return null;
    if (Array.isArray(media.frames) && media.frames.length) return media.frames;
    if (media.db) return [FREE_DB + media.db + "/0.jpg", FREE_DB + media.db + "/1.jpg"];
    return null;
  }
  function buildMedia(media, timers = activeTimers) {
    const box = el("div", { className: "media" });
    if (media && media.video) {
      const yt = ytEmbed(media.video);
      box.append(yt
        ? el("iframe", { src: yt, allow: "accelerometer; encrypted-media; gyroscope", loading: "lazy" })
        : el("video", { src: media.video, controls: true, playsInline: true, loop: true, muted: true }));
      return box;
    }
    if (media && media.gif) { box.append(el("img", { src: media.gif, className: "on", loading: "lazy" })); return box; }

    const frames = resolveFrames(media);
    if (!frames) { box.append(el("div", { className: "ph", textContent: "No demo — add media: in YAML" })); return box; }

    // Only the FREE_DB host is known to send CORS headers — request it in CORS mode so
    // sw.js sees real status (won't cache a 404 as a valid opaque image). Custom hosts
    // stay no-cors so they still render; sw.js caches those opaque responses for offline.
    const imgs = frames.map((src, i) => {
      const img = el("img", { src, className: i === 0 ? "on" : "", loading: "lazy" });
      if (src.startsWith(FREE_DB)) img.crossOrigin = "anonymous";
      return img;
    });
    box.append(...imgs);
    let i = 0, playing = true, timer = null;
    const step = () => { imgs[i].classList.remove("on"); i = (i + 1) % imgs.length; imgs[i].classList.add("on"); };
    const start = () => { if (imgs.length > 1) { timer = setInterval(step, media && media.interval || 850); timers.push(timer); } };
    const toggle = el("button", { className: "frame-toggle", textContent: "⏸" });
    toggle.onclick = () => {
      playing = !playing;
      if (playing) { start(); toggle.textContent = "⏸"; } else { clearInterval(timer); toggle.textContent = "▶"; }
    };
    if (imgs.length > 1) box.append(toggle);
    start();
    return box;
  }
  function ytEmbed(u) {
    const m = String(u).match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
  }

  // ---------- exercise card ----------
  function weightText(w) {
    if (!w) return null;
    const unit = w.unit || "kg";
    if (w.per_hand != null) return { k: "Weight", v: `${w.per_hand} ${unit}`, sub: "per hand" };
    if (w.total != null) return { k: "Weight", v: `${w.total} ${unit}`, sub: "total" };
    // bodyweight exercises: no weight stat (the equipment tag already says "bodyweight").
    return null;
  }

  async function exerciseCard(ex, dayName, editable, idx, firstOfName) {
    const card = el("div", { className: "card" });
    card.append(el("div", { className: "ex-head" }, el("h2", { textContent: ex.name })));

    const tags = el("div", { className: "ex-tags" });
    if (ex.equipment) tags.append(el("span", { className: "tag equip", textContent: ex.equipment }));
    if (ex.superset) tags.append(el("span", { className: "tag equip", textContent: "superset ↓" }));
    (ex.muscles || []).forEach((m) => tags.append(el("span", { className: "tag", textContent: m })));
    if (tags.children.length) card.append(tags);

    card.append(buildMedia(ex.media));

    const stats = el("div", { className: "stat-row" });
    const wt = weightText(ex.weight);
    if (wt) stats.append(stat(wt.k, wt.v, wt.sub));
    if (ex.sets != null) stats.append(stat("Sets", ex.sets));
    if (ex.reps != null) stats.append(stat("Reps", ex.reps));
    if (ex.rest != null) stats.append(stat("Rest", ex.rest));
    if (ex.tempo) stats.append(stat("Tempo", ex.tempo));
    if (stats.children.length) card.append(stats);

    if (ex.progression) card.append(el("div", { className: "progression", innerHTML: `<b>Progression:</b> ${escapeHtml(ex.progression)}` }));
    if (ex.notes) card.append(el("div", { className: "notes", innerHTML: `<b>Notes:</b> ${escapeHtml(ex.notes)}` }));

    // Logging only on the Today tab — logging another weekday from Week view would
    // key the record to today's date, colliding with today's own log.
    if (editable) card.append(await logBlock(ex, dayName, idx, firstOfName));
    return card;
  }
  const stat = (k, v, sub) => el("div", { className: "stat" },
    el("div", { className: "k", textContent: k }),
    el("div", { className: "v" }, String(v), sub ? el("small", { textContent: " " + sub }) : null));

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- logging ----------
  async function logBlock(ex, dayName, idx, firstOfName) {
    const date = todayISO();
    // idx disambiguates the same exercise appearing twice in one day's plan.
    const key = `${date}|${idx}|${ex.name}`;
    const nSets = Math.max(1, Math.floor(Number(ex.sets)) || 3);
    let rec = await DB.get("logs", key);
    // Migrate a record written under the pre-idx key format ("date|name") to the FIRST
    // occurrence of that exercise name today (the old format collided duplicates into one).
    if (!rec && firstOfName) {
      const legacy = await DB.get("logs", `${date}|${ex.name}`);
      if (legacy) { rec = Object.assign({}, legacy, { key }); await DB.rekey("logs", `${date}|${ex.name}`, rec); }
    }
    if (!rec) rec = { key, date, day: dayName, exercise: ex.name, sets: [] };
    if (!Array.isArray(rec.sets)) rec.sets = [];               // tolerate malformed/imported records
    while (rec.sets.length < nSets) rec.sets.push({ weight: "", reps: "", done: false });

    const wrap = el("div", { className: "log" });
    const last = await lastSession(ex.name, date);
    wrap.append(el("div", { className: "last", textContent: last ? `Last: ${last}` : "First time logging this." }));
    wrap.append(el("div", { className: "set-head" },
      el("span", { textContent: "#" }), el("span", { textContent: "kg" }), el("span", { textContent: "reps" }), el("span", { textContent: "✓" })));

    // Show exactly nSets rows; extra rows from an earlier, larger plan stay stored but hidden.
    rec.sets.slice(0, nSets).forEach((s, i) => {
      const wIn = el("input", { type: "number", inputMode: "decimal", value: s.weight, placeholder: defWeight(ex) });
      const rIn = el("input", { type: "number", inputMode: "numeric", value: s.reps, placeholder: String(ex.reps ?? "") });
      const chk = el("button", { className: "chk" + (s.done ? " done" : ""), textContent: "✓" });
      wIn.oninput = () => { s.weight = wIn.value; scheduleSave(rec); };
      rIn.oninput = () => { s.reps = rIn.value; scheduleSave(rec); };
      chk.onclick = () => { s.done = !s.done; chk.classList.toggle("done", s.done); scheduleSave(rec); };
      wrap.append(el("div", { className: "set-row" }, el("div", { className: "n", textContent: i + 1 }), wIn, rIn, chk));
    });
    return wrap;
  }
  function defWeight(ex) {
    const w = ex.weight; if (!w) return "";
    return String(w.per_hand ?? w.total ?? "");
  }
  async function lastSession(exName, beforeDate) {
    const all = await DB.getAll("logs");
    const prev = all.filter((r) => r.exercise === exName && r.date < beforeDate).sort((a, b) => a.date.localeCompare(b.date)).pop();
    if (!prev) return null;
    const done = (prev.sets || []).filter((s) => s.weight || s.reps).map((s) => `${s.weight || "?"}×${s.reps || "?"}`).join(", ");
    return `${prev.date} — ${done || "logged"}`;
  }

  // Debounced persistence, keyed by record so re-renders can flush before reloading.
  function scheduleSave(rec) {
    const prev = pending.get(rec.key);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => { pending.delete(rec.key); DB.put("logs", rec); }, 400);
    pending.set(rec.key, { rec, timer });
  }
  async function flushSaves() {
    const items = [...pending.values()];
    pending.clear();
    for (const p of items) { clearTimeout(p.timer); await DB.put("logs", p.rec); }
  }
  window.addEventListener("pagehide", flushSaves);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSaves(); });

  // ---------- day rendering ----------
  async function renderDay(dayName, view, editable = false) {
    const day = state.plan.week && state.plan.week[dayName];
    if (!day || day.rest) {
      view.append(el("div", { className: "card rest-card" }, el("div", { className: "big", textContent: "😴" }),
        el("div", { textContent: (day && day.name) || "Rest day" }), day && day.notes ? el("div", { className: "hint", textContent: day.notes }) : null));
      return;
    }
    view.append(el("h2", { className: "section-title", textContent: day.name || cap(dayName) }));
    if (day.focus) view.append(el("div", { className: "hint", style: "margin:-4px 4px 10px", textContent: day.focus }));
    const exercises = day.exercises || [];
    if (editable && exercises.length) {
      const start = el("button", { className: "btn start-session", textContent: "▶ Start guided workout" });
      start.onclick = () => window.Session.start(dayName, exercises);
      view.append(start);
    }
    const seenNames = new Set();
    for (let i = 0; i < exercises.length; i++) {
      const firstOfName = !seenNames.has(exercises[i].name);
      seenNames.add(exercises[i].name);
      view.append(await exerciseCard(exercises[i], dayName, editable, i, firstOfName));
    }
  }

  // ---------- tabs ----------
  async function renderTab() {
    const token = ++renderToken;
    await flushSaves();                                 // persist pending edits before reloading records
    activeTimers.forEach(clearInterval); activeTimers = []; // stop old animation timers
    const frag = document.createDocumentFragment();
    try {
      if (state.tab === "today") await renderDay(todayName(), frag, true);
      else if (state.tab === "week") await renderWeek(frag);
      else if (state.tab === "body") await renderBody(frag);
      else if (state.tab === "settings") await renderSettings(frag);
    } catch (e) {
      frag.append(el("div", { className: "card", textContent: "Error: " + e.message }));
    }
    if (token !== renderToken) return;                  // a newer render started; discard this one
    const view = $("#view");
    view.innerHTML = "";
    view.append(frag);
  }

  async function renderWeek(view) {
    for (const d of DAYS) {
      const day = state.plan.week && state.plan.week[d];
      const label = day ? (day.rest ? "Rest" : (day.name || "Workout")) : "—";
      const det = el("details", { className: "card" });
      det.style.padding = "0";
      const sum = el("summary");
      sum.style.cssText = "padding:16px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;";
      sum.append(el("b", { textContent: cap(d) }), el("span", { className: "muted", textContent: label }));
      det.append(sum);
      if (d === todayName()) det.open = true;
      const body = el("div"); body.style.padding = "0 16px 8px";
      await renderDay(d, body);
      det.append(body);
      view.append(det);
    }
  }

  // ---------- body / weight ----------
  async function renderBody(view) {
    const p = (await DB.get("profile", "me")) || { id: "me", sex: "male" };
    const weights = (await DB.getAll("bodyweight")).sort((a, b) => a.date.localeCompare(b.date));
    const latest = weights[weights.length - 1];

    // profile
    const prof = el("div", { className: "card" });
    prof.append(el("h3", { textContent: "Profile" }));
    const name = field("Name", "text", p.name || "");
    const grid = el("div", { className: "row2" });
    const height = field("Height (cm)", "number", p.height_cm || "");
    const age = field("Age", "number", p.age || "");
    grid.append(height.wrap, age.wrap);
    const sex = el("select");
    ["male", "female"].forEach((s) => sex.append(el("option", { value: s, textContent: cap(s), selected: p.sex === s })));
    const sexF = el("div", { className: "field" }, el("label", { textContent: "Sex" }), sex);
    const savep = el("button", { className: "btn", textContent: "Save profile" });
    savep.onclick = async () => {
      await DB.put("profile", { id: "me", name: name.input.value, height_cm: +height.input.value || null, age: +age.input.value || null, sex: sex.value });
      toast("Profile saved"); renderTab();
    };
    prof.append(name.wrap, grid, sexF, savep);
    view.append(prof);

    // current weight + log
    const wcard = el("div", { className: "card" });
    wcard.append(el("h3", { textContent: "Body weight" }));
    if (latest) wcard.append(el("div", { className: "weight-now" }, el("span", { className: "big", textContent: latest.kg }), el("span", { className: "u", textContent: "kg" }), el("span", { className: "u", style: "margin-left:auto", textContent: latest.date })));
    wcard.append(sparkline(weights));
    const wIn = field("Log today's weight (kg)", "number", latest && latest.date === todayISO() ? latest.kg : "");
    const logw = el("button", { className: "btn", textContent: "Log weight" });
    logw.onclick = async () => {
      const kg = +wIn.input.value; if (!kg) return;
      await DB.put("bodyweight", { date: todayISO(), kg }); toast("Weight logged"); renderTab();
    };
    wcard.append(wIn.wrap, logw);

    // BMI
    if (p.height_cm && latest) {
      const bmi = latest.kg / ((p.height_cm / 100) ** 2);
      wcard.append(el("div", { className: "kpi-row" },
        kpi("BMI", bmi.toFixed(1)), kpi("Category", bmiCat(bmi)), kpi("Entries", String(weights.length))));
    }
    view.append(wcard);

    // history
    if (weights.length) {
      const hist = el("div", { className: "card" });
      hist.append(el("h3", { textContent: "History" }));
      const ul = el("ul", { className: "wlist" });
      weights.slice().reverse().forEach((w) => {
        const del = el("button", { textContent: "delete" });
        del.onclick = async () => { await DB.del("bodyweight", w.date); renderTab(); };
        ul.append(el("li", {}, el("span", { className: "d", textContent: w.date }), el("span", {}, `${w.kg} kg`), del));
      });
      hist.append(ul);
      view.append(hist);
    }
  }
  const kpi = (k, v) => el("div", { className: "kpi" }, el("div", { className: "k", textContent: k }), el("div", { className: "v", textContent: v }));
  function bmiCat(b) { return b < 18.5 ? "Under" : b < 25 ? "Normal" : b < 30 ? "Over" : "Obese"; }
  function field(label, type, value) {
    const input = el("input", { type, value });
    if (type === "number") input.inputMode = "decimal";
    const wrap = el("div", { className: "field" }, el("label", { textContent: label }), input);
    return { wrap, input };
  }

  function sparkline(weights) {
    const c = el("canvas", { className: "spark" });
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr;
      const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
      if (weights.length < 2) { ctx.fillStyle = "#93a1b0"; ctx.font = "13px -apple-system"; ctx.fillText("Log 2+ entries to see trend", 8, h / 2); return; }
      const xs = weights.map((_, i) => i), ys = weights.map((p) => p.kg);
      const min = Math.min(...ys), max = Math.max(...ys), pad = 14;
      const X = (i) => pad + (i / (xs.length - 1)) * (w - 2 * pad);
      const Y = (v) => max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
      ctx.strokeStyle = "#4cc2ff"; ctx.lineWidth = 2; ctx.beginPath();
      ys.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.fillStyle = "#4cc2ff"; ys.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.5, 0, 7); ctx.fill(); });
    });
    return c;
  }

  // ---------- settings ----------
  async function renderSettings(view) {
    const c = el("div", { className: "card" });
    c.append(el("h3", { textContent: "Workout plan" }));
    const url = field("Plan YAML URL", "text", localStorage.getItem("planUrl") || "data/workout.yml");
    const saveUrl = el("button", { className: "btn ghost", textContent: "Save URL & reload plan" });
    saveUrl.onclick = async () => { localStorage.setItem("planUrl", url.input.value.trim()); await reloadPlan(); toast("Plan reloaded"); };
    const reload = el("button", { className: "btn", textContent: "Reload plan" });
    reload.onclick = async () => { await reloadPlan(); toast("Plan reloaded"); };
    c.append(url.wrap, reload, saveUrl, el("div", { className: "hint", textContent: "Edit data/workout.yml in the repo, push, then Reload." }));
    view.append(c);

    const b = el("div", { className: "card" });
    b.append(el("h3", { textContent: "Backup (your data stays on this phone)" }));
    const exp = el("button", { className: "btn ghost", textContent: "Export data (JSON)" });
    exp.onclick = async () => {
      const data = await DB.exportAll();
      const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: `workout-backup-${todayISO()}.json` });
      a.click();
    };
    const impInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
    impInput.onchange = async () => {
      const f = impInput.files[0]; if (!f) return;
      try { const r = await DB.importAll(JSON.parse(await f.text())); toast(`Imported ${r.imported}${r.skipped ? ", skipped " + r.skipped : ""}`); renderTab(); }
      catch (e) { toast("Import failed: " + e.message); }
    };
    const imp = el("button", { className: "btn ghost", textContent: "Import data (JSON)" });
    imp.onclick = () => impInput.click();
    const wipe = el("button", { className: "btn danger", textContent: "Erase all my data" });
    wipe.onclick = async () => { if (confirm("Erase profile, weights and logs on this device?")) { await DB.clearAll(); toast("Erased"); renderTab(); } };
    b.append(exp, imp, impInput, wipe);
    view.append(b);

    const a = el("div", { className: "card hint" });
    a.append("Data is stored only in this browser (IndexedDB). Export regularly — iOS may clear site data under storage pressure.");
    view.append(a);
  }

  async function reloadPlan() { state.plan = await loadPlan(); renderTab(); }

  // ---------- toast ----------
  let toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = el("div"); toastEl.style.cssText = "position:fixed;left:50%;bottom:calc(var(--tabbar-h) + 20px);transform:translateX(-50%);background:#1b242e;border:1px solid #26313d;color:#e8eef5;padding:10px 16px;border-radius:999px;z-index:20;font-size:14px;transition:opacity .2s"; document.body.append(toastEl); }
    toastEl.textContent = msg; toastEl.style.opacity = "1";
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => (toastEl.style.opacity = "0"), 1600);
  }

  // ---------- boot ----------
  function initTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.onclick = () => {
        state.tab = btn.dataset.tab;
        document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
        window.scrollTo(0, 0);
        renderTab();
      };
    });
    document.querySelector('.tab[data-tab="today"]').classList.add("active");
  }

  async function boot() {
    initTabs();
    $("#dayBadge").textContent = cap(todayName());
    try {
      state.plan = await loadPlan();
      if (state.plan && state.plan.title) { $("#title").textContent = state.plan.title; document.title = state.plan.title; }
    } catch (e) {
      $("#view").innerHTML = "";
      $("#view").append(el("div", { className: "card", textContent: "Could not load workout.yml — " + e.message }));
      return;
    }
    renderTab();
    if ("serviceWorker" in navigator) {
      // When an updated sw.js activates (skipWaiting + claim), reload once so the
      // new shell shows this launch — iOS otherwise needs a full close + reopen.
      const hadSW = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadSW && !window._swReloaded) { window._swReloaded = true; location.reload(); }
      });
      navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
    }
  }

  // Shared with session.js (guided workout player).
  window.AppBridge = { buildMedia, renderTab };

  boot();
})();
