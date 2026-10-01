import warnings

warnings.filterwarnings("ignore", message="COMError attempting to get property")

from pycaw.pycaw import AudioUtilities


def _endpoint(device_id):
    for dev in AudioUtilities.GetAllDevices():
        if dev.id == device_id:
            vol = dev.EndpointVolume
            if vol is None:
                break
            return vol
    raise RuntimeError("device not found: " + device_id)


def get_volume(device_id):
    vol = _endpoint(device_id)
    if hasattr(vol, "GetMasterVolumeLevelScalar"):
        level = round(vol.GetMasterVolumeLevelScalar() * 100)
        muted = bool(vol.GetMute())
    else:
        level = int(vol.volume_percent)
        muted = bool(vol.GetMute()) if hasattr(vol, "GetMute") else False
    return {"level": level, "muted": muted}


def set_volume(device_id, level_percent):
    vol = _endpoint(device_id)
    level_percent = max(0, min(100, int(level_percent)))
    if hasattr(vol, "SetMasterVolumeLevelScalar"):
        vol.SetMasterVolumeLevelScalar(level_percent / 100.0, None)
    else:
        vol.volume_percent = level_percent


def set_mute(device_id, muted):
    vol = _endpoint(device_id)
    vol.SetMute(1 if muted else 0, None)


def apply_remembered(device_id, volumes):
    if not device_id or not isinstance(volumes, dict):
        return
    level = volumes.get(device_id)
    if level is None:
        return
    try:
        set_volume(device_id, int(level))
    except Exception:
        pass
