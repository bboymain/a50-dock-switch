import ctypes
import json
import os
import re
import sys
import threading
import time

APPDIR = os.path.join(os.environ["APPDATA"], "a50-dock-switch")
CONFIG_PATH = os.path.join(APPDIR, "config.json")
LOG_PATH = os.path.join(APPDIR, "events.log")

APP_VERSION = "v1.4"
REPO_URL = "https://github.com/bboymain/a50-dock-switch"
UPDATE_API = "https://api.github.com/repos/bboymain/a50-dock-switch/releases/latest"
UPDATE_URL = "https://github.com/bboymain/a50-dock-switch/releases/latest"

DASHBOARD_TITLE = "Astro Command Center — A50 Dock Switch"

_u32 = ctypes.windll.user32
_u32.FindWindowW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p)
_u32.FindWindowW.restype = ctypes.c_void_p
_u32.IsIconic.argtypes = (ctypes.c_void_p,)
_u32.ShowWindow.argtypes = (ctypes.c_void_p, ctypes.c_int)
_u32.SetForegroundWindow.argtypes = (ctypes.c_void_p,)
_u32.SetWindowPos.argtypes = (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int,
                              ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint)


def focus_dashboard():
    hwnd = _u32.FindWindowW(None, DASHBOARD_TITLE)
    if not hwnd:
        return 0
    if _u32.IsIconic(hwnd):
        _u32.ShowWindow(hwnd, 9)
    if not _u32.SetForegroundWindow(hwnd):
        _u32.SetWindowPos(hwnd, ctypes.c_void_p(-1), 0, 0, 0, 0, 0x43)
        _u32.SetWindowPos(hwnd, ctypes.c_void_p(-2), 0, 0, 0, 0, 0x43)
    return hwnd


def ver_tuple(tag):
    try:
        nums = re.findall(r"\d+", str(tag))
        return tuple(int(n) for n in nums[:3]) if nums else (0,)
    except Exception:
        return (0,)

DEFAULTS = {
    "interval": 1,
    "debounce": 1,
    "paused": False,
    "autostart": False,
    "docked_id": "",
    "docked_name": "",
    "undocked_id": "",
    "undocked_name": "",
    "theme": "astro",
    "notifications": True,
    "volumes": {},
}

_lock = threading.Lock()
_data = dict(DEFAULTS)
_mtime = None


def _read_raw():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load():
    global _data, _mtime
    os.makedirs(APPDIR, exist_ok=True)
    raw = _read_raw()
    if raw:
        merged = dict(DEFAULTS)
        merged.update({k: v for k, v in raw.items() if k in DEFAULTS})
        _data = merged
    try:
        _mtime = os.path.getmtime(CONFIG_PATH)
    except OSError:
        _mtime = None
    return _data


def save(new_data=None):
    global _data, _mtime
    with _lock:
        if new_data:
            _data.update({k: v for k, v in new_data.items() if k in DEFAULTS})
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_data, f, indent=2)
        os.replace(tmp, CONFIG_PATH)
        _mtime = os.path.getmtime(CONFIG_PATH)
    return _data


def get():
    with _lock:
        return dict(_data)


def reload_if_changed():
    global _data, _mtime
    try:
        m = os.path.getmtime(CONFIG_PATH)
    except OSError:
        return
    if _mtime is None or m != _mtime:
        raw = _read_raw()
        if raw:
            merged = dict(DEFAULTS)
            merged.update({k: v for k, v in raw.items() if k in DEFAULTS})
            with _lock:
                _data = merged
                _mtime = m


def log(msg):
    os.makedirs(APPDIR, exist_ok=True)
    line = time.strftime("%Y-%m-%d %H:%M:%S") + "  " + msg + "\n"
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line)


def ensure_device_config():
    import audio_switch
    data = get()
    if data["docked_id"] and data["undocked_id"]:
        return
    devices = audio_switch.list_devices()
    undocked = None
    docked = None
    for d in devices:
        n = d["name"].lower()
        if "a50" in n and "game" in n and undocked is None:
            undocked = d
        if "a50" in n and "voice" in n:
            continue
        if "realtek" in n and docked is None:
            docked = d
    if undocked is None:
        for d in devices:
            if "a50" in d["name"].lower():
                undocked = d
                break
    if docked is None:
        for d in devices:
            if "a50" not in d["name"].lower():
                docked = d
                break
    if undocked is None or docked is None:
        return
    save({
        "undocked_id": undocked["id"], "undocked_name": undocked["name"],
        "docked_id": docked["id"], "docked_name": docked["name"],
    })
    log("auto-picked devices: undocked=%s docked=%s" % (undocked["name"], docked["name"]))


def pythonw_path():
    exe = sys.executable
    base = os.path.basename(exe).lower()
    if base.startswith("python") and not base.startswith("pythonw"):
        cand = os.path.join(os.path.dirname(exe), "pythonw.exe")
        if os.path.exists(cand):
            return cand
    return exe


def set_autostart(enabled):
    import subprocess
    startup = os.path.join(
        os.environ["APPDATA"],
        "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
    )
    lnk = os.path.join(startup, "A50 Dock Switch.lnk")
    if getattr(sys, "frozen", False):
        target = sys.executable
        args = ""
        workdir = os.path.dirname(target)
    else:
        target = pythonw_path()
        main_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
        args = '"%s"' % main_py
        workdir = os.path.dirname(main_py)
    if not enabled:
        try:
            os.remove(lnk)
        except OSError:
            pass
        save({"autostart": False})
        return
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
        "$s.TargetPath='%s';$s.Arguments='%s';"
        "$s.WorkingDirectory='%s';$s.Save()"
    ) % (lnk, target, args, workdir)
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    save({"autostart": True})


load()
