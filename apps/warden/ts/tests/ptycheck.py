#!/usr/bin/env python3
"""Warden in a pty, with a saved frame as the game window.

The script runs the TUI with `--capture-cmd`, asks for a read with the `r`
key, and measures how long the window waits for the program: the window is
redrawn thirty times a second, so the longest gap between two drawings is
how long the program was busy with something else.
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
FRAME = os.path.join(HERE, "..", "..", "tests", "fixtures", "board-text.png")
ANSI = re.compile(r"\x1b\[[0-?]*[a-zA-Z]")


def read_screen(fd, seconds, gaps=None):
    """Reads what the program draws for a while."""
    out = b""
    end = time.time() + seconds
    last = time.time()
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        now = time.time()
        if gaps is not None:
            gaps.append(now - last)
            last = now
        out += data
    return out


def strip(data):
    return ANSI.sub("", data.decode("utf8", "replace"))


def main():
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
        env.pop("TLI_NO_CAPTURE", None)
        env.pop("NO_COLOR", None)
        cmd = ["bun", "ts/src/bin/warden-tui.ts", "--no-log", "--capture-cmd", f"cp {FRAME} {{out}}"]
        os.execvpe("bun", cmd, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    # The gaps between the drawings, from the first read on: the window is
    # redrawn thirty times a second, so the longest gap is how long the
    # program was busy with something else.
    gaps = []
    seen = strip(read_screen(fd, 4.0, gaps))
    started = time.time()
    os.write(fd, b"r")
    while time.time() - started < 10.0:
        seen += strip(read_screen(fd, 0.5, gaps))
        if "Check cell" in seen:
            break
    print(f"the board was read {time.time() - started:.3f} s after the key press")
    read_screen(fd, 4.0, gaps)
    if gaps:
        print(f"the window waited {max(gaps) * 1000:.0f} ms for the program at its longest")
        print(f"the drawings came {len(gaps)} times in {sum(gaps):.1f} s")
    os.write(fd, b"q")
    read_screen(fd, 3.0)
    try:
        os.close(fd)
    except OSError:
        pass
    os.waitpid(pid, 0)


if __name__ == "__main__":
    sys.exit(main())
