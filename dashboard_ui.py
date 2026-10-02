import ctypes
import json
import os
import time

import webview

import audio_switch
import config as cfg

DIR = os.path.dirname(os.path.abspath(__file__))
STATUS_PATH = os.path.join(cfg.APPDIR, "status.json")
TELEM_PATH = os.path.join(cfg.APPDIR, "telemetry.json")
COMMAND_PATH = os.path.join(cfg.APPDIR, "command.json")
LOG_PATH = os.path.join(cfg.APPDIR, "events.log")

MUTEX_NAME = "Local\\A50DockSwitchDashboard"
ERROR_ALREADY_EXISTS = 183

_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
_k32.CreateMutexW.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p)
_k32.CreateMutexW.restype = ctypes.c_void_p


def _acquire_single_instance():
    _k32.CreateMutexW(None, False, MUTEX_NAME)
    return ctypes.get_last_error() != ERROR_ALREADY_EXISTS


class Api:
    def get_config(self):
        return cfg.load()

    def update_config(self, partial):
        data = cfg.save(partial)
        return data

    def set_autostart(self, on):
        cfg.set_autostart(bool(on))
        return cfg.get()

    def list_devices(self):
        return audio_switch.list_devices()

    def get_status(self):
        try:
            with open(STATUS_PATH, "r", encoding="utf-8") as f:
                status = json.load(f)
        except Exception:
            status = {"state": "error", "charge": None, "battery_str": "",
                      "charging": False, "paused": False, "default_id": "",
                      "ts": 0}
        try:
            with open(TELEM_PATH, "r", encoding="utf-8") as f:
                status["telem"] = json.load(f)
        except Exception:
            status["telem"] = {"available": False}
        return status

    def send_command(self, cmd):
        if not isinstance(cmd, dict) or "cmd" not in cmd:
            return {"ok": False, "error": "bad command"}
        tmp = COMMAND_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cmd, f)
        os.replace(tmp, COMMAND_PATH)
        return {"ok": True}

    def switch_now(self, state):
        data = cfg.get()
        if state == "undocked":
            dev_id, dev_name = data["undocked_id"], data["undocked_name"]
        else:
            dev_id, dev_name = data["docked_id"], data["docked_name"]
        if not dev_id:
            return {"ok": False, "error": "no device configured"}
        cmd = {"cmd": "switch", "device_id": dev_id, "device_name": dev_name}
        tmp = COMMAND_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cmd, f)
        os.replace(tmp, COMMAND_PATH)
        cfg.log("manual switch requested -> %s" % dev_name)
        return {"ok": True, "device": dev_name}

    def hset(self, action, value, preset=None):
        cmd = {"cmd": "hset", "action": action, "value": value}
        if preset is not None:
            cmd["preset"] = preset
        tmp = COMMAND_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cmd, f)
        os.replace(tmp, COMMAND_PATH)
        return {"ok": True}

    def get_history(self, n=100):
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as f:
                lines = f.read().splitlines()
            return lines[-n:]
        except Exception:
            return []

    def get_volumes(self, device_ids):
        import volume_ctrl
        out = {}
        for did in device_ids or []:
            try:
                out[did] = volume_ctrl.get_volume(did)
            except Exception:
                out[did] = None
        return out

    def set_volume(self, device_id, level):
        import volume_ctrl
        volume_ctrl.set_volume(device_id, int(level))
        return True

    def set_mute(self, device_id, muted):
        import volume_ctrl
        volume_ctrl.set_mute(device_id, bool(muted))
        return True

    def remember_volume(self, device_id, level):
        data = cfg.get()
        vols = dict(data.get("volumes", {}))
        vols[device_id] = int(level)
        cfg.save({"volumes": vols})
        return vols

    def open_log_dir(self):
        os.startfile(cfg.APPDIR)
        return True

    def check_update(self):
        import urllib.request
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
            with urllib.request.urlopen(req, timeout=8) as r:
                tag = json.loads(r.read().decode("utf-8")).get("tag_name") or ""
            if not tag:
                err = "no tag_name in response"
        except Exception as e:
            err = str(e)
        if err:
            cfg.log("manual update check failed: " + err)
            return {"error": err}
        update = cfg.ver_tuple(tag) > cfg.ver_tuple(cfg.APP_VERSION)
        cfg.log("manual update check: %s (installed %s)" % (tag, cfg.APP_VERSION))
        return {"tag": tag, "update": update, "current": cfg.APP_VERSION}

    def win_min(self):
        if webview.windows:
            webview.windows[0].minimize()
        return True

    def win_close(self):
        if webview.windows:
            webview.windows[0].destroy()
        return True


def main():
    if not _acquire_single_instance():
        hwnd = cfg.focus_dashboard()
        cfg.log("dashboard already running — focusing existing (hwnd=%d)" % hwnd)
        return
    cfg.load()
    html = os.path.join(DIR, "dashboard", "index.html")
    api = Api()
    webview.create_window(
        cfg.DASHBOARD_TITLE,
        "file:///" + html.replace("\\", "/"),
        js_api=api,
        width=1280,
        height=820,
        resizable=False,
        frameless=True,
        easy_drag=False,
        shadow=False,
        background_color="#0a0a0a",
    )
    webview.start()


if __name__ == "__main__":
    main()
