//! The game window's picture on Linux under Niri. A fullscreen game is taken with
//! `grim` (wlr-screencopy: the whole output, silent). Niri sends a "Screenshot
//! captured" notification for every `niri msg action screenshot-window` and has no
//! setting to turn it off, so that is only the fallback, for a game that is not
//! fullscreen on a visible workspace. The reader wants a 16:9 or wider picture.

use crate::reader::{Rgba, decode_png_raw};
use serde_json::Value;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering::Relaxed};
use std::time::{Duration, Instant};

/// The game's Steam app id: Proton names its window's app id after it.
const APP_ID: &str = "steam_app_1974050";

const PNG_END: [u8; 8] = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/// What `niri msg --json <what>` answers.
fn niri_json(what: &str) -> Result<Value, String> {
    let out = Command::new("niri").args(["msg", "--json", what]).output().map_err(|e| format!("cannot run niri: {e}"))?;
    if !out.status.success() {
        return Err(format!("niri msg failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("niri msg {what}: {e}"))
}

/// The window to capture: the game's app id, else the first title containing `title`.
fn find(title: &str) -> Result<Value, String> {
    let windows = niri_json("windows")?;
    let windows = windows.as_array().ok_or("niri msg windows: not a list")?;
    let wanted = title.to_lowercase();
    windows
        .iter()
        .find(|w| w["app_id"].as_str() == Some(APP_ID))
        .or_else(|| windows.iter().find(|w| w["title"].as_str().is_some_and(|t| t.to_lowercase().contains(&wanted))))
        .cloned()
        .ok_or_else(|| format!("No Torchlight: Infinite window ({APP_ID}), and no window with \"{title}\" in its title: is the game running?"))
}

/// The output the window fills (a fullscreen game on a workspace in view), if it does.
fn filled_output(w: &Value) -> Option<String> {
    let size = &w["layout"]["window_size"];
    let (width, height) = (size[0].as_f64()?, size[1].as_f64()?);
    let workspaces = niri_json("workspaces").ok()?;
    // Niri scrolls a neighbour into view beside a fullscreen window when focus moves to it, so the output only
    // shows the whole game while the game is its workspace's active window.
    let output = workspaces.as_array()?.iter().find(|s| s["id"] == w["workspace_id"] && s["is_active"] == true && s["active_window_id"] == w["id"])?["output"].as_str()?.to_string();
    let outputs = niri_json("outputs").ok()?;
    let logical = &outputs[&output]["logical"];
    (logical["width"].as_f64()? == width && logical["height"].as_f64()? == height).then_some(output)
}

/// The whole output, through wlr-screencopy.
fn grim(output: &str) -> Result<Rgba, String> {
    let out = Command::new("grim").args(["-l", "0", "-o", output, "-"]).output().map_err(|e| format!("cannot run grim: {e}"))?;
    if !out.status.success() {
        return Err(format!("grim failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    decode_png_raw(&out.stdout)
}

/// The picture of the window once niri has written all of it (it answers before the file is whole).
fn niri_shot(id: u64) -> Result<Rgba, String> {
    static N: AtomicU32 = AtomicU32::new(0);
    let path = std::env::temp_dir().join(format!("warden-{}-{}.png", std::process::id(), N.fetch_add(1, Relaxed)));
    let out = Command::new("niri")
        .args(["msg", "action", "screenshot-window", "--id", &id.to_string(), "--path"])
        .arg(&path)
        .output()
        .map_err(|e| format!("cannot run niri: {e}"))?;
    if !out.status.success() {
        return Err(format!("niri screenshot failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let start = Instant::now();
    let result = loop {
        if let Ok(bytes) = std::fs::read(&path)
            && bytes.len() > 8 + PNG_END.len()
            && bytes.ends_with(&PNG_END)
        {
            break decode_png_raw(&bytes);
        }
        if start.elapsed() > Duration::from_secs(3) {
            break Err("the screenshot never appeared".to_string());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let _ = std::fs::remove_file(&path);
    result
}

fn shot(w: &Value) -> Result<Rgba, String> {
    let id = w["id"].as_u64().ok_or("window without an id")?;
    match filled_output(w) {
        Some(output) => grim(&output).or_else(|_| niri_shot(id)),
        None => niri_shot(id),
    }
}

/// The game window as the reader takes it, or the reason it can't be captured.
pub fn capture(title: &str) -> Result<Rgba, String> {
    // The tests run where the player is: no picture at all, and nothing is run.
    if std::env::var_os("TLI_NO_CAPTURE").is_some() {
        return Err("capture disabled".to_string());
    }
    shot(&find(title)?)
}

/// `frames` pictures in a row: the last and the time each took.
pub fn time_frames(title: &str, frames: usize) -> Result<(Rgba, Vec<Duration>), String> {
    if std::env::var_os("TLI_NO_CAPTURE").is_some() {
        return Err("capture disabled".to_string());
    }
    let w = find(title)?;
    let mut times = Vec::new();
    let mut last = None;
    for _ in 0..frames.max(1) {
        let start = Instant::now();
        last = Some(shot(&w)?);
        times.push(start.elapsed());
    }
    Ok((last.ok_or("no frame")?, times))
}
