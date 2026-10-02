const $ = (id) => document.getElementById(id);

let devices = [];
let config = {};
let volInfo = { A: { id: null, muted: false }, B: { id: null, muted: false } };
let mixIds = { game: null, voice: null };
let lastTelemTs = 0;
let activePreset = 1;
let manualUpd = "";

function ready(cb) {
  if (window.pywebview && window.pywebview.api) cb();
  else window.addEventListener("pywebviewready", cb);
}
async function call(name, ...args) { return await window.pywebview.api[name](...args); }

function flash(el, text, cls) {
  el.textContent = text;
  el.className = "hint " + (cls || "");
  clearTimeout(el._t);
  if (cls) el._t = setTimeout(() => { el.textContent = ""; el.className = "hint"; }, 3500);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  document.querySelectorAll("#themeRow .theme-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.themePick === name));
}

function setPauseUi(paused) {
  $("btnPause").classList.toggle("paused", !!paused);
  $("autoLabel").textContent = paused ? "AUTO SWITCH OFF" : "AUTO SWITCH ON";
}

async function loadConfig() {
  config = await call("get_config");
  applyTheme(config.theme || "astro");
  $("setInterval").value = config.interval;
  $("setDebounce").value = config.debounce;
  $("chkNotify").checked = !!config.notifications;
  $("chkAutostart").checked = !!config.autostart;
  setPauseUi(config.paused);
}

async function loadDevices() {
  devices = (await call("list_devices")) || [];
  const opts = devices
    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}${d.is_default ? "   [default]" : ""}</option>`)
    .join("");
  $("dockedSel").innerHTML = opts;
  $("undockedSel").innerHTML = opts;

  const norm = (s) => String(s || "").toLowerCase().replace(/\b\d+\s*-\s*/g, "").trim();
  const heal = async (key, sel) => {
    const wantId = config[key + "_id"];
    if (wantId && devices.some((d) => d.id === wantId)) { sel.value = wantId; return; }
    const want = norm(config[key + "_name"]);
    let hit = (want && devices.find((d) => norm(d.name) === want)) || null;
    if (!hit) {
      const hint = key === "undocked" ? ["a50", "game"] : ["realtek"];
      hit = devices.find((d) => hint.every((h) => d.name.toLowerCase().includes(h))) || null;
    }
    if (hit) {
      sel.value = hit.id;
      const patch = {};
      patch[key + "_id"] = hit.id;
      patch[key + "_name"] = hit.name;
      config = await call("update_config", patch);
    }
  };
  await heal("docked", $("dockedSel"));
  await heal("undocked", $("undockedSel"));

  mixIds.game = null;
  mixIds.voice = null;
  for (const d of devices) {
    const n = d.name.toLowerCase();
    if (n.includes("a50") && n.includes("game") && !mixIds.game) mixIds.game = d.id;
    if (n.includes("a50") && n.includes("voice") && !mixIds.voice) mixIds.voice = d.id;
  }
}

function deviceName(id) {
  const d = devices.find((x) => x.id === id);
  return d ? d.name : id || "--";
}

/* ---------- EQ curve ---------- */
function smoothPath(pts) {
  let d = `M0 ${pts[0][1]} L${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L400 ${last[1]}`;
}
function drawEq() {
  const g = [0, 1, 2, 3, 4].map((i) => +$("eq" + i).value);
  const line = smoothPath(g.map((v, i) => [40 + i * 80, 80 - v * 10]));
  $("eqLine").setAttribute("d", line);
  $("eqFill").setAttribute("d", line + " L400 80 L0 80 Z");
  g.forEach((v, i) => { $("eqv" + i).textContent = (v > 0 ? "+" : "") + v; });
}

/* ---------- telemetry ---------- */
function applyTelemetry(t) {
  if (!t || t.ts === lastTelemTs) return;
  lastTelemTs = t.ts;

  const off = !t.available;
  const setHint = (el, msg) => {
    if (off) { if (el.textContent !== msg) el.textContent = msg; }
    else if (el.textContent === msg) el.textContent = "";
  };
  setHint($("eqMsg"), "headset unavailable (dock or power on)");
  setHint($("micMsg"), "headset unavailable (dock or power on)");
  if (off) return;

  if (typeof t.sidetone === "number") {
    $("sidetoneVal").textContent = t.sidetone + "%";
    const el = $("sidetoneSlider");
    if (document.activeElement !== el) el.value = t.sidetone;
  }
  if (typeof t.mic === "number") {
    $("micVal").textContent = t.mic + "%";
    const el = $("micSlider");
    if (document.activeElement !== el) el.value = t.mic;
  }
  if (Array.isArray(t.eq_names)) {
    document.querySelectorAll("#presetRow .preset").forEach((b) => {
      const i = +b.dataset.preset;
      if (t.eq_names[i - 1]) b.textContent = t.eq_names[i - 1].toUpperCase();
    });
  }
  if (typeof t.eq_preset === "number") {
    activePreset = t.eq_preset;
    document.querySelectorAll("#presetRow .preset").forEach((b) =>
      b.classList.toggle("active", +b.dataset.preset === activePreset));
  }
  if (Array.isArray(t.eq_gains)) {
    for (let i = 0; i < 5; i++) {
      const el = $("eq" + i);
      if (document.activeElement !== el) el.value = t.eq_gains[i];
    }
    drawEq();
  }
  if (typeof t.noise_gate === "number") {
    document.querySelectorAll("#gateRow .preset").forEach((b) =>
      b.classList.toggle("active", +b.dataset.gate === t.noise_gate));
  }
  if (typeof t.balance === "number") {
    const gamePct = Math.round(((255 - t.balance) / 255) * 100);
    $("balGame").textContent = gamePct + "%";
    $("balVoice").textContent = (100 - gamePct) + "%";
    $("balFill").style.width = gamePct + "%";
  }
}

/* ---------- status ---------- */
async function refreshStatus() {
  const s = await call("get_status");
  const paused = !!s.paused;
  let state = s.state || "error";
  if (paused) state = "paused";

  const map = {
    undocked: { text: "HEADPHONES ACTIVE", big: "HEADPHONES", dot: "blue", sub: "Headset undocked" },
    docked: { text: "DOCKED — SPEAKERS", big: "SPEAKERS", dot: "ok", sub: "Headset docked" },
    off: { text: "HEADSET OFF — SPEAKERS", big: "SPEAKERS", dot: "ok", sub: "Headset off" },
    paused: { text: "AUTOMATION PAUSED", big: "PAUSED", dot: "", sub: "Output stays where it is until you resume." },
    error: { text: "BASE STATION NOT FOUND", big: "NO BASE", dot: "bad", sub: "" },
  };
  const m = map[state] || map.error;
  $("stateText").textContent = m.text;
  $("stateBig").textContent = m.big;
  $("stateBig").classList.toggle("paused", state === "paused");
  $("pillDot").className = "dot " + m.dot;
  $("heroSub").textContent = m.sub + (state === "docked" && s.charging ? " · charging" : "") +
    (s.default_id ? " · " + deviceName(s.default_id) : "");
  $("pollLine").innerHTML = "base station: <b>" + (state === "error" ? "offline" : "online") + "</b>";
  setPauseUi(paused);

  // active route highlight
  const activeKey = state === "undocked" ? "B" : (state === "docked" || state === "off") ? "A" : null;
  ["A", "B"].forEach((k) => {
    $("route" + k).classList.toggle("active", k === activeKey);
    $("badge" + k).hidden = k !== activeKey;
  });

  // battery
  const charge = s.charge;
  const chip = $("batChip");
  const segs = $("batSegs").querySelectorAll("i");
  segs.forEach((el, i) => {
    const w = charge == null ? 0 : Math.max(0, Math.min(100, (charge - i * 25) * 4));
    el.style.setProperty("--w", w + "%");
  });
  if (charge == null) {
    $("batNum").textContent = "--%";
    chip.classList.remove("low", "charging");
  } else {
    $("batNum").textContent = charge + "%";
    chip.classList.toggle("low", charge <= 20);
    chip.classList.toggle("charging", !!s.charging);
  }

  $("accBanner").hidden = !s.acc_running;
  const upd = s.update_available && s.latest_version ? s.latest_version : manualUpd;
  $("updPill").hidden = !upd;
  if (upd) $("updPill").textContent = "UPDATE " + upd + "  ↗";
  if (s.version) {
    $("aboutVer").textContent = "A50 DOCK SWITCH " + s.version;
    $("aboutVerTop").textContent = s.version;
  }

  const offline = state === "error" && s.ts > 0;
  $("connectScreen").hidden = !offline;
  if (offline) {
    $("cl2").textContent = s.acc_running
      ? "Close Astro Command Center, then auto switching resumes."
      : "Connect the A50 base station over USB and set it to PC mode. Auto switching resumes as soon as it is detected.";
  }
  $("defaultLine").textContent = "default: " + deviceName(s.default_id);

  applyTelemetry(s.telem);
}

/* ---------- history ---------- */
function renderLog(box, lines, max) {
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const rows = lines.slice(-max).reverse();
  box.innerHTML = rows.map((l) => {
    const i = l.indexOf("  ");
    const ts = i > 0 ? l.slice(0, i) : "";
    const msg = i > 0 ? l.slice(i + 2) : l;
    const kind = /→|->|switch/i.test(msg) ? "sw" : /connected|resumed|ok/i.test(msg) ? "ok" : "";
    const time = ts.length > 8 ? ts.slice(-8) : ts;
    return `<div class="line"><span class="t">${escapeHtml(time)}</span><span class="d ${kind}"></span><span class="m">${escapeHtml(msg)}</span></div>`;
  }).join("");
  if (nearBottom) box.scrollTop = 0;
}
async function refreshHistory() {
  const lines = (await call("get_history", 150)) || [];
  renderLog($("historyMini"), lines, 12);
  renderLog($("history"), lines, 150);
}

/* ---------- volumes ---------- */
async function loadVolumes() {
  const ids = [...new Set([config.docked_id, config.undocked_id, mixIds.game, mixIds.voice].filter(Boolean))];
  const vols = (await call("get_volumes", ids)) || {};
  setupVol("A", config.docked_id, vols);
  setupVol("B", config.undocked_id, vols);
  if (mixIds.game && vols[mixIds.game]) {
    $("gameVal").textContent = vols[mixIds.game].level + "%";
    $("gameSlider").value = vols[mixIds.game].level;
  }
  if (mixIds.voice && vols[mixIds.voice]) {
    $("voiceVal").textContent = vols[mixIds.voice].level + "%";
    $("voiceSlider").value = vols[mixIds.voice].level;
  }
}
function setupVol(key, id, vols) {
  volInfo[key].id = id || null;
  const v = (id && vols[id]) || null;
  volInfo[key].muted = v ? !!v.muted : false;
  const level = v ? v.level : 50;
  $("vol" + key).value = level;
  $("volVal" + key).textContent = volInfo[key].muted ? "MUTED" : level + "%";
  const mb = $("mute" + key);
  mb.textContent = volInfo[key].muted ? "UNMUTE" : "MUTE";
  mb.classList.toggle("on", volInfo[key].muted);
}
function bindVolume(key) {
  const slider = $("vol" + key);
  slider.addEventListener("input", () => {
    $("volVal" + key).textContent = slider.value + "%";
    if (volInfo[key].id) call("set_volume", volInfo[key].id, +slider.value);
  });
  slider.addEventListener("change", async () => {
    if (!volInfo[key].id) return;
    await call("set_volume", volInfo[key].id, +slider.value);
    await call("remember_volume", volInfo[key].id, +slider.value);
    config = await call("get_config");
  });
  $("mute" + key).addEventListener("click", async () => {
    if (!volInfo[key].id) return;
    const next = !volInfo[key].muted;
    await call("set_mute", volInfo[key].id, next);
    volInfo[key].muted = next;
    $("mute" + key).textContent = next ? "UNMUTE" : "MUTE";
    $("mute" + key).classList.toggle("on", next);
    $("volVal" + key).textContent = next ? "MUTED" : slider.value + "%";
  });
}
function bindMix(sliderId, valId, getId) {
  const slider = $(sliderId);
  slider.addEventListener("input", () => {
    $(valId).textContent = slider.value + "%";
    const id = getId();
    if (id) call("set_volume", id, +slider.value);
  });
  slider.addEventListener("change", async () => {
    const id = getId();
    if (!id) return;
    await call("set_volume", id, +slider.value);
    await loadVolumes();
  });
}

async function saveConfig(partial, msgEl, okText) {
  try {
    config = await call("update_config", partial);
    if (msgEl) flash(msgEl, okText || "Saved", "ok");
    return true;
  } catch (e) {
    if (msgEl) flash(msgEl, "Save failed: " + e, "bad");
    return false;
  }
}
function hset(action, value, preset, msgEl, okText) {
  call("hset", action, value, preset)
    .then(() => { if (msgEl) flash(msgEl, okText || "Sent to headset", "ok"); })
    .catch((e) => { if (msgEl) flash(msgEl, "Failed: " + e, "bad"); });
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $("page-" + name).classList.add("active");
  const onSettings = name === "settings";
  $("batGear").classList.toggle("active", onSettings);
  $("batGear").title = onSettings ? "Back to dashboard" : "Settings";
  if (onSettings) refreshHistory();
}

async function saveRouting() {
  const dockedId = $("dockedSel").value;
  const undockedId = $("undockedSel").value;
  if (dockedId === undockedId) { flash($("routeMsg"), "Pick two different devices", "bad"); return; }
  const ok = await saveConfig({
    docked_id: dockedId, docked_name: deviceName(dockedId),
    undocked_id: undockedId, undocked_name: deviceName(undockedId),
  }, $("routeMsg"), "Routing saved");
  if (ok) await loadVolumes();
}

function bind() {
  $("winMin").addEventListener("click", () => call("win_min"));
  $("winClose").addEventListener("click", () => call("win_close"));
  $("batGear").addEventListener("click", () =>
    showPage($("page-settings").classList.contains("active") ? "dashboard" : "settings"));

  document.querySelectorAll("#themeRow .theme-opt").forEach((b) => {
    b.addEventListener("click", async () => {
      applyTheme(b.dataset.themePick);
      await saveConfig({ theme: b.dataset.themePick });
    });
  });

  document.querySelectorAll("#presetRow .preset").forEach((b) => {
    b.addEventListener("click", () => hset("eq_preset", +b.dataset.preset, null, $("eqMsg"), "Preset activated"));
  });
  for (let i = 0; i < 5; i++) {
    const el = $("eq" + i);
    el.addEventListener("input", drawEq);
    el.addEventListener("change", () => {
      const gains = [0, 1, 2, 3, 4].map((k) => +$("eq" + k).value);
      hset("eq_gain", gains, activePreset, $("eqMsg"), "EQ saved to preset");
    });
  }
  $("eqReset").addEventListener("click", () => {
    for (let i = 0; i < 5; i++) $("eq" + i).value = 0;
    drawEq();
    hset("eq_gain", [0, 0, 0, 0, 0], activePreset, $("eqMsg"), "EQ reset");
  });

  $("sidetoneSlider").addEventListener("input", () => { $("sidetoneVal").textContent = $("sidetoneSlider").value + "%"; });
  $("sidetoneSlider").addEventListener("change", () => hset("sidetone", +$("sidetoneSlider").value, null, $("micMsg"), "Sidetone set"));
  $("micSlider").addEventListener("input", () => { $("micVal").textContent = $("micSlider").value + "%"; });
  $("micSlider").addEventListener("change", () => hset("mic", +$("micSlider").value, null, $("micMsg"), "Mic level set"));
  document.querySelectorAll("#gateRow .preset").forEach((b) => {
    b.addEventListener("click", () => hset("noise_gate", +b.dataset.gate, null, $("micMsg"), "Noise gate set"));
  });

  bindMix("gameSlider", "gameVal", () => mixIds.game);
  bindMix("voiceSlider", "voiceVal", () => mixIds.voice);

  $("dockedSel").addEventListener("change", saveRouting);
  $("undockedSel").addEventListener("change", saveRouting);

  $("btnHead").addEventListener("click", async () => {
    const r = await call("switch_now", "undocked");
    flash($("ctrlMsg"), r && r.ok ? "Switching → " + r.device : "Failed", r && r.ok ? "ok" : "bad");
    setTimeout(refreshStatus, 600);
  });
  $("btnSpeakers").addEventListener("click", async () => {
    const r = await call("switch_now", "docked");
    flash($("ctrlMsg"), r && r.ok ? "Switching → " + r.device : "Failed", r && r.ok ? "ok" : "bad");
    setTimeout(refreshStatus, 600);
  });
  $("btnPause").addEventListener("click", async () => {
    await saveConfig({ paused: !config.paused });
    setPauseUi(config.paused);
    flash($("ctrlMsg"), config.paused ? "Paused" : "Resumed", "ok");
    setTimeout(refreshStatus, 300);
  });

  $("setInterval").addEventListener("change", (e) =>
    saveConfig({ interval: Math.max(0, +e.target.value || 0) }, $("setMsg"), "Poll interval saved"));
  $("setDebounce").addEventListener("change", (e) =>
    saveConfig({ debounce: Math.max(1, +e.target.value || 1) }, $("setMsg"), "Confirm reads saved"));
  $("chkNotify").addEventListener("change", (e) =>
    saveConfig({ notifications: e.target.checked }, $("setMsg"), e.target.checked ? "Notifications on" : "Notifications off"));
  $("chkAutostart").addEventListener("change", async () => {
    try {
      config = await call("set_autostart", $("chkAutostart").checked);
      flash($("setMsg"), $("chkAutostart").checked ? "Starts with Windows" : "Autostart off", "ok");
    } catch (err) {
      flash($("setMsg"), "Autostart failed", "bad");
    }
  });

  $("btnRefreshHist").addEventListener("click", refreshHistory);
  $("btnOpenLog").addEventListener("click", () => call("open_log_dir"));

  $("btnCheckUpd").addEventListener("click", async () => {
    const st = $("updStatus");
    st.textContent = "CHECKING...";
    st.className = "hint";
    let r;
    try { r = await call("check_update"); } catch (e) { r = { error: String(e) }; }
    if (!r || r.error) { st.textContent = "CHECK FAILED — TRY AGAIN"; st.className = "hint upd-bad"; return; }
    if (r.update) {
      manualUpd = r.tag;
      st.className = "hint upd-ok";
      st.innerHTML = '<a class="upd-link" href="https://github.com/bboymain/a50-dock-switch/releases/latest" target="_blank" rel="noreferrer">' +
        escapeHtml(r.tag) + " AVAILABLE ↗</a>";
    } else {
      manualUpd = "";
      st.textContent = "YOU'RE UP TO DATE (" + escapeHtml(r.current || "") + ")";
      st.className = "hint upd-ok";
    }
  });

  bindVolume("A");
  bindVolume("B");
}

ready(async () => {
  const t0 = Date.now();
  const bootDone = () => {
    const wait = Math.max(0, 1900 - (Date.now() - t0));
    setTimeout(() => {
      const b = $("bootScreen");
      if (!b) return;
      b.classList.add("done");
      setTimeout(() => b.remove(), 700);
    }, wait);
  };
  try {
    await loadConfig();
    bind();
    await loadDevices();
    await loadVolumes();
    drawEq();
    await refreshStatus();
    bootDone();
    await refreshHistory();
    setInterval(refreshStatus, 1000);
    setInterval(refreshHistory, 5000);
    setInterval(async () => { await loadDevices(); await loadVolumes(); }, 30000);
  } catch (e) {
    bootDone();
    document.body.insertAdjacentHTML("afterbegin",
      '<div style="padding:14px;background:#e04545;color:#fff;font-weight:700">Dashboard error: ' + escapeHtml(String(e)) + "</div>");
  }
});
