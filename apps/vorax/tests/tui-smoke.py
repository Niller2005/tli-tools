#!/usr/bin/env python3
"""Checks the Vorax helper's screen in a real terminal.

The helper is a full-screen program, so it is run in a pty: the script reads what it draws, sends
keys, and checks that the screen changes and that the program leaves the terminal as it was.

    python3 tests/tui-smoke.py

It exits 0 when everything worked.
"""

import base64
import fcntl
import os
import pty
import re
import select
import struct
import sys
import tempfile
import termios
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")

# A picture of one pixel: the capture command always writes the same one, so the screen does not
# change and the helper keeps the note about the log.
ONE_PIXEL_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

ANSI = re.compile(r"\x1b\[[0-?]*[a-zA-Z]")
# The styles that are left when the colours are off: OpenTUI always resets, asks for the
# terminal's own colours and paints its own default white.
ALLOWED_SGR = {"\x1b[0m", "\x1b[39m", "\x1b[49m", "\x1b[38;2;255;255;255m"}


def read_screen(fd, seconds=1.5):
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
    return out


def strip(data):
    """The text of what the program drew, without the escape sequences."""
    return ANSI.sub("", data.decode("utf8", "replace"))


def run(keys, extra=None, wait=2.0, no_color=False, after=None):
    """Runs the helper with the given keys; returns what it drew and how it ended."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
        env.pop("NO_COLOR", None)
        cmd = ["bun", "scripts/tui.ts"]
        if extra:
            cmd += extra
        if no_color:
            cmd.append("--no-color")
        os.execvpe("bun", cmd, env)
    # A new pty has no size; the helper needs to know how big the terminal is.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    screen = read_screen(fd, wait)
    if after is not None:
        after()
        screen += read_screen(fd, 2.0)
    for key in keys:
        os.write(fd, key.encode())
        time.sleep(0.4)
        screen += read_screen(fd, 1.0)
    # A resize makes the program draw the whole screen again, so the text of the screen after the
    # keys can be read: otherwise only the cells that changed are drawn.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 38, 118, 0, 0))
    time.sleep(0.5)
    screen += read_screen(fd, 1.5)
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
    for wanted in ["Vorax Helper", "Next move", "target 925,000", "r read now", "q quit"]:
        if wanted not in text:
            problems.append(f"the screen does not show {wanted!r}")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    if b"\x1b[?1049l" not in screen:
        problems.append("the alternate screen was not left")
    if b"\x1b[?25h" not in screen:
        problems.append("the cursor was not shown again")
    check("the screen comes up and the terminal is put back", problems)

    screen, code = run([], no_color=True)
    problems = []
    styles = set(re.findall(r"\x1b\[[0-9;]*m", screen.decode("utf8", "replace")))
    for style in styles:
        if style not in ALLOWED_SGR:
            problems.append(f"the helper drew the style {style!r} with --no-color")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    check("the no-colour mode has no colours", problems)

    screen, code = run(["t", "d"])
    text = strip(screen)
    problems = []
    if "target 1,120,000" not in text:
        problems.append("the target did not change")
    if "deep check off" not in text:
        problems.append("the deep check did not turn off")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    check("the keys change the target and the deep check", problems)

    screen, code = run([], extra=["--log=/nowhere/at/all/UE_game.log"])
    text = strip(screen)
    problems = []
    if "not written yet" not in text:
        problems.append("the helper did not say the log is missing")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    check("a missing log is said so", problems)

    screen, code = run([], extra=["--target=700000", "--no-deep"])
    text = strip(screen)
    problems = []
    if "target 700,000" not in text:
        problems.append("the target from the command line was not used")
    if "deep check off" not in text:
        problems.append("--no-deep did not turn the deep check off")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    check("the options on the command line are used", problems)

    # A log that only grows, with lines the game does not write itself: the helper has to say so.
    log = os.path.join(tempfile.mkdtemp(prefix="tli-vorax-"), "UE_game.log")
    with open(log, "w") as f:
        f.write("[2026.10.31-00.00.00:000][1]LogInit: the game starts\n")
    shot = os.path.join(tempfile.mkdtemp(prefix="tli-vorax-"), "shot.png")
    with open(shot, "wb") as f:
        f.write(base64.b64decode(ONE_PIXEL_PNG))

    def grow():
        with open(log, "a") as f:
            for i in range(500):
                f.write(f"[2026.10.31-00.00.00:000][1]LogInit: a line {i}\n")

    screen, code = run(
        [],
        extra=[f"--log={log}", f"--capture-cmd=cp {shot} {{out}}"],
        after=grow,
    )
    text = strip(screen)
    problems = []
    if "no detail lines" not in text:
        problems.append("the helper did not say the game log has no detail lines")
    if code != 0:
        problems.append(f"the helper ended with {code}, not 0")
    check("a log without detail is said so", problems)

    for failure in failures:
        print(f"FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
