# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("dashboard", "dashboard"),
        ("helper.exe", "."),
        ("helper.cs", "."),
    ],
    hiddenimports=[
        "pystray._win32",
        "pycaw",
        "winotify",
        "comtypes",
        "webview.backends.edgechromium",
        "webview.backends.winforms",
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["settings_ui", "probe"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="A50DockSwitch",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon="app.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="A50DockSwitch",
)
