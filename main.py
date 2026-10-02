import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.request

import pystray
from PIL import Image, ImageDraw

import audio_switch
import config as cfg

DIR = os.path.dirname(os.path.abspath(__file__))
STATUS_PATH = os.path.join(cfg.APPDIR, "status.json")
TELEM_PATH = os.path.join(cfg.APPDIR, "telemetry.json")
COMMAND_PATH = os.path.join(cfg.APPDIR, "command.json")

SLIDER_MIC = 0x04
SLIDER_SIDETONE = 0x05
NOISE_GATE_MODES = ["STREAMING", "NIGHT", "HOME", "TOURNAMENT"]


def _unhandled(t, v, tb):
    try:
        text = "".join(traceback.format_exception(t, v, tb)).strip()
        cfg.log("FATAL: " + text.replace("\n", " | "))
    except Exception:
        pass


sys.excepthook = _unhandled
threading.excepthook = lambda a: _unhandled(a.exc_type, a.exc_value, a.exc_traceback)

COLOR = {
    "undocked": (47, 111, 237),
    "docked": (47, 174, 79),
    "off": (47, 174, 79),
    "paused": (130, 130, 130),
    "error": (220, 60, 60),
}

STATE_TEXT = {
    "undocked": "Headphones (undocked)",
    "docked": "Docked — speakers",
    "off": "Headset off — speakers",
    "paused": "Paused",
    "error": "Base station not found",
}

NOTIFY_TEXT = {
    "undocked": "Headphones active",
    "docked": "Speakers active (docked)",
    "off": "Speakers active (headset off)",
}

_running = True
_state = "error"
_battery = ""
_charge = None
_charging = False
_icon = None
_last_render = None
_last_status_ts = 0
_acc_cache = False
_acc_ts = 0
_acc_warned = False
_update_available = False
_latest_version = ""

hid_lock = threading.Lock()
telem_refresh = threading.Event()


def make_icon_image(color):
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 60, 60], fill=color + (255,))
    d.arc([16, 20, 48, 52], 180, 360, fill=(255, 255, 255, 255), width=5)
    d.line([16, 36, 16, 44], fill=(255, 255, 255, 255), width=5)
    d.line([48, 36, 48, 44], fill=(255, 255, 255, 255), width=5)
    return img


def set_state(state, battery=None):
    global _state, _battery, _last_render
    _state = state
    if battery is not None:
        _battery = battery
    if (state, _battery) == _last_render:
        return
    _last_render = (state, _battery)
    if _icon:
        _icon.icon = make_icon_image(COLOR.get(state, COLOR["error"]))
        _icon.title = "A50 Dock Switch — " + STATE_TEXT.get(state, state) + _battery
        _icon.update_menu()


def target_for(state, data):
    if state == "undocked":
        return data["undocked_id"], data["undocked_name"]
    return data["docked_id"], data["docked_name"]


def notify(msg):
    if not cfg.get().get("notifications", True):
        return
    try:
        from winotify import Notification
        Notification(app_id="A50 Dock Switch", title="A50 Dock Switch",
                     msg=msg).show()
    except Exception as e:
        cfg.log("notify failed: " + str(e))


def open_dashboard():
    if getattr(sys, "frozen", False):
        subprocess.Popen([sys.executable, "--dashboard"])
    else:
        subprocess.Popen([cfg.pythonw_path(), "dashboard_ui.py"], cwd=DIR)


def on_toggle_pause(item):
    data = cfg.get()
    paused = not data["paused"]
    cfg.save({"paused": paused})
    if paused:
        set_state("paused")
    else:
        set_state("error")


def on_quit(icon, item):
    global _running
    _running = False
    icon.stop()


def open_releases(icon, item):
    try:
        os.startfile(cfg.UPDATE_URL)
    except Exception as e:
        cfg.log("open releases failed: " + str(e))


