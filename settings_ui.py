import tkinter as tk
from tkinter import ttk, messagebox

import audio_switch
import config as cfg


class SettingsApp:
    def __init__(self, root):
        self.root = root
        root.title("A50 Dock Switch — Settings")
        root.resizable(False, False)

        cfg.load()
        data = cfg.get()
        self.devices = audio_switch.list_devices()
        self.by_id = {d["id"]: d for d in self.devices}

        pad = {"padx": 8, "pady": 6}
        frm = ttk.Frame(root, padding=12)
        frm.grid(row=0, column=0, sticky="nsew")

        ttk.Label(frm, text="When DOCKED (headset in base) switch to:").grid(
            row=0, column=0, sticky="w", **pad)
        self.docked_var = tk.StringVar(value=data["docked_id"])
        self.docked_box = ttk.Combobox(
            frm, textvariable=self.docked_var, state="readonly", width=52,
            values=self._values(data["docked_id"]))
        self.docked_box.grid(row=1, column=0, sticky="we", **pad)

        ttk.Label(frm, text="When UNDOCKED (headset on your head) switch to:").grid(
            row=2, column=0, sticky="w", **pad)
        self.undocked_var = tk.StringVar(value=data["undocked_id"])
        self.undocked_box = ttk.Combobox(
            frm, textvariable=self.undocked_var, state="readonly", width=52,
            values=self._values(data["undocked_id"]))
        self.undocked_box.grid(row=3, column=0, sticky="we", **pad)

        opts = ttk.Frame(frm)
        opts.grid(row=4, column=0, sticky="w", **pad)
        ttk.Label(opts, text="Poll every (sec, 0 = fastest):").grid(row=0, column=0, padx=(0, 4))
        self.interval_var = tk.IntVar(value=int(data["interval"]))
        ttk.Spinbox(opts, from_=0, to=30, textvariable=self.interval_var,
                    width=4).grid(row=0, column=1, padx=(0, 16))
        ttk.Label(opts, text="Confirm after (reads):").grid(row=0, column=2, padx=(0, 4))
        self.debounce_var = tk.IntVar(value=int(data["debounce"]))
        ttk.Spinbox(opts, from_=1, to=10, textvariable=self.debounce_var,
                    width=4).grid(row=0, column=3, padx=(0, 16))
        self.autostart_var = tk.BooleanVar(value=bool(data["autostart"]))
        ttk.Checkbutton(opts, text="Start with Windows",
                        variable=self.autostart_var).grid(row=0, column=4)

        cur = next((d for d in self.devices if d["is_default"]), None)
        self.cur_label = ttk.Label(
            frm, text="Current default: " + (cur["name"] if cur else "?"),
            foreground="#555")
        self.cur_label.grid(row=5, column=0, sticky="w", **pad)

        btns = ttk.Frame(frm)
        btns.grid(row=6, column=0, sticky="e", **pad)
        ttk.Button(btns, text="Refresh list", command=self.refresh).grid(
            row=0, column=0, padx=4)
        ttk.Button(btns, text="Cancel", command=root.destroy).grid(
            row=0, column=1, padx=4)
        ttk.Button(btns, text="Save", command=self.save).grid(row=0, column=2, padx=4)

    def _values(self, selected_id):
        return [
            d["name"] + ("   [current default]" if d["is_default"] else "")
            for d in self.devices
        ]

    def _id_for_label(self, label):
        if not label:
            return ""
        name = label.split("   [current default]")[0]
        for d in self.devices:
            if d["name"] == name:
                return d["id"]
        return label

    def refresh(self):
        self.devices = audio_switch.list_devices()
        self.by_id = {d["id"]: d for d in self.devices}
        self.docked_box.configure(values=self._values(self.docked_var.get()))
        self.undocked_box.configure(values=self._values(self.undocked_var.get()))
        cur = next((d for d in self.devices if d["is_default"]), None)
        self.cur_label.configure(
            text="Current default: " + (cur["name"] if cur else "?"))

    def save(self):
        docked_id = self._id_for_label(self.docked_box.get())
        undocked_id = self._id_for_label(self.undocked_box.get())
        if not docked_id or not undocked_id:
            messagebox.showerror("Missing devices", "Pick both devices.")
            return
        docked_name = self.by_id.get(docked_id, {}).get("name", docked_id)
        undocked_name = self.by_id.get(undocked_id, {}).get("name", undocked_id)
        if docked_id == undocked_id:
            messagebox.showerror(
                "Same device",
                "Docked and undocked devices are the same — switching would do nothing.")
            return
        cfg.save({
            "docked_id": docked_id, "docked_name": docked_name,
            "undocked_id": undocked_id, "undocked_name": undocked_name,
            "interval": max(0, int(self.interval_var.get())),
            "debounce": max(1, int(self.debounce_var.get())),
        })
        want = bool(self.autostart_var.get())
        if want != cfg.get()["autostart"]:
            cfg.set_autostart(want)
        cfg.log("settings saved: docked=%s undocked=%s" % (docked_name, undocked_name))
        self.root.destroy()


def main():
    root = tk.Tk()
    SettingsApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
