import json
import platform
import sys

def main() -> None:
    payload = {
        "engine": "cryptoquant-python-ta",
        "status": "ready",
        "python_version": platform.python_version(),
        "executable": sys.executable,
    }
    print(json.dumps(payload))

if __name__ == "__main__":
    main()
