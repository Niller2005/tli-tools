#!/usr/bin/env python3
"""The overlay: the tools' cards drawn over the game on a wlr-layer-shell surface.

It only draws. It reads the cards the tools write (see src/index.ts), never the game, and it takes no
input: the surface has an empty input region and asks for no keyboard, so every click and key goes to
the game. It also writes where its cards are (rects.json) so the capture can black them out of the
pictures the tools read.

Needs GTK 4, gtk4-layer-shell and PyGObject. libgtk4-layer-shell has to be loaded before libwayland,
so run it through scripts/start.ts (which sets LD_PRELOAD) or set LD_PRELOAD yourself.
"""
import argparse
import json
import os
import re
import subprocess
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("Gtk4LayerShell", "1.0")
import cairo  # noqa: E402
from gi.repository import Gdk, GLib, Gtk  # noqa: E402
from gi.repository import Gtk4LayerShell as LS  # noqa: E402

TONES = {
    "dim": "#8b8fa3", "accent": "#5fd7ff", "gold": "#ffd75f", "green": "#7ee787", "yellow": "#f2cc60",
    "red": "#ff7b72", "blue": "#79c0ff", "purple": "#d2a8ff", "orange": "#ffa657", "teal": "#56d4c4",
    "pink": "#ff9bce", "default": "#e6e6ef", "bold": "#ffffff",
}
CSS = """
window.tli { background: transparent; }
.card label { font-size: %(size)spx; }
.card { background: alpha(#101018, %(opacity)s); border-radius: 10px; padding: 10px 14px;
        border: 1px solid alpha(#ffffff, 0.12); }
.card .title { font-size: %(title)spx; color: #8b8fa3; }
.card .head { font-size: %(head)spx; font-weight: 700; }
.card .basis { font-size: %(basis)spx; color: #aeb2c4; }
.card .line { font-size: %(line)spx; }
"""


def runtime_dir():
    return os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/tmp", "tli-overlay")


def alive(pid):
    return isinstance(pid, int) and pid > 0 and os.path.exists(f"/proc/{pid}")


def read_cards(directory):
    cards = []
    try:
        names = sorted(n for n in os.listdir(os.path.join(directory, "cards")) if n.endswith(".json"))
    except OSError:
        return cards
    for name in names:
        path = os.path.join(directory, "cards", name)
        try:
            with open(path) as f:
                card = json.load(f)
        except (OSError, ValueError):
            continue
        if alive(card.get("pid")):
            cards.append(card)
        else:
            try:
                os.remove(path)
            except OSError:
                pass
    return cards


def game_output(title):
    """The output the game's window is on, per niri; None when it cannot be told."""
    try:
        def msg(what):
            return json.loads(subprocess.run(["niri", "msg", "--json", what], capture_output=True, timeout=2, check=True).stdout)
        windows = msg("windows")
        game = next((w for w in windows if w.get("app_id") == "steam_app_1974050"), None) or next(
            (w for w in windows if re.search(title, w.get("title") or "")), None)
        if not game:
            return None
        ws = next((s for s in msg("workspaces") if s["id"] == game.get("workspace_id")), None)
        return ws["output"] if ws else None
    except (OSError, ValueError, subprocess.SubprocessError, KeyError):
        return None


GAP = 6      # between the thing to click and its outline, in logical pixels
THICK = 5    # thickness of the outline


def strips(mark):
    """The four bars of the outline around a mark. Only these pixels are drawn on, so only these are masked."""
    x, y, w, h = mark["x"] - GAP, mark["y"] - GAP, mark["width"] + 2 * GAP, mark["height"] + 2 * GAP
    t = THICK
    return [(x - t, y - t, w + 2 * t, t), (x - t, y + h, w + 2 * t, t), (x - t, y, t, h), (x + w, y, t, h)]


def esc(text):
    return GLib.markup_escape_text(str(text))


def span(text, tone):
    return f'<span foreground="{TONES.get(tone or "default", TONES["default"])}">{esc(text)}</span>'


