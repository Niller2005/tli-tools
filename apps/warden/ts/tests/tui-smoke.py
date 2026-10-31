#!/usr/bin/env python3
"""Checks Warden's screen in a real terminal.

Warden is a full-screen program, so it is run in a pty: the script reads what it draws, sends
keys, and checks that the program leaves the terminal as it was.

    python3 tests/tui-smoke.py

It exits 0 when everything worked.
"""

import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "..")

ANSI = re.compile(r"\x1b\[[0-?]*[a-zA-Z]")
# The styles that are left when the colours are off: OpenTUI always resets, asks for the
# terminal's own colours and paints its own default white.
ALLOWED_SGR = {"\x1b[0m", "\x1b[39m", "\x1b[49m", "\x1b[38;2;255;255;255m"}


def read_screen(fd, seconds=1.5, first=None):
    """Reads what the program draws for a while."""
    out = b""
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
        out += data
        if first is not None and first[0] is None:
            first[0] = time.time()
    return out


def strip(data):
    """The text of what the program drew, without the escape sequences."""
    return ANSI.sub("", data.decode("utf8", "replace"))


def run(keys, wait=2.0, no_color=False, no_log=True):
    """Runs Warden with the given keys; returns what it drew and how it ended."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
        env.pop("NO_COLOR", None)
        # The test runs where the player is: the capture is off, so niri and grim
        # are never run.
        env["TLI_NO_CAPTURE"] = "1"
        cmd = ["bun", "ts/src/bin/warden-tui.ts"]
        if no_log:
            cmd.append("--no-log")
        if no_color:
            cmd.append("--no-color")
        os.execvpe("bun", cmd, env)
    # A new pty has no size; the screen needs to know how big the terminal is.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    started = time.time()
    seen = [None]
    screen = read_screen(fd, wait, seen)
    first = (seen[0] - started) if seen[0] is not None else 0.0
    for key in keys:
        os.write(fd, key.encode())
        time.sleep(0.4)
        screen += read_screen(fd, 1.0)
    os.write(fd, b"q")
    screen += read_screen(fd, 3.0)
    try:
        os.close(fd)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    return screen, os.waitstatus_to_exitcode(status), first


def main():
    failures = []

    def check(name, problems):
        for problem in problems:
            failures.append(problem)
        print(f"{name}: {'yes' if not problems else 'no'}")

    screen, code, first = run([])
    text = strip(screen)
    problems = []
    for wanted in ["Warden", "Tartarus prison board", "game:", "r read now", "q quit"]:
        if wanted not in text:
            problems.append(f"the screen does not show {wanted!r}")
    if code != 0:
        problems.append(f"Warden ended with {code}, not 0")
    if b"\x1b[?1049l" not in screen:
        problems.append("the alternate screen was not left")
    if b"\x1b[?25h" not in screen:
        problems.append("the cursor was not shown again")
    print(f"the screen came up in {first * 1000:.0f} ms")
    check("the screen has the header and the terminal is put back", problems)

    screen, code, _ = run([], no_color=True)
    problems = []
    styles = set(re.findall(r"\x1b\[[0-9;]*m", screen.decode("utf8", "replace")))
    for style in styles:
        if style not in ALLOWED_SGR:
            problems.append(f"Warden drew the style {style!r} with --no-color")
    if code != 0:
        problems.append(f"Warden ended with {code}, not 0")
    check("the no-colour mode has no colours", problems)

    screen, code, _ = run(["r"])
    problems = []
    if code != 0:
        problems.append(f"Warden ended with {code}, not 0")
    check("the read-now key is handled", problems)

    for failure in failures:
        print(f"FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
