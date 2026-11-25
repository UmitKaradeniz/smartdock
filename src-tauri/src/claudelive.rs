//! Claude plan usage from sources Anthropic itself hands to the user, no login token is used:
//! - Claude Code's status line: Claude Code pipes `rate_limits` (5 h / 7 day %) to the
//!   statusLine command after every reply. `smartdock.exe --statusline` is that command; it
//!   saves the numbers for the dock and still prints a status line (or runs the user's own).
//! - Claude desktop's own plan-usage-history.json (written about every 15 minutes).
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
fn data_dir() -> Option<PathBuf> {
    Some(Path::new(&std::env::var("APPDATA").ok()?).join("app.smartdock.dock"))
}
pub fn live_path() -> Option<PathBuf> {
    Some(data_dir()?.join("claude-live.json"))
}
fn prev_path() -> Option<PathBuf> {
    Some(data_dir()?.join("claude-statusline-prev.json"))
}
fn settings_path() -> Option<PathBuf> {
    Some(Path::new(&std::env::var("USERPROFILE").ok()?).join(".claude").join("settings.json"))
}

pub fn desktop_history() -> Option<PathBuf> {
    let mut c = vec![];
    if let Ok(a) = std::env::var("APPDATA") {
        c.push(Path::new(&a).join("Claude").join("plan-usage-history.json"));
    }
    if let Ok(l) = std::env::var("LOCALAPPDATA") {
        if let Ok(rd) = std::fs::read_dir(Path::new(&l).join("Claude-Data")) {
            for e in rd.flatten() {
                c.push(e.path().join("plan-usage-history.json"));
            }
        }
    }
    c.into_iter().filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p))).max().map(|x| x.1)
}

/// Newest reading of either source, in the shape the UI expects (resets_at in ms).
pub fn usage() -> Result<Value, String> {
    let live = live_path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let desk = desktop_history()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|h| h["samples"].as_array().and_then(|a| a.last().cloned()));
    let lt = live.as_ref().and_then(|v| v["t"].as_u64()).unwrap_or(0);
    let dt = desk.as_ref().and_then(|v| v["t"].as_u64()).unwrap_or(0);
    if lt == 0 && dt == 0 {
        return Err("Claude kullanımı bulunamadı - Claude masaüstünü aç ya da Claude Code'u dock'a bağla".into());
    }
    if lt >= dt {
        let r = &live.as_ref().unwrap()["rate_limits"];
        let win = |k: &str| {
            let w = &r[k];
            if w.is_null() {
                return Value::Null;
            }
            let reset = w["resets_at"].as_f64().map(|s| (s * 1000.0) as u64);
            json!({"utilization": w["used_percentage"], "resets_at": reset})
        };
        Ok(json!({"src": "code", "at": lt, "usage": {"five_hour": win("five_hour"), "seven_day": win("seven_day")}}))
    } else {
        let s = desk.unwrap();
        Ok(json!({"src": "desktop", "at": dt, "usage": {"five_hour": {"utilization": s["u"]["fh"]}, "seven_day": {"utilization": s["u"]["sd"]}}}))
    }
}

/// Modification time of the newest source, for the file watcher.
pub fn stamp() -> u64 {
    [live_path(), desktop_history()]
        .into_iter()
        .flatten()
        .filter_map(|p| std::fs::metadata(p).ok()?.modified().ok())
        .filter_map(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .max()
        .unwrap_or(0)
}

fn our_command() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(format!("\"{}\" --statusline", exe.to_string_lossy().replace('\\', "/")))
}
fn read_settings() -> Value {
    settings_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}
fn is_ours(v: &Value) -> bool {
    v["statusLine"]["command"].as_str().is_some_and(|c| c.contains("--statusline") && c.to_ascii_lowercase().contains("smartdock"))
}

pub fn link_state() -> Value {
    let s = read_settings();
    json!({"linked": is_ours(&s), "fresh": live_path().and_then(|p| std::fs::metadata(p).ok()).is_some()})
}

/// Points Claude Code's statusLine at smartdock; a status line the user already had is kept
/// and still shown (smartdock runs it). Unlinking puts the old one back.
pub fn set_link(on: bool) -> Result<Value, String> {
    let path = settings_path().ok_or("kullanıcı klasörü yok")?;
    let mut s = read_settings();
    if !s.is_object() {
        return Err("~/.claude/settings.json okunamadı".into());
    }
    let prev = prev_path().ok_or("veri klasörü yok")?;
    if on && !is_ours(&s) {
        let old = s.get("statusLine").cloned().unwrap_or(Value::Null);
        if let Some(d) = prev.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        std::fs::write(&prev, serde_json::to_string(&old).unwrap()).map_err(|e| e.to_string())?;
        s["statusLine"] = json!({"type": "command", "command": our_command().ok_or("exe yolu yok")?, "padding": old["padding"].as_u64().unwrap_or(0)});
    } else if !on && is_ours(&s) {
        let old = std::fs::read_to_string(&prev).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
        if old.is_null() {
            s.as_object_mut().unwrap().remove("statusLine");
        } else {
            s["statusLine"] = old;
        }
        let _ = std::fs::remove_file(&prev);
    }
    if let Some(d) = path.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    std::fs::write(&path, serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    Ok(link_state())
}

/// `smartdock.exe --statusline`: runs as Claude Code's status line command and exits.
pub fn statusline_main() {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let v: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    let rl = &v["rate_limits"];
    if rl.is_object() && (!rl["five_hour"].is_null() || !rl["seven_day"].is_null()) {
        if let Some(p) = live_path() {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            // write then rename: the dock never reads a half-written file
            let tmp = p.with_extension("tmp");
            if std::fs::write(&tmp, json!({"t": now_ms(), "rate_limits": rl}).to_string()).is_ok() {
                let _ = std::fs::rename(&tmp, &p);
            }
        }
    }
    let old = prev_path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<Value>(&t).ok());
    if let Some(cmd) = old.as_ref().and_then(|o| o["command"].as_str()).filter(|c| !c.is_empty()) {
        if let Some(out) = run_prev(cmd, &input) {
            let _ = std::io::stdout().write_all(&out);
            return;
        }
    }
    let pct = |k: &str| rl[k]["used_percentage"].as_f64().map(|x| format!("{}%", x.round()));
    let mut parts = vec![];
    if let Some(m) = v["model"]["display_name"].as_str() {
        parts.push(m.to_string());
    }
    if let Some(p) = pct("five_hour") {
        parts.push(format!("5h {p}"));
    }
    if let Some(p) = pct("seven_day") {
        parts.push(format!("7d {p}"));
    }
    println!("{}", parts.join(" · "));
}

/// The user's own status line, fed the same JSON. Claude Code runs commands through bash when
/// it has one (Git Bash), so that is tried first, then cmd.
fn run_prev(cmd: &str, input: &str) -> Option<Vec<u8>> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const NO_WINDOW: u32 = 0x0800_0000;
    for (sh, flag) in [("bash", "-c"), ("cmd", "/C")] {
        let Ok(mut ch) = Command::new(sh).args([flag, cmd]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(NO_WINDOW).spawn() else {
            continue;
        };
        if let Some(mut si) = ch.stdin.take() {
            let _ = si.write_all(input.as_bytes());
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match ch.try_wait() {
                Ok(Some(st)) if st.success() => {
                    let mut out = vec![];
                    ch.stdout.take()?.read_to_end(&mut out).ok()?;
                    return Some(out);
                }
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = ch.kill();
                    break;
                }
            }
        }
    }
    None
}
