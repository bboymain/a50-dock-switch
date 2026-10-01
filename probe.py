import json
import sys
import time

try:
    from hyperheadset import AstroA50Client
except Exception as e:
    print(f"IMPORT FAIL: {e}")
    sys.exit(1)


def main():
    try:
        client = AstroA50Client()
    except Exception as e:
        print(f"OPEN FAIL: {e}")
        sys.exit(2)

    print("Reading 5 snapshots (2s apart). Dock/undock the headset now to see it change.\n")
    for i in range(5):
        try:
            snap = client.getSnapshot(battery=True, headset=True, sidetone=False)
            print(f"[{i}] {json.dumps(snap, default=str)}")
        except Exception as e:
            print(f"[{i}] READ FAIL: {e}")
        time.sleep(2)
    print("\nDONE")


if __name__ == "__main__":
    main()
