#!/usr/bin/env python3
"""Checks the dashboard's screen in a real terminal.

The dashboard is a full-screen program, so it is run in a pty: the script reads what it draws,
sends keys, and checks that the tools are listed, that the status badges are there, that a child
TUI can take the terminal and hand it back, and that the program leaves the terminal as it was.

    python3 tests/tui-smoke.py [--log=<UE_game.log>]

Without a log it uses the game's own log, when it is there. It exits 0 when everything worked.
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

LOG = None
for arg in sys.argv[1:]:
    if arg.startswith("--log="):
        LOG = arg.split("=", 1)[1]

ANSI = re.compile(r"\x1b\[[0-?]*[a-zA-Z]")
# The styles that are left when the colours are off: OpenTUI always resets, asks for the
# terminal's own colours and paints its own default white.
ALLOWED_SGR = {"\x1b[0m", "\x1b[39m", "\x1b[49m", "\x1b[38;2;255;255;255m"}

# a log with the game's own lines: the Tarot Path opens and closes
SYNTHETIC = """[2026.10.30-01.32.11:444][162]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Taro , PageRunState = Run
[2026.10.30-01.35.09:106][733]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Taro , PageRunState = Hide
[2026.10.30-01.35.09:124][733]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Challenge , PageRunState = Run
[2026.10.30-01.35.09:163][733]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Challenge , PageRunState = Destory
"""
OPEN = """[2026.10.30-01.32.11:444][162]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Taro , PageRunState = Run
"""
HIDE = """[2026.10.30-01.35.09:106][733]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange PageName = S9Taro , PageRunState = Hide
"""
NO_DETAIL = """[2026.10.30-12.00.01:000][676]LogDataTable: Warning: UDataTable::FindRow: nothing.
"""


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


def terminal_attributes(fd):
    """The terminal settings, when they can be read from the pty."""
    try:
        return termios.tcgetattr(fd)
    except OSError:
        return None


def spawn(log=None, no_color=False, home=None):
    """Starts the dashboard in a pty."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(APP)
        env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="40")
        env.pop("NO_COLOR", None)
        # The test runs where the player is: the tools it starts take no picture of
        # the game, so niri and grim are never run.
        env["TLI_NO_CAPTURE"] = "1"
        if home is not None:
            env["HOME"] = home
        cmd = ["bun", "src/main.ts"]
        if log is not None:
            cmd.append(f"--log={log}")
        if no_color:
            cmd.append("--no-color")
        # A new pty has no size; OpenTUI needs to know how big the terminal is.
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        os.execvpe("bun", cmd, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    return pid, fd


def finish(pid, fd):
    """Waits for the dashboard and closes the pty."""
    try:
        os.close(fd)
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


def run(keys, log=None, wait=2.5, no_color=False, home=None, after_start=None):
    """Runs the dashboard with the given keys; returns what it drew and how it ended."""
    pid, fd = spawn(log=log, no_color=no_color, home=home)
    before = terminal_attributes(fd)
    screen = read_screen(fd, wait)
    if after_start is not None:
        after_start()
        screen += read_screen(fd, 3.0)
    for key in keys:
        os.write(fd, key.encode())
        time.sleep(0.4)
        screen += read_screen(fd, 1.0)
    os.write(fd, b"q")
    screen += read_screen(fd, 1.0)
    after = terminal_attributes(fd)
    code = finish(pid, fd)
    restored = before is None or after is None or before == after
    return screen, code, restored


def run_child(log, home):
    """Starts the tracker from the dashboard, leaves it, and comes back to the dashboard."""
    pid, fd = spawn(log=log, home=home)
    before = terminal_attributes(fd)
    screen = read_screen(fd, 2.5)

    # The third tool is the tracker.
    os.write(fd, b"\x1b[B")
    time.sleep(0.4)
    screen += read_screen(fd, 0.8)
    os.write(fd, b"\x1b[B")
    time.sleep(0.4)
    screen += read_screen(fd, 0.8)
    os.write(fd, b"\r")
    time.sleep(0.5)
    screen += read_screen(fd, 5.0)

    # The tracker quits, and the dashboard is made again.
    os.write(fd, b"q")
    time.sleep(0.5)
    screen += read_screen(fd, 3.0)
    # The dashboard quits for good.
    os.write(fd, b"q")
    screen += read_screen(fd, 1.5)

    after = terminal_attributes(fd)
    code = finish(pid, fd)
    restored = before is None or after is None or before == after
    return screen, code, restored


def steam_home(work, contents):
    """Makes a small Steam library with the game's log in it."""
    home = os.path.join(work, "home")
    steam = os.path.join(home, ".steam", "steam", "steamapps")
    library = os.path.join(home, "library")
    steamapps = os.path.join(library, "steamapps")
    common = os.path.join(steamapps, "common", "Torchlight Infinite")
    log_dir = os.path.join(common, "UE_game", "TorchLight", "Saved", "Logs")
    os.makedirs(steam, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(steam, "libraryfolders.vdf"), "w") as f:
        f.write('"libraryfolders"\n{\n  "1" {\n    "path" "%s"\n  }\n}\n' % library)
    with open(os.path.join(steamapps, "appmanifest_1974050.acf"), "w") as f:
        f.write('"AppState"\n{\n  "appid" "1974050"\n  "installdir" "Torchlight Infinite"\n}\n')
    game_log = os.path.join(log_dir, "UE_game.log")
    with open(game_log, "w") as f:
        f.write(contents)
    return home, game_log


def main():
    failures = []

    def check(name, problems):
        for problem in problems:
            failures.append(problem)
        print(f"{name}: {'yes' if not problems else 'no'}")

    with tempfile.TemporaryDirectory(prefix="tli-dashboard-") as work:
        log = os.path.join(work, "UE_game.log")
        with open(log, "w") as f:
            f.write(SYNTHETIC)

        screen, code, restored = run([], log=log)
        text = strip(screen)
        problems = []
        for wanted in ["Torchlight: Infinite tools", "Vorax Helper", "Tartarus Warden", "Loot Tracker", "Arcana"]:
            if wanted not in text:
                problems.append(f"the screen does not show {wanted!r}")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        if b"\x1b[?1049l" not in screen:
            problems.append("the terminal was not put back")
        if b"\x1b[?25h" not in screen:
            problems.append("the cursor was not shown again")
        if not restored:
            problems.append("the terminal settings were not put back")
        check("the tools are listed and the terminal is put back", problems)

        screen, code, _ = run([], log=log, wait=4.0)
        text = strip(screen)
        problems = []
        if "○ closed" not in text:
            problems.append("the Arcana tool has no closed badge")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("the badges are shown", problems)

        # The description of the tool under the pointer is shown.
        screen, code, _ = run(["\x1b[B", "\x1b[B", "\x1b[B"], log=log)
        text = strip(screen)
        problems = []
        if "Tarot Path" not in text:
            problems.append("the description of the Arcana tool was not shown")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("moving the pointer shows the tool's description", problems)

        # A badge changes when the log changes, without pressing a key.
        changing = os.path.join(work, "changing.log")
        with open(changing, "w") as f:
            f.write(OPEN)
        screen, code, _ = run([], log=changing, wait=1.5, after_start=lambda: append_to(changing, HIDE))
        text = strip(screen)
        problems = []
        if "○ closed" not in text:
            problems.append("the badge did not refresh when the log changed")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("the badges refresh while the dashboard is up", problems)

        # The log itself can be missing, or have none of the game's own lines.
        screen, code, _ = run([], log=os.path.join(work, "nowhere.log"))
        text = strip(screen)
        problems = []
        if "log: missing" not in text:
            problems.append("the missing log was not said")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("a missing log is said so", problems)

        no_detail = os.path.join(work, "no-detail.log")
        with open(no_detail, "w") as f:
            f.write(NO_DETAIL)
        screen, code, _ = run([], log=no_detail)
        text = strip(screen)
        problems = []
        if "log: enable log" not in text:
            problems.append("the log without detail was not said")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("a log without detail is said so", problems)

        # Colours can be turned off.
        screen, code, _ = run([], log=log, no_color=True)
        problems = []
        styles = set(re.findall(r"\x1b\[[0-9;]*m", screen.decode("utf8", "replace")))
        for style in styles:
            if style not in ALLOWED_SGR:
                problems.append(f"the dashboard drew the style {style!r} with --no-color")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("the no-colour mode has no colours", problems)

        # The renderer gives the terminal to the tracker and is made again when the tracker leaves.
        home, _ = steam_home(work, SYNTHETIC)
        screen, code, restored = run_child(log, home)
        text = strip(screen)
        problems = []
        tracker_at = text.find("TLI Loot Tracker")
        if tracker_at < 0:
            problems.append("the tracker did not start")
        elif text.find("Torchlight: Infinite tools", tracker_at) < 0:
            problems.append("the dashboard did not come back after the tracker left")
        dashboard_exit = screen.find(b"\x1b[?1049l")
        tracker_title = screen.find(b"TLI Loot Tracker")
        if dashboard_exit < 0:
            problems.append("the dashboard's alternate screen was not left for the tracker")
        elif tracker_title >= 0 and dashboard_exit > tracker_title:
            problems.append("the dashboard's renderer was not destroyed before the tracker started")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        if not restored:
            problems.append("the terminal settings were not put back after the tracker")
        check("a child TUI takes the terminal and gives it back", problems)

    # The game's own log, when it is there.
    real = LOG if LOG is not None else (REAL_LOG if os.path.isfile(REAL_LOG) else None)
    if real is None:
        print("the real log: skipped (it is not there)")
    else:
        screen, code, _ = run([], log=real, wait=4.0)
        text = strip(screen)
        problems = []
        if "Arcana" not in text:
            problems.append("the Arcana tool is not listed")
        if not any(badge in text for badge in ["● open", "○ closed", "? unknown"]):
            problems.append("the badge is not shown")
        if code != 0:
            problems.append(f"the dashboard ended with {code}, not 0")
        check("the real log: the tool and its badge are shown", problems)

    for failure in failures:
        print(f"FAILED: {failure}")
    return 1 if failures else 0


def append_to(path, text):
    """Adds a line to the log."""
    with open(path, "a") as f:
        f.write(text)


if __name__ == "__main__":
    sys.exit(main())