def update_loop():
    global _update_available, _latest_version
    time.sleep(15)
    first = True
    last_err = None
    while _running:
        tag = ""
        err = ""
        try:
            req = urllib.request.Request(
                cfg.UPDATE_API,
                headers={
                    "User-Agent": "a50-dock-switch/" + cfg.APP_VERSION,
                    "Accept": "application/vnd.github+json",
                },
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                tag = json.loads(resp.read().decode("utf-8")).get("tag_name") or ""
            if not tag:
                err = "no tag_name in response"
        except Exception as e:
            err = str(e)
        has = bool(tag) and cfg.ver_tuple(tag) > cfg.ver_tuple(cfg.APP_VERSION)
        if first or has != _update_available or (has and tag != _latest_version) or err != last_err:
            fresh = has and not _update_available
            _update_available = has
            _latest_version = tag if has else ""
            if has:
                cfg.log("update check: %s available (installed %s)" % (tag, cfg.APP_VERSION))
            elif err:
                cfg.log("update check failed: " + err)
            else:
                cfg.log("update check: up to date")
            if _icon:
                _icon.update_menu()
            if fresh:
                notify("Update available: %s" % tag)
        first = False
        last_err = err
        time.sleep(6 * 3600)


def build_menu():
    return pystray.Menu(
        pystray.MenuItem(lambda item: STATE_TEXT.get(_state, _state), None, enabled=False),
        pystray.MenuItem(lambda item: "Battery" + _battery, None, enabled=False),
        pystray.MenuItem(
            lambda item: ("Resume" if cfg.get()["paused"] else "Pause"),
            on_toggle_pause,
        ),
        pystray.MenuItem(
            lambda item: "Update available (%s)" % _latest_version,
            open_releases,
            visible=lambda item: _update_available,
        ),
        pystray.MenuItem("Open Dashboard...", open_dashboard),
        pystray.MenuItem("Quit", on_quit),
    )


def read_command():
    try:
        with open(COMMAND_PATH, "r", encoding="utf-8") as f:
            raw = f.read()
        os.remove(COMMAND_PATH)
        return json.loads(raw)
    except Exception:
        return None


def write_json_atomic(path, payload):
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        os.replace(tmp, path)
    except Exception:
        pass


def write_status(state):
    global _last_status_ts, _acc_cache, _acc_ts
    now = time.time()
    if now - _last_status_ts < 0.5:
        return
    _last_status_ts = now
    try:
        default_id = audio_switch.get_default_id()
    except Exception:
        default_id = ""
    if now - _acc_ts > 5:
        _acc_ts = now
        try:
            out = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq AstroCommandCenter.exe"],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            ).stdout
            _acc_cache = "AstroCommandCenter.exe" in out
        except Exception:
            _acc_cache = False
    write_json_atomic(STATUS_PATH, {
        "state": state,
        "battery_str": _battery.strip(),
        "charge": _charge,
        "charging": _charging,
        "paused": cfg.get()["paused"],
        "default_id": default_id,
        "acc_running": _acc_cache,
        "version": cfg.APP_VERSION,
        "update_available": _update_available,
        "latest_version": _latest_version,
        "ts": now,
    })


def execute_hset(client, cmd):
    action = cmd.get("action")
    value = cmd.get("value")
    with hid_lock:
        if action == "sidetone":
            client._query(0x62, [SLIDER_SIDETONE, max(0, min(100, int(value)))])
        elif action == "mic":
            client._query(0x62, [SLIDER_MIC, max(0, min(100, int(value)))])
        elif action == "eq_preset":
            if int(value) not in (1, 2, 3):
                raise ValueError("bad preset")
            client._query(0x67, [int(value)])
        elif action == "eq_gain":
            preset = int(cmd.get("preset", 1))
            gains = [max(-7, min(7, int(g))) for g in value]
            if preset not in (1, 2, 3) or len(gains) != 5:
                raise ValueError("bad eq gain")
            client._query(0x63, [preset] + [g + 12 for g in gains])
        elif action == "noise_gate":
            if int(value) not in (0, 1, 2, 3):
                raise ValueError("bad noise gate")
            client._query(0x64, [int(value)])
        else:
            raise ValueError("unknown hset action: " + str(action))
    cfg.log("headset set %s -> %s" % (action, value))
    telem_refresh.set()


def telemetry_loop():
    from hyperheadset import AstroA50Client

    client = AstroA50Client()
    last_err = None

    def q(command, payload=None):
        with hid_lock:
            return client._query(command, payload)

    while _running:
        data = {"ts": time.time()}
        try:
            data["sidetone"] = q(0x68, [SLIDER_SIDETONE])[2]
            data["mic"] = q(0x68, [SLIDER_MIC])[2]
            data["eq_preset"] = q(0x6C)[0]
            data["noise_gate"] = q(0x6A)[1]
            data["balance"] = q(0x72)[0]
            preset = data["eq_preset"]
            eq = q(0x69, [preset])
            data["eq_gains"] = [eq[2 + i] - 12 for i in range(5)]
            names = []
            for p in (1, 2, 3):
                resp = q(0x6E, [p, 0])
                raw = bytes(resp[2:]).split(b"\x00")[0]
                names.append(raw.decode("utf-8", errors="replace") or "PRESET %d" % p)
            data["eq_names"] = names
            data["available"] = True
            data.pop("error", None)
            last_err = None
        except Exception as e:
            data = {"ts": time.time(), "available": False, "error": str(e)}
            if str(e) != last_err:
                cfg.log("telemetry: " + str(e))
                last_err = str(e)
        write_json_atomic(TELEM_PATH, data)

        for _ in range(40):
            if not _running:
                return
            if telem_refresh.is_set():
                telem_refresh.clear()
                break
            time.sleep(0.15)


def poll_loop():
    from hyperheadset import AstroA50Client

    global _charge, _charging

    client = None
    pending = None
    pending_count = 0
    applied = None
    last_error = None
    cycle = 0

    while _running:
        cfg.reload_if_changed()
        data = cfg.get()
        interval = max(0.0, float(data["interval"]))
        debounce = max(1, int(data["debounce"]))
        want_battery = (cycle % 5 == 0)
        cycle += 1
        t0 = time.time()
        bat_text = None

        try:
            if client is None:
                client = AstroA50Client()
            with hid_lock:
                snap = client.getSnapshot(battery=want_battery, headset=True, sidetone=False)
            hd = snap["headset"]
            bat = snap.get("battery")
            state = "docked" if hd["isDocked"] else ("undocked" if hd["isOn"] else "off")
            if bat:
                _charge = bat.get("chargePercent")
                _charging = bool(bat.get("isCharging"))
                bat_text = "  %s%%%s" % (
                    _charge, " (charging)" if _charging else "")
            if last_error is not None:
                cfg.log("base station reconnected")
            last_error = None
        except Exception as e:
            client = None
            msg = str(e)
            if msg != last_error:
                cfg.log("read error: " + msg)
                last_error = msg
                set_state("error")
                if "HID interface not found" in msg and not _acc_warned:
                    _acc_warned = True
                    cfg.log("hint: Astro Command Center is running - close it "
                            "or dock switching will not work")
            time.sleep(1)
            write_status("error")
            continue
        _acc_warned = False

        try:
            cmd = read_command()
            if cmd and cmd.get("cmd") == "switch":
                dev_id = cmd.get("device_id", "")
                dev_name = cmd.get("device_name", dev_id)
                try:
                    audio_switch.set_default(dev_id)
                    applied = state
                    pending = state
                    pending_count = debounce
                    set_state(state, bat_text)
                    cfg.log("manual switch -> %s" % dev_name)
                    notify("Manual: " + dev_name)
                except Exception as e:
                    cfg.log("manual switch failed: " + str(e))
                    set_state("error")
            elif cmd and cmd.get("cmd") == "hset":
                try:
                    execute_hset(client, cmd)
                except Exception as e:
                    cfg.log("headset set failed: " + str(e))
                    telem_refresh.set()
            elif not data["paused"]:
                if state == pending:
                    pending_count += 1
                else:
                    pending = state
                    pending_count = 1

                if pending_count >= debounce and state != applied:
                    dev_id, dev_name = target_for(state, data)
                    if not dev_id:
                        applied = state
                        set_state(state, bat_text)
                        cfg.log("no device configured for state " + state)
                    else:
                        try:
                            audio_switch.set_default(dev_id)
                            import volume_ctrl
                            volume_ctrl.apply_remembered(dev_id, data.get("volumes", {}))
                            applied = state
                            set_state(state, bat_text)
                            cfg.log("switch -> %s (%s)" % (state, dev_name))
                            notify(NOTIFY_TEXT.get(state, state))
                        except Exception as e:
                            cfg.log("switch failed: " + str(e))
                            set_state("error")
                elif state == applied:
                    set_state(state, bat_text)
            else:
                set_state("paused", bat_text)
                applied = state

            write_status(state)
        except Exception as e:
            cfg.log("loop error: " + str(e))
            time.sleep(1)

        remaining = interval - (time.time() - t0)
        if remaining > 0:
            time.sleep(remaining)


def main():
    global _icon
    cfg.load()
    cfg.ensure_device_config()

    _icon = pystray.Icon(
        "a50-dock-switch",
        make_icon_image(COLOR["error"]),
        "A50 Dock Switch",
        menu=build_menu(),
    )

    threading.Thread(target=poll_loop, daemon=True).start()
    threading.Thread(target=telemetry_loop, daemon=True).start()
    threading.Thread(target=update_loop, daemon=True).start()

    _icon.run()


if __name__ == "__main__":
    if "--dashboard" in sys.argv:
        import dashboard_ui
        dashboard_ui.main()
    else:
        import ctypes
        _mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "A50DockSwitch_SingleInstance")
        if ctypes.windll.kernel32.GetLastError() == 183:
            sys.exit(0)
        main()
