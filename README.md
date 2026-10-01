# A50 Dock Switch

**Dock the headset → speakers. Undock it → headphones. Zero clicks.**

A tiny Windows tray app that watches your Astro A50 Gen 4 dock state and switches your default audio device automatically — so you never have to open the Windows mixer again just because you put your headset down.

It ships with a full **Astro Command Center-style dashboard**: battery, EQ control, sidetone, mic level, noise gate, game:voice mix, per-device volume memory, and themes.

## Features

- **Automatic switching** — dock detection over USB HID, ~1 second to switch
- **Manual override** — one-click switch from the dashboard or tray menu
- **Volume memory** — remembers and restores volume per device on every switch
- **Headset control** — EQ presets and 5-band gains, sidetone, mic level, noise gate, game:voice balance (writes are active-config only; nothing is persisted to the headset without your call)
- **Live telemetry** — battery ring, charge state, dock state, preset names
- **Command Center UI** — frameless window, boot splash, pulsing hero logo, connect-screen when the base station is offline, three themes (Astro Orange / Neon Glass / Minimal Dark)
- **Autostart** — optional "Start with Windows"
- **Notifications** — Windows toast on every switch

## Requirements

- Windows 10/11
- Astro A50 Gen 4 with the base station connected over USB
- For running from source: Python 3.10+

## Install (prebuilt)

1. Download `a50-dock-switch-v1.1.zip` (or grab it from Releases)
2. Unzip anywhere
3. Run `A50DockSwitch.exe` — it lives in the system tray
4. Open the dashboard from the tray menu, hit the gear, enable **Start with Windows**

> SmartScreen may warn on first run (unsigned build): **More info → Run anyway**.

## Run from source

```powershell
pip install -r requirements.txt
python main.py            # tray app
python dashboard_ui.py    # dashboard window (optional; tray can open it too)
```

## First run

1. Let it auto-pick devices (it prefers *Astro A50 Game* for undocked and your speakers for docked), or set them manually in **Dashboard → Audio Routing**
2. Dock/undock the headset — the default output switches itself
3. Tune EQ/sidetone/mix from the dashboard

## ⚠ Astro Command Center conflict

Astro Command Center grabs the headset's HID interface **exclusively** while it runs — which blinds this app. Keep ACC closed while A50 Dock Switch is running. The dashboard shows a red warning if it detects ACC, and the connect screen tells you to close it.

## How it works

- Polls dock/charge state via USB HID (`0x54`) on the base station's vendor interface
- Switches the Windows default audio device for all three roles (console/speech/media) through a small compiled C# helper (`helper.exe`, using the undocumented `IPolicyConfig` API)
- Dashboard ↔ core communicate over JSON files in `%APPDATA%\a50-dock-switch\` so only one process ever owns the HID handle

## Building a release

```powershell
pip install pyinstaller
pyinstaller --clean -y A50DockSwitch.spec
# -> dist\A50DockSwitch\
```

## Credits

- Created by **[@mainlek](https://x.com/mainlek)** — built because switching the mixer every time the headset came off got old fast
- [hyperheadset](https://github.com/HyperRaccoon13/HyperHeadset) — A50 HID stats client
- [eh-fifty](https://github.com/tdryer/eh-fifty) — A50 protocol research and documentation

## License

[MIT](LICENSE) — do whatever you want with it.
