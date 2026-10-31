#!/usr/bin/env python3
"""Checks the arcana app's screen in a real terminal.

The app is a full-screen program, so it is run in a pty: the script reads what it draws, sends
keys, and checks that the screen changes and that the program leaves the terminal as it was.

The app repaints only the cells that changed, so what comes out of the pty is a diff, not a
picture. The script therefore keeps a small screen of its own and plays the output on it, the way
a terminal would.

    python3 tests/tui-smoke.py [--log=<UE_game.log>] [--wait=30]

Without a log it uses the game's own log (UE_game.log under the Steam library), when it is
there. It exits 0 when everything worked.
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
REAL_LOG = "/mnt/games/SteamLibrary/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log"
# the game rotates its log; the session the player played is in the backup it leaves behind
BACKUP_LOG = "/mnt/games/SteamLibrary/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game-backup-2026.10.30-06.31.17.log"

LOG = None
WAIT = 12.0
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

# a log with the game's own lines: the board opens, a move is made, the board closes
SYNTHETIC = """[2026.10.30-01.32.11:444][162]TLLua: Display: [Game] S9Taro Run
[2026.10.30-01.32.36:100][142]TLShipping: Display: [Game] S9Taro HandleOrderAni Start Step=1 Type=CardDraw
[2026.10.30-01.32.36:110][142]TLLua: Display: [Game] 71390_S9HandCard Anim_Dachu Start
[2026.10.30-01.32.36:300][142]TLShipping: Display: [Game] S9Taro HandleOrderAni Start Step=2 Type=MoveTo
[2026.10.30-01.32.36:370][142]TLLua: Display: [Game] 71383_S9TileIcon Anim_Blue_Show02 Start
[2026.10.30-01.32.36:380][142]TLLua: Display: [Game] 71366_S9Reward Anim_Blue Start
[2026.10.30-01.32.36:900][142]TLShipping: Display: [Game] S9Taro HandleOrderAni All done
[2026.10.30-01.35.07:875][167]TLLua: Display: [Game] MsgMgr@:Show MsgValue = Start Fateful Contest with collected Chests of Destiny?
[2026.10.30-01.35.09:124][733]TLLua: Display: [Game] S9Challenge Run
[2026.10.30-01.35.09:163][918]TLLua: Display: [Game] S9Challenge Destory
[2026.10.30-01.35.10:000][167]TLLua: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 3100 19 203013
[2026.10.30-01.35.25:933][629]LogDataTable: Warning: UDataTable::FindRow : 'Play_Obj_S9_SMTL_BaoXiang_Open_01' requested row not in DataTable.
[2026.10.30-01.35.26:100][290]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems start
[2026.10.30-01.35.26:101][290]TLLua: Display: [Game] ItemChange@ Add Id=3902_b01ee6a0-d402-11f1-9c35-000000000079 BagNum=1 in PageId=100 SlotId=38
[2026.10.30-01.35.26:102][290]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems end
[2026.10.30-01.41.55:700][161]TLLua: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 1071101 3 4713
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


def run(keys, log=None, wait=None, state=None, no_color=False):
    """Runs the app with the given keys; returns the screens it drew and how it ended."""
    home = state or tempfile.mkdtemp(prefix="tli-arcana-")
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS=str(COLS), LINES=str(ROWS), XDG_DATA_HOME=home)
        env.pop("NO_COLOR", None)
        cmd = ["bun", "src/tui.ts"]
        if log is not None:
            cmd.append(f"--log={log}")
        if no_color:
            cmd.append("--no-color")
        os.execvpe("bun", cmd, env)
    # A new pty has no size; the app needs to know how big the terminal is.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    time.sleep(wait if wait is not None else WAIT)
    screen = Screen()
    raw = b""
    raw += read_screen(fd, 2.0)
    screen.feed(raw)
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


