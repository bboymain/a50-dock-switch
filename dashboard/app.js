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

async function call(name, ...args) {
  return await window.pywebview.api[name](...args);
}

function flash(el, text, cls) {
  el.textContent = text;
  el.className = "hint " + (cls || "");
  clearTimeout(el._t);
  if (cls) {
    el._t = setTimeout(() => {
      el.textContent = "";
      el.className = "hint";
    }, 3500);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function loadConfig() {
  config = await call("get_config");
  document.documentElement.dataset.theme = config.theme || "astro";
  $("themePicker").value = config.theme || "astro";
  $("setInterval").value = config.interval;
  $("setDebounce").value = config.debounce;
  $("chkNotify").checked = !!config.notifications;
  $("chkAutostart").checked = !!config.autostart;
  $("btnPause").textContent = config.paused ? "RESUME AUTOMATION" : "PAUSE AUTOMATION";
  $("btnPause").classList.toggle("on", !!config.paused);
}

async function loadDevices() {
  devices = (await call("list_devices")) || [];
  const opts = devices
    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}${d.is_default ? "   [default]" : ""}</option>`)
    .join("");
  $("dockedSel").innerHTML = opts;
  $("undockedSel").innerHTML = opts;
  if (config.docked_id) $("dockedSel").value = config.docked_id;
  if (config.undocked_id) $("undockedSel").value = config.undocked_id;

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

function applyTelemetry(t) {
  if (!t || t.ts === lastTelemTs) return;
  lastTelemTs = t.ts;

  const off = !t.available;
  const setHint = (el, msg) => { el.textContent = off ? msg : ""; };
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
    document.querySelectorAll("#presetRow .preset").forEach((b) => {
      b.classList.toggle("active", +b.dataset.preset === activePreset);
    });
  }

  if (Array.isArray(t.eq_gains)) {
    for (let i = 0; i < 5; i++) {
      const el = $("eq" + i);
      if (document.activeElement !== el) el.value = t.eq_gains[i];
    }
  }

  if (typeof t.noise_gate === "number") {
    document.querySelectorAll("#gateRow .preset").forEach((b) => {
      b.classList.toggle("active", +b.dataset.gate === t.noise_gate);
    });
  }

  if (typeof t.balance === "number") {
    const gamePct = Math.round(((255 - t.balance) / 255) * 100);
    $("balanceLine").innerHTML =
      "game:voice balance: <b>GAME " + gamePct + "% : VOICE " + (100 - gamePct) + "%</b>";
  }
}

async function refreshStatus() {
  const s = await call("get_status");
  const paused = !!s.paused;
  let state = s.state || "error";
  if (paused) state = "paused";

  const map = {
    undocked: { text: "HEADPHONES ACTIVE", big: "HEADPHONES", dot: "blue" },
    docked: { text: "DOCKED — SPEAKERS", big: "SPEAKERS", dot: "ok" },
    off: { text: "HEADSET OFF — SPEAKERS", big: "SPEAKERS", dot: "ok" },
    paused: { text: "AUTOMATION PAUSED", big: "PAUSED", dot: "" },
    error: { text: "BASE STATION NOT FOUND", big: "NO BASE", dot: "bad" },
  };
  const m = map[state] || map.error;
  $("stateText").textContent = m.text;
  $("stateBig").textContent = m.big;
  $("pillDot").className = "dot " + m.dot;

  const charge = s.charge;
  const chip = $("batChip");
  const segs = $("batSegs").querySelectorAll("i");
  const setSegs = (v) => {
    segs.forEach((el, i) => {
      el.style.width =
        v === null ? "0%" : Math.max(0, Math.min(100, (v - i * 25) * 4)) + "%";
    });
  };
  if (charge === null || charge === undefined) {
    $("batNum").textContent = "--%";
    setSegs(null);
    chip.classList.remove("low", "charging");
  } else {
    $("batNum").textContent = charge + "%";
    setSegs(charge);
    chip.classList.toggle("low", charge <= 20);
    chip.classList.toggle("charging", !!s.charging);
  }
  $("pollLine").innerHTML = "base station: <b>" + (state === "error" ? "offline" : "online") + "</b>";
  $("accLine").hidden = !s.acc_running;
  const upd = s.update_available && s.latest_version ? s.latest_version : manualUpd;
  $("updPill").hidden = !upd;
  if (upd) $("updPill").textContent = "UPDATE " + upd + "  ↗";
  if (s.version) $("aboutVer").textContent = "A50 DOCK SWITCH " + s.version;
  const offline = state === "error" && s.ts > 0;
  $("connectScreen").hidden = !offline;
  if (offline) {
    $("cl2").textContent = s.acc_running
      ? "OR CLOSE ASTRO COMMAND CENTER"
      : "OR SWITCH THE BASE STATION TO PC MODE";
  }
  $("defaultLine").innerHTML = "current default: <b>" + escapeHtml(deviceName(s.default_id)) + "</b>";

  applyTelemetry(s.telem);
}

async function refreshHistory() {
  const lines = (await call("get_history", 150)) || [];
  const box = $("history");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = lines
    .map((l) => {
      const i = l.indexOf("  ");
      const ts = i > 0 ? l.slice(0, i) : "";
      const msg = i > 0 ? l.slice(i + 2) : l;
      return `<div class="line"><span class="t">${escapeHtml(ts)}</span>  ${escapeHtml(msg)}</div>`;
    })
    .join("");
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

async function loadVolumes() {
  const ids = [...new Set([config.docked_id, config.undocked_id, mixIds.game, mixIds.voice].filter(Boolean))];
  const vols = (await call("get_volumes", ids)) || {};
  setupVol("A", "DOCKED", config.docked_id, config.docked_name, vols);
  setupVol("B", "UNDOCKED", config.undocked_id, config.undocked_name, vols);

  if (mixIds.game && vols[mixIds.game]) {
    $("gameVal").textContent = vols[mixIds.game].level + "%";
    $("gameSlider").value = vols[mixIds.game].level;
  }
  if (mixIds.voice && vols[mixIds.voice]) {
    $("voiceVal").textContent = vols[mixIds.voice].level + "%";
    $("voiceSlider").value = vols[mixIds.voice].level;
  }
}

function setupVol(key, tag, id, name, vols) {
  volInfo[key].id = id || null;
  const v = (id && vols[id]) || null;
  volInfo[key].muted = v ? !!v.muted : false;
  $("volLabel" + key).textContent = tag + " — " + (name || "--");
  const level = v ? v.level : 50;
  $("vol" + key).value = level;
  $("volVal" + key).textContent = level + "%";
  const mb = $("mute" + key);
  mb.textContent = volInfo[key].muted ? "UNMUTE" : "MUTE";
  mb.classList.toggle("on", volInfo[key].muted);
}

function bindVolume(key) {
  const slider = $("vol" + key);
  const val = $("volVal" + key);
  slider.addEventListener("input", () => {
    val.textContent = slider.value + "%";
    if (volInfo[key].id) call("set_volume", volInfo[key].id, +slider.value);
  });
  slider.addEventListener("change", async () => {
    if (!volInfo[key].id) return;
    await call("set_volume", volInfo[key].id, +slider.value);
    await call("remember_volume", volInfo[key].id, +slider.value);
    config = await call("get_config");
    if ((key === "A" && mixIds.game === volInfo[key].id) ||
        (key === "B" && mixIds.game === volInfo[key].id)) {
      await loadVolumes();
    }
  });
  $("mute" + key).addEventListener("click", async () => {
    if (!volInfo[key].id) return;
    const next = !volInfo[key].muted;
    await call("set_mute", volInfo[key].id, next);
    volInfo[key].muted = next;
    const mb = $("mute" + key);
    mb.textContent = next ? "UNMUTE" : "MUTE";
    mb.classList.toggle("on", next);
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
  $("dashTab").classList.toggle("active", name === "dashboard");
  const onSettings = name === "settings";
  $("batGear").classList.toggle("active", onSettings);
  $("batGear").title = onSettings ? "Back to dashboard" : "Settings";
  if (onSettings) refreshHistory();
}

function bind() {
  $("dashTab").addEventListener("click", () => showPage("dashboard"));
  $("winMin").addEventListener("click", () => call("win_min"));
  $("winClose").addEventListener("click", () => call("win_close"));
  $("batGear").addEventListener("click", () =>
    showPage($("page-settings").classList.contains("active") ? "dashboard" : "settings")
  );

  $("themePicker").addEventListener("change", async (e) => {
    document.documentElement.dataset.theme = e.target.value;
    await saveConfig({ theme: e.target.value });
  });

  document.querySelectorAll("#presetRow .preset").forEach((b) => {
    b.addEventListener("click", () => {
      hset("eq_preset", +b.dataset.preset, null, $("eqMsg"), "Preset activated");
    });
  });

  for (let i = 0; i < 5; i++) {
    const el = $("eq" + i);
    el.addEventListener("change", () => {
      const gains = [0, 1, 2, 3, 4].map((k) => +$("eq" + k).value);
      hset("eq_gain", gains, activePreset, $("eqMsg"), "EQ saved to preset");
    });
  }

  $("sidetoneSlider").addEventListener("input", () => {
    $("sidetoneVal").textContent = $("sidetoneSlider").value + "%";
  });
  $("sidetoneSlider").addEventListener("change", () => {
    hset("sidetone", +$("sidetoneSlider").value, null, $("micMsg"), "Sidetone set");
  });

  $("micSlider").addEventListener("input", () => {
    $("micVal").textContent = $("micSlider").value + "%";
  });
  $("micSlider").addEventListener("change", () => {
    hset("mic", +$("micSlider").value, null, $("micMsg"), "Mic level set");
  });

  document.querySelectorAll("#gateRow .preset").forEach((b) => {
    b.addEventListener("click", () => {
      hset("noise_gate", +b.dataset.gate, null, $("micMsg"), "Noise gate set");
    });
  });

  bindMix("gameSlider", "gameVal", () => mixIds.game);
  bindMix("voiceSlider", "voiceVal", () => mixIds.voice);

  $("saveRoute").addEventListener("click", async () => {
    const dockedId = $("dockedSel").value;
    const undockedId = $("undockedSel").value;
    if (dockedId === undockedId) {
      flash($("routeMsg"), "Pick two different devices", "bad");
      return;
    }
    const ok = await saveConfig({
      docked_id: dockedId, docked_name: deviceName(dockedId),
      undocked_id: undockedId, undocked_name: deviceName(undockedId),
    }, $("routeMsg"), "Routing saved");
    if (ok) await loadVolumes();
  });

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
    $("btnPause").textContent = config.paused ? "RESUME AUTOMATION" : "PAUSE AUTOMATION";
    $("btnPause").classList.toggle("on", !!config.paused);
    flash($("ctrlMsg"), config.paused ? "Paused" : "Resumed", "ok");
  });

  $("setInterval").addEventListener("change", (e) => {
    saveConfig({ interval: Math.max(0, +e.target.value || 0) }, $("setMsg"), "Poll interval saved");
  });
  $("setDebounce").addEventListener("change", (e) => {
    saveConfig({ debounce: Math.max(1, +e.target.value || 1) }, $("setMsg"), "Confirm reads saved");
  });
  $("chkNotify").addEventListener("change", (e) => {
    saveConfig({ notifications: e.target.checked }, $("setMsg"),
      e.target.checked ? "Notifications on" : "Notifications off");
  });
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
    try {
      r = await call("check_update");
    } catch (e) {
      r = { error: String(e) };
    }
    if (!r || r.error) {
      st.textContent = "CHECK FAILED — TRY AGAIN";
      st.className = "hint upd-bad";
      return;
    }
    if (r.update) {
      manualUpd = r.tag;
      st.className = "hint upd-ok";
      st.innerHTML =
        '<a class="upd-link" href="' + "https://github.com/bboymain/a50-dock-switch/releases/latest" +
        '" target="_blank" rel="noreferrer">' + escapeHtml(r.tag) + " AVAILABLE ↗</a>";
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
    await refreshStatus();
    bootDone();
    await refreshHistory();
    setInterval(refreshStatus, 1000);
    setInterval(refreshHistory, 5000);
    setInterval(async () => {
      await loadDevices();
      await loadVolumes();
    }, 30000);
  } catch (e) {
    bootDone();
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div style="padding:14px;background:#e04545;color:#fff;font-weight:700">Dashboard error: ' +
        escapeHtml(String(e)) + "</div>");
  }
});
