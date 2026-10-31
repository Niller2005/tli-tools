//! Warden in a terminal, for Linux under Niri: captures the game window with
//! silent grim, reads the board when the screen changes and shows the move it
//! recommends. Never clicks or types in the game.
//!
//!   warden-tui [--title TEXT] [--rollouts N] [--niri-screenshot]
//!   warden-tui --image <frame.png> [--rollouts N]    read one screenshot, print, exit
//!
//! Keys: r read now, q quit.

#[cfg(windows)]
fn main() {
    eprintln!("warden-tui is for Linux; on Windows use warden");
    std::process::exit(1);
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    match linux::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            std::process::ExitCode::from(1)
        }
    }
}

#[cfg(not(windows))]
mod linux {
    use std::fmt::Write as _;
    use std::io::{Read, Write};
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::mpsc::{Receiver, channel};
    use std::time::{Duration, Instant};
    use warden::app::niri::{CaptureOptions, capture_with};
    use warden::app::session::{Session, Watch, fingerprint};
    use warden::board::{CellModel, EventMark, Model};
    use warden::engine::Action;
    use warden::engine::data::{Beast, data};
    use warden::engine::text::{cell_label, tier_name};
    use warden::reader::model::WarningKind;
    use warden::reader::ocr;
    use warden::solver::advise::also_good;

    const SAMPLE: Duration = Duration::from_millis(250);
    const BOLD: &str = "\x1b[1m";
    const DIM: &str = "\x1b[2m";
    const GREEN: &str = "\x1b[32m";
    const YELLOW: &str = "\x1b[33m";
    const RED: &str = "\x1b[31m";
    const REVERSE: &str = "\x1b[7m";
    const RESET: &str = "\x1b[0m";

    struct Args {
        title: String,
        rollouts: usize,
        image: Option<String>,
        niri_screenshot: Option<bool>,
    }

