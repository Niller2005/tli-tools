#!/usr/bin/env python3
"""Checks the tracker's screen in a real terminal.

The tracker is a full-screen program, so it is run in a pty: the script reads what it draws, sends
keys, and checks that the screen changes and that the program leaves the terminal as it was.

The app repaints only the cells that changed, so what comes out of the pty is a diff, not a
picture. The script therefore keeps a small screen of its own and plays the output on it, the way
a terminal would.

    python3 tests/tui-smoke.py [--log=<UE_game.log>]

It exits 0 when everything worked.
"""

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

LOG = None
WAIT = 2.0
COLS = 120
ROWS = 40
for arg in sys.argv[1:]:
    if arg.startswith("--log="):
        LOG = arg.split("=", 1)[1]
    elif arg.startswith("--wait="):
        WAIT = float(arg.split("=", 1)[1])

# The styles that are left when the colours are off: OpenTUI always resets, asks for the
# terminal's own colours and paints its own default white.
ALLOWED_SGR = {"\x1b[0m", "\x1b[39m", "\x1b[49m", "\x1b[38;2;255;255;255m"}

# a log with one run in it, so the keys have something to open
SYNTHETIC = """[2026.10.30-12.00.01:000][676]TLLua: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 1071008 3 4708
[2026.10.30-12.05.00:000][676]TLLua: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 1071008 0 0
"""


class Screen:
    """A terminal screen of its own: it plays the output of the app on it."""

    def __init__(self, cols=COLS, rows=ROWS):
        self.cols = cols
        self.rows = rows
        self.clear()

    def clear(self):
        self.grid = [[" "] * self.cols for _ in range(self.rows)]
        self.row = 0
        self.col = 0

    def put(self, char):
        if 0 <= self.row < self.rows and 0 <= self.col < self.cols:
            self.grid[self.row][self.col] = char
        self.col += 1

    def erase_line(self):
        if 0 <= self.row < self.rows:
            for col in range(self.col, self.cols):
                self.grid[self.row][col] = " "

    def erase_below(self):
        if 0 <= self.row < self.rows:
            self.erase_line()
            for row in range(self.row + 1, self.rows):
                self.grid[row] = [" "] * self.cols

    def csi(self, params, final):
        """A control sequence: the ones that move the cursor or erase are acted on."""
        if final in "Hf":
            nums = [int(p) if p else 1 for p in params.split(";")] if params else [1, 1]
            row = nums[0] - 1
            col = nums[1] - 1 if len(nums) > 1 else 0
            self.row = max(0, min(self.rows - 1, row))
            self.col = max(0, min(self.cols - 1, col))
            return
        if final == "J":
            mode = params or "0"
            if mode in ("2", "3"):
                self.grid = [[" "] * self.cols for _ in range(self.rows)]
            else:
                self.erase_below()
            return
        if final == "K":
            self.erase_line()
            return
        if final == "A":
            self.row = max(0, self.row - int(params or 1))
            return
        if final == "B":
            self.row = min(self.rows - 1, self.row + int(params or 1))
            return
        if final == "C":
            self.col = min(self.cols - 1, self.col + int(params or 1))
            return
        if final == "D":
            self.col = max(0, self.col - int(params or 1))
            return
        # everything else (the colours, the modes, the cursor) does not move the text

    def feed(self, data):
        """Plays what the program wrote on the screen."""
        text = data.decode("utf8", "replace")
        index = 0
        length = len(text)
        while index < length:
            char = text[index]
            if char == "\x1b":
                if index + 1 < length and text[index + 1] == "[":
                    end = index + 2
                    while end < length and not ("@" <= text[end] <= "~"):
                        end += 1
                    if end >= length:
                        break
                    self.csi(text[index + 2 : end], text[end])
                    index = end + 1
                    continue
                index += 2
                continue
            if char == "\r":
                self.col = 0
                index += 1
                continue
            if char == "\n":
                self.row = min(self.rows - 1, self.row + 1)
                index += 1
                continue
            self.put(char)
            index += 1

    def text(self):
        """The screen as it is now."""
        return "\n".join("".join(row).rstrip() for row in self.grid)


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


