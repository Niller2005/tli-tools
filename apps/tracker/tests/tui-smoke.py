#!/usr/bin/env python3
"""Checks the tracker's screen in a real terminal.

The tracker is a full-screen program, so it is run in a pty: the script reads what it draws, sends
keys, and checks that the screen changes and that the program leaves the terminal as it was.

    python3 tests/tui-smoke.py [--log=<UE_game.log>]

It exits 0 when everything worked.
"""

import os
import pty
import re
import select
import signal
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
LOG = None
for arg in sys.argv[1:]:
    if arg.startswith("--log="):
        LOG = arg.split("=", 1)[1]

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def read_screen(fd, seconds=1.5):
    """Reads what the program draws for a while."""
    out = ""
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data.decode("utf8", "replace")
    return out


def strip(text):
    return ANSI.sub("", text)


def run(keys, log=None, wait=2.0):
    """Runs the tracker with the given keys; returns what it drew and how it ended."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
        cmd = ["bun", "src/tui.ts"]
        if log is not None:
            cmd.append(f"--log={log}")
        os.execvpe("bun", cmd, env)
    time.sleep(wait)
    screen = read_screen(fd, 2.0)
    for key in keys:
        os.write(fd, key.encode())
        time.sleep(0.4)
        screen += read_screen(fd, 1.0)
    os.write(fd, b"q")
    screen += read_screen(fd, 1.0)
    try:
        os.close(fd)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    return screen, os.waitstatus_to_exitcode(status)


def main():
    failures = []

    def check(name, problems):
        for problem in problems:
            failures.append(problem)
        print(f"{name}: {'yes' if not problems else 'no'}")

    screen, code = run([])
    text = strip(screen)
    problems = []
    for wanted in ["TLI Loot Tracker", "Current run", "Recent runs", "Bag", "Prices", "net worth"]:
        if wanted not in text:
            problems.append(f"the screen does not show {wanted!r}")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    if "\x1b[?1049l" not in screen:
        problems.append("the terminal was not put back")
    check("the screen has the panels and the terminal is put back", problems)

    screen, code = run(["\t", "\x1b[B", "\x1b[B", "\r", "\t", "\t"])
    text = strip(screen)
    problems = []
    if "Run #" not in text:
        problems.append("the detail of a run did not open")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the keys move and open a run", problems)

    screen, code = run(["t", "c", "p", "p", "?", "?"])
    text = strip(screen)
    problems = []
    if "Keys" not in text:
        problems.append("the help did not open")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the help opens and closes", problems)

    detail_log = os.path.join(tempfile.mkdtemp(prefix="tli-tracker-"), "UE_game.log")
    with open(detail_log, "w") as f:
        f.write("[2026.10.29-21.09.59:736][368]LogDataTable: Warning: UDataTable::FindRow: nothing.\n")
    screen, code = run([], log=detail_log)
    text = strip(screen)
    problems = []
    if "Enable Log" not in text:
        problems.append("the tracker did not say the game is not writing its own lines")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("a log without detail is said so", problems)

    screen, code = run([], log="/nowhere/at/all/UE_game.log")
    text = strip(screen)
    problems = []
    if "not there" not in text:
        problems.append("the tracker did not say the log is missing")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("a missing log is said so", problems)

    for failure in failures:
        print(f"FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
