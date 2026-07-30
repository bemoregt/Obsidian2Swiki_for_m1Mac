import sys
import json
import io
import contextlib
import traceback

# A long-running "kernel": reads one JSON request per line from stdin, execs
# its code in a namespace that persists across requests (exactly like a
# real Jupyter kernel's global scope), and writes one JSON response per line
# to stdout. Line-delimited JSON in both directions means multi-line code
# and multi-line output both survive the trip intact (json encoding escapes
# embedded newlines), so a single readline() on either side is always
# exactly one full message.

glb = {"__name__": "__main__"}

for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue
    try:
        req = json.loads(raw_line)
    except Exception:
        continue

    code = req.get("code", "")
    outputs = []
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    ok = True

    try:
        with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
            exec(compile(code, "<cell>", "exec"), glb)
    except Exception:
        exc_type, exc_value, _ = sys.exc_info()
        outputs.append(
            {
                "output_type": "error",
                "ename": exc_type.__name__,
                "evalue": str(exc_value),
                "traceback": traceback.format_exc().splitlines(),
            }
        )
        ok = False

    out_text = stdout_buf.getvalue()
    if out_text:
        outputs.append({"output_type": "stream", "name": "stdout", "text": out_text.splitlines(keepends=True)})
    err_text = stderr_buf.getvalue()
    if err_text:
        outputs.append({"output_type": "stream", "name": "stderr", "text": err_text.splitlines(keepends=True)})

    sys.stdout.write(json.dumps({"ok": ok, "outputs": outputs}) + "\n")
    sys.stdout.flush()