class Overlay(Gtk.Application):
    def __init__(self, args):
        super().__init__(application_id="tli.overlay")
        self.args = args
        self.dir = runtime_dir()
        self.win = None
        self.box = None
        self.shown = None
        self.monitor_name = None
        self.last_rect = None
        self.ticks = 0

    def do_activate(self):
        css = Gtk.CssProvider()
        z = self.args.size
        css.load_from_string(CSS % {"opacity": self.args.opacity, "size": z, "title": round(z * 0.8), "head": round(z * 1.35),
                                    "basis": round(z * 0.9), "line": round(z * 0.95)})
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.win = Gtk.Window(application=self)
        self.win.add_css_class("tli")
        LS.init_for_window(self.win)
        LS.set_layer(self.win, LS.Layer.OVERLAY)
        LS.set_namespace(self.win, "tli-overlay")
        LS.set_keyboard_mode(self.win, LS.KeyboardMode.NONE)
        edges = (LS.Edge.TOP, LS.Edge.LEFT) if not self.args.right else (LS.Edge.TOP, LS.Edge.RIGHT)
        for e in edges:
            LS.set_anchor(self.win, e, True)
        LS.set_margin(self.win, LS.Edge.TOP, self.args.top)
        LS.set_margin(self.win, edges[1], self.args.left)
        self.box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.win.set_child(self.box)
        # the outline of what to click: a transparent surface over the whole output
        self.marks = []
        self.mon_geo = None
        self.hl = Gtk.Window(application=self)
        self.hl.add_css_class("tli")
        LS.init_for_window(self.hl)
        LS.set_layer(self.hl, LS.Layer.OVERLAY)
        LS.set_namespace(self.hl, "tli-overlay-marks")
        LS.set_keyboard_mode(self.hl, LS.KeyboardMode.NONE)
        LS.set_exclusive_zone(self.hl, -1)
        for e in (LS.Edge.TOP, LS.Edge.BOTTOM, LS.Edge.LEFT, LS.Edge.RIGHT):
            LS.set_anchor(self.hl, e, True)
        area = Gtk.DrawingArea()
        area.set_draw_func(self.draw_marks)
        self.hl.set_child(area)
        self.hl_area = area
        self.hl.connect("map", lambda *_: self.hl_click_through())
        self.win.connect("map", lambda *_: self.click_through())
        self.win.connect("unmap", lambda *_: self.publish_rects())
        GLib.timeout_add(250, self.tick)
        self.hold()

    def hl_click_through(self):
        surface = self.hl.get_surface()
        if surface is not None:
            surface.set_input_region(cairo.Region())

    def draw_marks(self, _area, cr, _w, _h):
        if self.mon_geo is None:
            return
        cr.set_source_rgba(1.0, 0.84, 0.37, 1.0)
        for mark in self.marks:
            for x, y, w, h in strips(mark):
                cr.rectangle(x - self.mon_geo.x, y - self.mon_geo.y, w, h)
        cr.fill()

    def click_through(self):
        surface = self.win.get_surface()
        if surface is not None:
            surface.set_input_region(cairo.Region())
        GLib.timeout_add(60, self.publish_rects)

    def pick_monitor(self):
        monitors = Gdk.Display.get_default().get_monitors()
        want = self.args.output or game_output(self.args.title)
        found = None
        for i in range(monitors.get_n_items()):
            m = monitors.get_item(i)
            if want and m.get_connector() == want:
                found = m
        if found is None and monitors.get_n_items():
            found = monitors.get_item(0)
        if found is not None and found.get_connector() != self.monitor_name:
            self.monitor_name = found.get_connector()
            LS.set_monitor(self.win, found)
            LS.set_monitor(self.hl, found)
        if found is not None:
            self.mon_geo = found.get_geometry()
        return found

    def tick(self):
        self.ticks += 1
        cards = read_cards(self.dir)
        key = json.dumps(cards, sort_keys=True)
        if self.ticks % 20 == 1 and cards:  # every ~5 s: the game may have moved to another output
            self.pick_monitor()
        if key != self.shown:
            self.shown = key
            self.render(cards)
        return True

    def render(self, cards):
        child = self.box.get_first_child()
        while child is not None:
            nxt = child.get_next_sibling()
            self.box.remove(child)
            child = nxt
        self.marks = [m for card in cards for m in card.get("marks") or []]
        if not cards:
            self.hl.set_visible(False)
            self.win.set_visible(False)
            self.publish_rects()
            return
        for card in cards:
            self.box.append(self.card_widget(card))
        self.pick_monitor()
        # the masks are written before the outline is drawn, so no picture of it reaches a reader
        self.publish_rects()
        self.win.set_visible(True)
        self.win.present()
        if self.marks:
            self.hl.set_visible(True)
            self.hl.present()
            self.hl_area.queue_draw()
        else:
            self.hl.set_visible(False)
        GLib.timeout_add(80, self.publish_rects)

    def card_widget(self, card):
        frame = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        frame.add_css_class("card")

        def label(markup, css):
            lab = Gtk.Label(xalign=0, wrap=True, max_width_chars=self.args.width)
            lab.set_markup(markup)
            lab.add_css_class(css)
            frame.append(lab)

        label(esc(card.get("title", "")), "title")
        label(span(card.get("head", ""), card.get("headTone") or "green"), "head")
        if card.get("basis"):
            label(esc(card["basis"]), "basis")
        for line in card.get("lines") or []:
            label(span(line.get("text", ""), line.get("tone")), "line")
        return frame

    def publish_rects(self):
        rects = []
        mon = None
        if self.win.get_visible() and self.monitor_name:
            monitors = Gdk.Display.get_default().get_monitors()
            for i in range(monitors.get_n_items()):
                if monitors.get_item(i).get_connector() == self.monitor_name:
                    mon = monitors.get_item(i)
        w, h = self.win.get_width(), self.win.get_height()
        if mon is not None and w > 1 and h > 1:
            g = mon.get_geometry()
            x = g.x + (g.width - w - self.args.left if self.args.right else self.args.left)
            rects.append({"x": x - 2, "y": g.y + self.args.top - 2, "width": w + 4, "height": h + 4})
        for mark in self.marks:
            for x, y, w, h in strips(mark):
                rects.append({"x": x - 2, "y": y - 2, "width": w + 4, "height": h + 4})
        stored = {"pid": os.getpid(), "rects": rects}
        if stored == self.last_rect:
            return False
        self.last_rect = stored
        os.makedirs(self.dir, exist_ok=True)
        tmp = os.path.join(self.dir, f"rects.json.{os.getpid()}.tmp")
        with open(tmp, "w") as f:
            json.dump(stored, f)
        os.replace(tmp, os.path.join(self.dir, "rects.json"))
        return False


def main():
    p = argparse.ArgumentParser(description="Draw the tools' cards over the game.")
    p.add_argument("--output", help="the output (monitor) to draw on, e.g. DP-1; by default the one the game is on")
    p.add_argument("--left", type=int, default=24, help="distance from the left edge, in logical pixels")
    p.add_argument("--top", type=int, default=700, help="distance from the top edge, in logical pixels")
    p.add_argument("--right", action="store_true", help="measure --left from the right edge instead")
    p.add_argument("--width", type=int, default=38, help="text width of a card, in characters")
    p.add_argument("--size", type=int, default=16, help="base font size in pixels")
    p.add_argument("--opacity", type=float, default=0.86, help="how solid the card's background is, 0 to 1")
    p.add_argument("--title", default="Torchlight", help="regex for the game's window title")
    args = p.parse_args()
    if os.environ.get("XDG_SESSION_TYPE") != "wayland" and not os.environ.get("WAYLAND_DISPLAY"):
        sys.exit("the overlay needs a Wayland session with wlr-layer-shell")
    if not LS.is_supported():
        sys.exit("this compositor does not support wlr-layer-shell")
    sys.exit(Overlay(args).run([]))


if __name__ == "__main__":
    main()
