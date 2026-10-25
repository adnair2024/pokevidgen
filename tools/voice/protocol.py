"""One JSON request on stdin, one JSON response on stdout. Anything else goes to stderr."""
import json
import sys
import traceback


def run(handler):
    try:
        request = json.load(sys.stdin)
        response = handler(request)
        json.dump(response, sys.stdout)
        sys.stdout.write("\n")
    except Exception as err:  # noqa: BLE001 - the caller needs the message, whatever it is
        traceback.print_exc(file=sys.stderr)
        json.dump({"error": f"{type(err).__name__}: {err}"}, sys.stdout)
        sys.stdout.write("\n")
        sys.exit(1)