def main():
    failures = []

    def check(name, problems):
        for problem in problems:
            failures.append(problem)
        print(f"{name}: {'yes' if not problems else 'no'}")

    # the synthetic log: the panels, the history, the keys, and the terminal put back
    with tempfile.TemporaryDirectory(prefix="tli-arcana-log-") as work:
        log = os.path.join(work, "UE_game.log")
        with open(log, "w") as f:
            f.write(SYNTHETIC)

        shots, raw, code = run([], log=log, wait=3.0)
        text = shots[-1]
        problems = []
        for wanted in ["Arcana", "Tarot Path", "Now", "History", "#1", "1 chests"]:
            if wanted not in text:
                problems.append(f"the screen does not show {wanted!r}")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        if b"\x1b[?1049l" not in raw:
            problems.append("the alternate screen was not left")
        if b"\x1b[?25h" not in raw:
            problems.append("the cursor was not shown again")
        check("the screen has the panels and the terminal is put back", problems)

        shots, raw, code = run([], log=log, wait=3.0, no_color=True)
        problems = []
        styles = set(re.findall(r"\x1b\[[0-9;]*m", raw.decode("utf8", "replace")))
        for style in styles:
            if style not in ALLOWED_SGR:
                problems.append(f"the app drew the style {style!r} with --no-color")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the no-colour mode has no colours", problems)

        shots, raw, code = run(["\t", "\x1b[B", "\x1b[B", "\r", "\t", "\t"], log=log, wait=3.0)
        problems = []
        if "Lifetime totals" not in shots[1]:
            problems.append("the totals panel did not open")
        if "Session #1" not in shots[4]:
            problems.append("the detail of a visit did not open")
        if "Fateful Contest" not in shots[4]:
            problems.append("the contest of the visit was not shown")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the keys move, change panel and open a visit", problems)

        shots, raw, code = run(["t", "?", "?"], log=log, wait=3.0)
        problems = []
        if "quit" not in shots[2]:
            problems.append("the help did not open")
        if "the trade tax is off" not in shots[1]:
            problems.append("the tax key did nothing")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the help opens and closes, and the tax can be turned off", problems)

        # a log without the game's own lines
        with open(log, "w") as f:
            f.write("[2026.10.29-21.09.59:736][368]LogDataTable: Warning: UDataTable::FindRow: nothing.\n")
        shots, raw, code = run([], log=log, wait=3.0)
        text = shots[-1]
        problems = []
        if "Enable Log" not in text:
            problems.append("the app did not say the game is not writing its own lines")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("a log without detail is said so", problems)

    # a log that is not there
    shots, raw, code = run([], log="/nowhere/at/all/UE_game.log", wait=3.0)
    text = shots[-1]
    problems = []
    if "not there" not in text:
        problems.append("the app did not say the log is missing")
    if code != 0:
        problems.append(f"the app ended with {code}, not 0")
    check("a missing log is said so", problems)

    # the real log, when it is there: the game's own log, and the one it rotated away
    real = LOG if LOG is not None else (REAL_LOG if os.path.isfile(REAL_LOG) else None)
    if real is None:
        print("the real log: skipped (it is not there)")
    else:
        shots, raw, code = run([], log=real, wait=WAIT)
        text = shots[-1]
        problems = []
        for wanted in ["Arcana", "Tarot Path", "History"]:
            if wanted not in text:
                problems.append(f"the screen does not show {wanted!r}")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        if b"\x1b[?1049l" not in raw:
            problems.append("the alternate screen was not left")
        check("the real log is read and shown", problems)

        shots, raw, code = run(["\t", "\r", "\x1b"], log=real, wait=WAIT)
        problems = []
        if "Lifetime totals" not in shots[1]:
            problems.append("the totals panel did not open")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the real log: the keys work", problems)

    # the log the game rotated away, which holds the visit that was played
    if LOG is None and os.path.isfile(BACKUP_LOG):
        shots, raw, code = run([], log=BACKUP_LOG, wait=WAIT)
        text = shots[-1]
        problems = []
        for wanted in ["Arcana", "Tarot Path: closed", "History", "#1", "7 chests"]:
            if wanted not in text:
                problems.append(f"the screen does not show {wanted!r}")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        if b"\x1b[?1049l" not in raw:
            problems.append("the alternate screen was not left")
        check("the rotated log with the visit in it is read and shown", problems)

        shots, raw, code = run(["\r"], log=BACKUP_LOG, wait=WAIT)
        problems = []
        if "Session #1" not in shots[1]:
            problems.append("the detail of the visit did not open")
        if "chests opened" not in shots[1]:
            problems.append("the contest of the visit was not shown")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the rotated log: the detail opens", problems)

        # the moves of a long visit are below the fold: they are reached by scrolling
        shots, raw, code = run(["\r", "\x1b[6~", "\x1b[6~", "\x1b[6~"], log=BACKUP_LOG, wait=WAIT)
        problems = []
        if "Moves" not in shots[-1]:
            problems.append("the moves of the visit were not reachable by scrolling")
        if code != 0:
            problems.append(f"the app ended with {code}, not 0")
        check("the rotated log: the moves can be scrolled to", problems)

    for failure in failures:
        print(f"FAILED: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
