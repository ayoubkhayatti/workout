/* session.js — guided workout player. Prop the phone up and follow:
   tap DONE after a set → rest countdown with beeps → auto-advance.
   Speech announces exercise changes; wake lock keeps the screen on. */
(function () {
  "use strict";

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const fmtT = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

  let S = null;        // active session state
  let wakeLock = null;
  let audio = null;

  // ---------- sound ----------
  const soundOn = () => localStorage.getItem("sessionSound") !== "off";
  function ensureAudio() {
    if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); }
    if (audio && audio.state === "suspended") audio.resume();
  }
  function beep(freq, ms, delay = 0) {
    if (!soundOn() || !audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.05);
  }
  function say(text) {
    if (!soundOn() || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  // ---------- wake lock ----------
  async function lockScreen() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }
  document.addEventListener("visibilitychange", () => {
    if (S && document.visibilityState === "visible") lockScreen();
  });

  // ---------- plan/log plumbing ----------
  const restSecs = (ex) => { const n = parseInt(ex.rest, 10); return Number.isFinite(n) && n > 0 ? n : 60; };
  const firstNum = (v) => { const m = String(v ?? "").match(/\d+(\.\d+)?/); return m ? m[0] : ""; };
  const defWeight = (ex) => { const w = ex.weight; return w ? String(w.per_hand ?? w.total ?? "") : ""; };
  function weightSpeech(ex) {
    const w = ex.weight; if (!w) return "";
    if (w.per_hand != null) return `${w.per_hand} kilos per hand`;
    if (w.total != null) return `${w.total} kilos`;
    return "";
  }

  async function loadEntries(dayName, exercises) {
    const date = todayISO();
    const all = await DB.getAll("logs");
    return exercises.map((ex, idx) => {
      const key = `${date}|${idx}|${ex.name}`;
      let rec = all.find((r) => r.key === key) || { key, date, day: dayName, exercise: ex.name, sets: [] };
      if (!Array.isArray(rec.sets)) rec.sets = [];
      const nSets = Math.max(1, Math.floor(Number(ex.sets)) || 3);
      while (rec.sets.length < nSets) rec.sets.push({ weight: "", reps: "", done: false });
      const prev = all.filter((r) => r.exercise === ex.name && r.date < date)
        .sort((a, b) => a.date.localeCompare(b.date)).pop() || null;
      return { ex, idx, nSets, rec, prev };
    });
  }

  // Play order: sequential sets, except `superset: true` interleaves an exercise's
  // sets with the NEXT exercise's (A1 B1 A2 B2 …).
  function buildOrder(entries) {
    const order = [];
    for (let e = 0; e < entries.length; e++) {
      const a = entries[e], b = a.ex.superset ? entries[e + 1] : null;
      if (b) {
        for (let s = 0; s < Math.max(a.nSets, b.nSets); s++) {
          if (s < a.nSets) order.push({ e, s });
          if (s < b.nSets) order.push({ e: e + 1, s });
        }
        e++;
      } else {
        for (let s = 0; s < a.nSets; s++) order.push({ e, s });
      }
    }
    return order;
  }

  // ---------- session lifecycle ----------
  async function start(dayName, exercises) {
    if (S) return;
    ensureAudio();
    const entries = await loadEntries(dayName, exercises);
    const order = buildOrder(entries);
    // resume where you left off: first set not yet marked done
    let i = order.findIndex((p) => !entries[p.e].rec.sets[p.s].done);
    S = {
      entries, order, i, phase: i >= 0 ? "work" : "done", nextI: null,
      endAt: 0, remaining: 0, paused: false, lastSec: null,
      tick: null, timers: [], startedAt: Date.now(), doneCount: 0,
      root: el("div", { className: "session" }),
    };
    document.body.append(S.root);
    lockScreen();
    render();
  }

  function cleanup() {
    clearInterval(S.tick);
    S.timers.forEach(clearInterval);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    S.root.remove();
    S = null;
    window.AppBridge.renderTab();
  }

  function saveSet(entry, s, weight, reps) {
    entry.rec.sets[s] = { weight, reps, done: true };
    S.doneCount++;
    return DB.put("logs", entry.rec);
  }

  // ---------- phases ----------
  function startRest(nextI) {
    const cur = S.entries[S.order[S.i].e];
    const sec = restSecs(cur.ex);
    S.phase = "rest"; S.nextI = nextI; S.paused = false;
    S.endAt = Date.now() + sec * 1000; S.lastSec = null;
    if (S.order[nextI].e !== S.order[S.i].e) {
      const nx = S.entries[S.order[nextI].e];
      const w = weightSpeech(nx.ex);
      say(`Next: ${nx.ex.name}${w ? ", " + w : ""}.`);
    }
    render();
    S.tick = setInterval(onTick, 200);
    S.timers.push(S.tick);
  }

  function onTick() {
    if (S.paused) return;
    const sec = Math.max(0, Math.ceil((S.endAt - Date.now()) / 1000));
    if (sec === S.lastSec) return;
    S.lastSec = sec;
    const cd = S.root.querySelector(".cd");
    if (cd) cd.textContent = `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
    if (sec <= 3 && sec >= 1) beep(660, 100);
    if (sec === 0) goWork();
  }

  function goWork() {
    clearInterval(S.tick);
    beep(990, 150); beep(990, 150, 0.2);
    S.i = S.nextI; S.nextI = null; S.phase = "work";
    render();
  }

  // ---------- render ----------
  function render() {
    S.timers.forEach(clearInterval); S.timers = [];
    S.root.innerHTML = "";
    if (S.phase === "work") renderWork();
    else if (S.phase === "rest") renderRest();
    else renderFinish();
  }

  function header(sub, showClock = true) {
    const exit = el("button", { className: "s-icon", textContent: "✕" });
    exit.onclick = () => { if (confirm("End workout?")) cleanup(); };
    const snd = el("button", { className: "s-icon", textContent: soundOn() ? "🔊" : "🔇" });
    snd.onclick = () => {
      localStorage.setItem("sessionSound", soundOn() ? "off" : "on");
      snd.textContent = soundOn() ? "🔊" : "🔇";
      if (soundOn()) ensureAudio();
    };
    const kids = [exit, el("span", { className: "s-sub", textContent: sub })];
    if (showClock) {
      const clk = el("span", { className: "s-clock", textContent: fmtT(Date.now() - S.startedAt) });
      const t = setInterval(() => { clk.textContent = fmtT(Date.now() - S.startedAt); }, 1000);
      S.timers.push(t);
      kids.push(clk);
    }
    kids.push(snd);
    return el("div", { className: "s-head" }, ...kids);
  }

  function stepper(label, input, step) {
    // touchend + preventDefault: fire the step ourselves and stop iOS from ever
    // seeing rapid taps as a double-tap zoom gesture (touch-action wasn't enough).
    const tapBtn = (text, fn) => {
      const b = el("button", { className: "s-step", textContent: text });
      b.onclick = fn;
      b.addEventListener("touchend", (e) => { e.preventDefault(); fn(); }, { passive: false });
      return b;
    };
    const dec = tapBtn("−", () => { input.value = Math.max(0, (+input.value || 0) - step); });
    const inc = tapBtn("+", () => { input.value = (+input.value || 0) + step; });
    return el("div", { className: "s-field" },
      el("label", { textContent: label }),
      el("div", { className: "s-stepper" }, dec, input, inc));
  }

  function renderWork() {
    const { e, s } = S.order[S.i];
    const entry = S.entries[e];
    const ex = entry.ex;
    const set = entry.rec.sets[s];
    const prevSet = entry.prev && entry.prev.sets && entry.prev.sets[s];

    S.root.append(header(`Exercise ${e + 1}/${S.entries.length} · Set ${s + 1}/${entry.nSets}`, false));
    S.root.append(el("h2", { className: "s-name", textContent: ex.name }));
    const target = [ex.reps != null ? `${ex.reps} reps` : null, ex.tempo ? `tempo ${ex.tempo}` : null]
      .filter(Boolean).join(" · ");
    if (target) S.root.append(el("div", { className: "s-target", textContent: target }));

    // today's sets so far: done → logged values, current → "now", pending → dash
    const chips = el("div", { className: "s-sets" });
    entry.rec.sets.slice(0, entry.nSets).forEach((st, k) => {
      chips.append(el("span", {
        className: "s-setchip" + (st.done ? " done" : "") + (k === s ? " cur" : ""),
        textContent: st.done ? `${st.weight || "?"}×${st.reps || "?"}` : k === s ? "now" : "–",
      }));
    });
    S.root.append(chips);
    S.root.append(window.AppBridge.buildMedia(ex.media, S.timers));

    const wIn = el("input", { type: "number", inputMode: "decimal",
      value: set.weight || (prevSet && prevSet.weight) || defWeight(ex) });
    const rIn = el("input", { type: "number", inputMode: "numeric",
      value: set.reps || (prevSet && prevSet.reps) || firstNum(ex.reps) });
    S.root.append(el("div", { className: "s-inputs" }, stepper("kg", wIn, 1), stepper("reps", rIn, 1)));

    // count-up since this set's screen appeared — pacing for timed holds (plank etc.)
    const setV = el("div", { className: "v", textContent: "0:00" });
    const totV = el("div", { className: "v", textContent: fmtT(Date.now() - S.startedAt) });
    const setStart = Date.now();
    const st = setInterval(() => {
      setV.textContent = fmtT(Date.now() - setStart);
      totV.textContent = fmtT(Date.now() - S.startedAt);
    }, 1000);
    S.timers.push(st);
    S.root.append(el("div", { className: "s-timers" },
      el("div", { className: "s-timer main" }, el("div", { className: "k", textContent: "Set" }), setV),
      el("div", { className: "s-timer" }, el("div", { className: "k", textContent: "Workout" }), totV)));

    const done = el("button", { className: "s-done", textContent: "DONE ✓" });
    done.onclick = async () => {
      done.disabled = true;
      await saveSet(entry, s, wIn.value, rIn.value);
      if (S.i + 1 >= S.order.length) { S.phase = "done"; say("Workout complete."); render(); }
      else startRest(S.i + 1);
    };
    S.root.append(done);

    const skip = el("button", { className: "s-skip", textContent: "Skip set" });
    skip.onclick = () => {
      if (S.i + 1 >= S.order.length) { S.phase = "done"; render(); } else { S.i++; render(); }
    };
    const nextEx = el("button", { className: "s-skip", textContent: "Next exercise →" });
    nextEx.onclick = () => {
      const cur = S.order[S.i].e;
      let j = S.i + 1;
      while (j < S.order.length && S.order[j].e === cur) j++;
      if (j >= S.order.length) { S.phase = "done"; render(); } else { S.i = j; render(); }
    };
    S.root.append(el("div", { className: "s-skiprow" }, skip, nextEx));
  }

  function renderRest() {
    const np = S.order[S.nextI];
    const nx = S.entries[np.e];
    S.root.append(header("Rest"));
    S.root.append(el("div", { className: "cd", textContent: "" }));

    const w = defWeight(nx.ex);
    S.root.append(el("div", { className: "s-nextup" },
      el("div", { className: "k", textContent: "Next up" }),
      el("div", { className: "v", textContent: `${nx.ex.name} — set ${np.s + 1}/${nx.nSets}${w ? ` · ${w} kg` : ""}` })));
    S.root.append(window.AppBridge.buildMedia(nx.ex.media, S.timers));

    const pause = el("button", { className: "btn ghost", textContent: S.paused ? "Resume" : "Pause" });
    pause.onclick = () => {
      if (S.paused) { S.endAt = Date.now() + S.remaining; S.paused = false; pause.textContent = "Pause"; }
      else { S.remaining = Math.max(0, S.endAt - Date.now()); S.paused = true; pause.textContent = "Resume"; }
      S.root.querySelector(".cd").classList.toggle("paused", S.paused);
    };
    const plus = el("button", { className: "btn ghost", textContent: "+30s" });
    plus.onclick = () => { if (S.paused) S.remaining += 30000; else { S.endAt += 30000; S.lastSec = null; } };
    const skip = el("button", { className: "btn", textContent: "Skip rest" });
    skip.onclick = goWork;
    S.root.append(el("div", { className: "s-restbtns" }, pause, plus, skip));

    S.lastSec = null; onTick(); // paint the countdown immediately
  }

  function renderFinish() {
    const mins = Math.round((Date.now() - S.startedAt) / 60000);
    S.root.append(header("Done"));
    S.root.append(el("div", { className: "s-finish" },
      el("div", { className: "big", textContent: "💪" }),
      el("h2", { textContent: "Workout complete" }),
      el("div", { className: "muted", textContent: `${S.doneCount} sets logged · ${mins} min` })));
    const close = el("button", { className: "s-done", textContent: "Finish" });
    close.onclick = cleanup;
    S.root.append(close);
  }

  window.Session = { start };
})();