def run(keys, log=None, wait=None, no_color=False):
    """Runs the tracker with the given keys; returns the screens it drew and how it ended."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        # --reset forgets the saved state and the tracker writes its own on the way out: that must not be the
        # player's database, so the data directory is a temporary one
        env = dict(
            os.environ,
            TERM="xterm-256color",
            COLUMNS=str(COLS),
            LINES=str(ROWS),
            XDG_DATA_HOME=tempfile.mkdtemp(prefix="tli-tracker-data-"),
        )
        env.pop("NO_COLOR", None)
        # The test runs where the player is: no picture of the game, no niri, no grim.
        env["TLI_NO_CAPTURE"] = "1"
        cmd = ["bun", "src/tui.ts", "--reset"]
        if log is not None:
            cmd.append(f"--log={log}")
        if no_color:
            cmd.append("--no-color")
        os.execvpe("bun", cmd, env)
    # A new pty has no size; the tracker needs to know how big the terminal is.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    time.sleep(wait if wait is not None else WAIT)
    screen = Screen()
    raw = b""
    piece = read_screen(fd, 2.0)
    raw += piece
    screen.feed(piece)
    shots = [screen.text()]
    for key in keys:
        os.write(fd, key.encode())
        time.sleep(0.4)
        piece = read_screen(fd, 1.0)
        raw += piece
        screen.feed(piece)
        shots.append(screen.text())
    os.write(fd, b"q")
    piece = read_screen(fd, 1.0)
    raw += piece
    screen.feed(piece)
    shots.append(screen.text())
    try:
        os.close(fd)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    return shots, raw, os.waitstatus_to_exitcode(status)


def run_log():
    """A small log with one run in it, so the keys have something to open."""
    path = os.path.join(tempfile.mkdtemp(prefix="tli-tracker-"), "UE_game.log")
    with open(path, "w") as f:
        f.write(SYNTHETIC)
    return path


def main():
    failures = []

    def check(name, problems):
        for problem in problems:
            failures.append(problem)
        print(f"{name}: {'yes' if not problems else 'no'}")

    shots, raw, code = run([])
    text = shots[-1]
    problems = []
    for wanted in ["TLI Loot Tracker", "Current run", "Recent runs", "Bag", "Prices", "net worth"]:
        if wanted not in text:
            problems.append(f"the screen does not show {wanted!r}")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    if b"\x1b[?1049l" not in raw:
        problems.append("the alternate screen was not left")
    if b"\x1b[?25h" not in raw:
        problems.append("the cursor was not shown again")
    check("the screen has the panels and the terminal is put back", problems)

    shots, raw, code = run([], no_color=True)
    problems = []
    styles = set(re.findall(r"\x1b\[[0-9;]*m", raw.decode("utf8", "replace")))
    for style in styles:
        if style not in ALLOWED_SGR:
            problems.append(f"the tracker drew the style {style!r} with --no-color")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the no-colour mode has no colours", problems)

    shots, raw, code = run(["\x1b[B", "\r"], log=run_log())
    text = shots[-1]
    problems = []
    if "Run #" not in text:
        problems.append("the detail of a run did not open")
    if "Current run" in text:
        problems.append("the panel behind the detail shows through")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the keys move and open a run", problems)

    shots, raw, code = run(["?"])
    text = shots[1]
    problems = []
    if "Keys" not in text:
        problems.append("the help did not open")
    if "Current run" in text:
        problems.append("the panel behind the help shows through")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the help opens and covers the panels behind it", problems)

    shots, raw, code = run(["e", "4", "2", "\r"])
    text = shots[1]
    problems = []
    if "price" not in text:
        problems.append("the price was not asked for")
    if code != 0:
        problems.append(f"the tracker ended with {code}, not 0")
    check("the price can be typed in", problems)

    with tempfile.TemporaryDirectory(prefix="tli-tracker-log-") as work:
        log = os.path.join(work, "UE_game.log")
        with open(log, "w") as f:
            f.write("[2026.10.29-21.09.59:736][368]LogDataTable: Warning: UDataTable::FindRow: nothing.\n")
        shots, raw, code = run([], log=log)
        text = shots[-1]
        problems = []
        if "Enable Log" not in text:
            problems.append("the tracker did not say the game is not writing its own lines")
        if code != 0:
            problems.append(f"the tracker ended with {code}, not 0")
        check("a log without detail is said so", problems)

    shots, raw, code = run([], log="/nowhere/at/all/UE_game.log")
    text = shots[-1]
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