    fn args() -> Result<Args, String> {
        let mut a = Args { title: "Torchlight".to_string(), rollouts: 1600, image: None, niri_screenshot: None };
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--title" => a.title = it.next().ok_or("--title needs a text")?,
                "--rollouts" => a.rollouts = it.next().and_then(|v| v.parse().ok()).filter(|&n| n > 0).ok_or("--rollouts needs a number above 0")?,
                "--image" => a.image = Some(it.next().ok_or("--image needs a file")?),
                "--niri-screenshot" => a.niri_screenshot = Some(true),
                _ => return Err(format!("unexpected argument {arg}; usage: warden-tui [--title TEXT] [--rollouts N] [--niri-screenshot] | warden-tui --image <frame.png>")),
            }
        }
        Ok(a)
    }

    pub fn run() -> Result<(), String> {
        let a = args()?;
        let mut session = Session::new(a.rollouts, Vec::new(), None, None);
        if let Some(file) = &a.image {
            let frame = warden::reader::load_png(Path::new(file))?;
            session.read_in_background(frame);
            session.wait();
            for line in screen(&session, None, &format!("screenshot {file}")) {
                println!("{line}");
            }
            return Ok(());
        }
        let term = Terminal::enter();
        let keys = term.is_some().then(keys);
        live(&mut session, &a, keys.as_ref())
    }

    /// The terminal in cbreak mode on the alternate screen, put back on drop.
    struct Terminal {
        saved: String,
    }

    impl Terminal {
        fn enter() -> Option<Terminal> {
            let stty = |args: &[&str]| Command::new("stty").args(args).stdin(Stdio::inherit()).stderr(Stdio::null()).output().ok().filter(|o| o.status.success());
            let saved = String::from_utf8(stty(&["-g"])?.stdout).ok()?.trim().to_string();
            stty(&["-icanon", "-echo", "-isig"])?;
            print!("\x1b[?1049h\x1b[?25l");
            let _ = std::io::stdout().flush();
            Some(Terminal { saved })
        }
    }

    impl Drop for Terminal {
        fn drop(&mut self) {
            print!("\x1b[?25h\x1b[?1049l");
            let _ = std::io::stdout().flush();
            let _ = Command::new("stty").arg(&self.saved).stdin(Stdio::inherit()).status();
        }
    }

    /// The keys pressed, from a thread that blocks on stdin.
    fn keys() -> Receiver<u8> {
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for b in std::io::stdin().lock().bytes().map_while(Result::ok) {
                if tx.send(b).is_err() {
                    break;
                }
            }
        });
        rx
    }

    fn live(session: &mut Session, a: &Args, keys: Option<&Receiver<u8>>) -> Result<(), String> {
        let mut watch = Watch::default();
        let mut next = Instant::now();
        let mut retry_at: Option<Instant> = None;
        let mut last_error = String::new();
        let options = CaptureOptions { niri_screenshot: a.niri_screenshot };
        loop {
            let mut now = false;
            while let Some(k) = keys.and_then(|k| k.try_recv().ok()) {
                match k {
                    b'q' | 3 => return Ok(()),
                    b'r' => now = true,
                    _ => {}
                }
            }
            let capture_note = if !now && retry_at.is_some_and(|at| Instant::now() < at) {
                last_error.clone()
            } else {
                match capture_with(&a.title, options) {
                    Ok(frame) => {
                        last_error.clear();
                        retry_at = None;
                        let note = format!("{} x {}", frame.w, frame.h);
                        let print = fingerprint(&frame);
                        if now {
                            watch.mark_read(print);
                            session.read_live(frame);
                        } else if watch.sample(print) {
                            session.read_live(frame);
                        }
                        note
                    }
                    Err(e) => {
                        last_error = e.clone();
                        retry_at = Some(Instant::now() + Duration::from_secs(2));
                        e
                    }
                }
            };
            session.poll();
            if session.wants_reread() {
                watch.read_next();
            }
            let mut out = String::from("\x1b[H");
            for line in screen(session, ocr::problem().as_deref(), &capture_note) {
                let _ = writeln!(out, "{line}\x1b[K");
            }
            out.push_str("\x1b[J");
            print!("{out}");
            let _ = std::io::stdout().flush();
            next += SAMPLE;
            match next.checked_duration_since(Instant::now()) {
                Some(wait) => std::thread::sleep(wait),
                None => next = Instant::now(),
            }
        }
    }

    /// Column and row of model cell `n` on the screen's 6x4 ring, clockwise from
    /// the Interrogation Room at the top left.
    fn ring(n: usize) -> (usize, usize) {
        match n {
            0..=5 => (n, 0),
            6 | 7 => (5, n - 5),
            8..=13 => (13 - n, 3),
            _ => (0, 16 - n),
        }
    }

    fn move_name(action: &Action, label: &str) -> String {
        let short = label.split_once(" (").map_or(label, |(name, _)| name);
        match action {
            Action::Devour { to } => format!("Consume {}", cell_label(*to)),
            Action::Swap => "Replace".to_string(),
            _ => short.to_string(),
        }
    }

    fn action_cell(action: &Action, warden: i64) -> Option<usize> {
        use warden::engine::ChoiceId;
        match action {
            Action::Patrol { cell: n } | Action::Devour { to: n } | Action::Chain { to: n } | Action::Choose { id: ChoiceId::Cell(n) } => Some(*n),
            Action::Swap => usize::try_from(warden).ok(),
            _ => None,
        }
    }

    /// What a cell holds in a few letters: "Rar Wolf", "locked", "empty".
    fn short_cell(cell: &CellModel) -> String {
        let d = data();
        let beast = |b: &Beast| d.beast_names[b.index()].split_whitespace().last().unwrap_or("").to_string();
        let tier = |t: &i64| tier_name(*t as i32).chars().take(3).collect::<String>();
        let mark = |e: &Option<EventMark>| if e.is_some() { "!" } else { "" };
        match cell {
            CellModel::Office => "Room".to_string(),
            CellModel::Sealed { event } => format!("locked{}", mark(event)),
            CellModel::Empty { event } => format!("empty{}", mark(event)),
            CellModel::Inmate { beast: b, tier: t, event, .. } => format!("{} {}{}", tier(t), beast(b), mark(event)),
            CellModel::Nest { due: Some(n) } => format!("nest {n}d"),
            CellModel::Nest { due: None } => "nest 1d".to_string(),
            CellModel::Scouted { beast: b, tier: t, event } => format!("({} {}){}", tier(t), beast(b), mark(event)),
            CellModel::Scratch { tier: t, event } => format!("lock {}{}", tier(t), mark(event)),
        }
    }
    /// The ring of cells, two lines each: the cell's number with its marks, and what it holds.
    fn ring_lines(m: &Model, pick: Option<usize>, near: &[usize], warned: &[usize]) -> Vec<String> {
        const W: usize = 12;
        let mut grid = vec![vec![(String::new(), String::new(), ""); 6]; 4];
        for (n, cell) in m.cells.iter().enumerate().take(16) {
            let (col, row) = ring(n);
            let mut top = String::new();
            if m.warden == n as i64 {
                top.push('@');
            }
            top.push_str(&cell_label(n));
            if near.contains(&n) {
                top.push('~');
            }
            if warned.contains(&n) {
                top.push('?');
            }
            let colour = if pick == Some(n) { REVERSE } else if m.warden == n as i64 { YELLOW } else { "" };
            grid[row][col] = (top, short_cell(cell), colour);
        }
        let mut out = Vec::new();
        for row in 0..4 {
            for part in 0..2 {
                let mut line = String::new();
                for col in 0..6 {
                    let (top, body, colour) = &grid[row][col];
                    let text = if part == 0 { top } else { body };
                    let cell: String = format!("{text:<W$}").chars().take(W).collect();
                    let _ = write!(line, "{colour}{cell}{}", if colour.is_empty() { "" } else { RESET });
                    line.push(' ');
                }
                out.push(line);
            }
            out.push(String::new());
        }
        out
    }

    /// Everything on the screen, a line each.
    fn screen(s: &Session, ocr_problem: Option<&str>, capture_note: &str) -> Vec<String> {
        let mut l = vec![format!("{BOLD}Warden{RESET} {DIM}Tartarus prison board, Linux terminal{RESET}"), format!("{DIM}game:{RESET} {capture_note}"), String::new()];
        if let Some(text) = &s.run_over {
            l.push(format!("{BOLD}{text}{RESET}"));
            return footer(l);
        }
        let Some(reading) = &s.reading else {
            if s.scanning() {
                l.push("Reading the board…".to_string());
            } else {
                l.push("No board read yet.".to_string());
                if let Some(p) = ocr_problem {
                    l.push(format!("{YELLOW}{p}{RESET}"));
                }
                if let Some(missed) = &s.missed {
                    l.push(format!("{DIM}{missed}{RESET}"));
                }
            }
            return footer(l);
        };
        for p in &s.problems {
            l.push(format!("{RED}{p}{RESET}"));
        }
        for w in reading.warnings.iter().filter(|w| w.cell.is_none() && w.kind != WarningKind::Note) {
            l.push(format!("{YELLOW}{}{RESET}", w.text));
        }
        let advice = s.advice();
        let m = &reading.model;
        let pick = advice.as_ref().and_then(|a| action_cell(&a.action, m.warden));
        let near: Vec<usize> = advice.as_ref().map(|a| also_good(&s.ranking, a.option)).unwrap_or_default().into_iter().filter_map(|k| action_cell(&s.ranking[k].action, m.warden)).filter(|&c| Some(c) != pick).collect();
        let warned: Vec<usize> = reading.warnings.iter().filter_map(|w| w.cell).collect();

        let mut day = match reading.days_left {
            Some(n) => format!("Day {} · {n} to Riot", m.day),
            None => format!("Day {} · Riot not read", m.day),
        };
        if !reading.kept_lines().is_empty() {
            day.push_str(" · last reading");
        }
        if let Some(goal) = &m.objective
            && let Some(o) = data().objective(goal.id)
        {
            let name = o.name.trim_start_matches("Objective: ");
            let _ = write!(day, " · {name} {}", if goal.progress >= o.target { "done".to_string() } else { format!("{}/{}", goal.progress, o.target) });
        }
        l.push(day);
        for line in reading.kept_lines() {
            l.push(format!("{YELLOW}{line}{RESET}"));
        }
        l.push(String::new());
        match &advice {
            Some(a) => {
                l.push(format!("{DIM}NEXT MOVE{RESET}{}", if s.solving { format!("  {DIM}(playing it out: {} of {} playouts){RESET}", s.rounds, s.rollouts) } else { String::new() }));
                l.push(format!("  {BOLD}{GREEN}{}{RESET}", move_name(&a.action, &a.label)));
                l.push(format!("  {DIM}{}{RESET}", s.why_shown(a)));
            }
            None if s.solving => l.push(format!("{DIM}Solving…{RESET}")),
            None => {}
        }
        l.push(String::new());
        l.extend(ring_lines(m, pick, &near, &warned));
        for w in reading.warnings.iter().filter(|w| w.cell.is_some()) {
            l.push(format!("{YELLOW}? {}{RESET}", w.text));
        }
        let advised = advice.as_ref().and_then(|a| a.option);
        if !s.ranking.is_empty() {
            l.push(format!("{DIM}Moves by Riot loot per run (Chromatic 1, Ultimate 0.2, Legendary 0.05){RESET}"));
            let mut shown: Vec<usize> = (0..s.ranking.len().min(5)).collect();
            if let Some(a) = advised.filter(|&a| a >= 5) {
                shown[4] = a;
            }
            for k in shown {
                let o = &s.ranking[k];
                let chosen = advised == Some(k);
                l.push(format!("  {}{:>2}  {:>5.2}  {}{RESET}", if chosen { GREEN } else { "" }, k + 1, o.mean, move_name(&o.action, &o.label)));
            }
        }
        for w in reading.warnings.iter().filter(|w| w.kind == WarningKind::Note) {
            l.push(format!("{DIM}{}{RESET}", w.text));
        }
        footer(l)
    }

    fn footer(mut l: Vec<String>) -> Vec<String> {
        l.push(String::new());
        l.push(format!("{DIM}r read now · q quit · @ warden · [highlight] advised cell · ~ nearly as good · ? check this cell{RESET}"));
        l
    }

}
