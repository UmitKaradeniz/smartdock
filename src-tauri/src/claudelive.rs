//! Claude plan usage from sources Anthropic itself hands to the user, no login token is used:
//! - Claude Code's status line: Claude Code pipes `rate_limits` (5 h / 7 day %) to the
//!   statusLine command after every reply. `smartdock.exe --statusline` is that command; it
//!   saves the numbers for the dock and still prints a status line (or runs the user's own).
//! - Claude desktop's own plan-usage-history.json (written about every 15 minutes, but it can
//!   stop, and Claude Code inside the desktop app runs no status line).
//! - When both are old: `claude -p /usage`, the official CLI printing the same numbers. It is a
//!   local command (no model call, no cost); the CLI signs in by itself, the dock sees no token.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
pub(crate) fn data_dir() -> Option<PathBuf> {
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

fn claude_exe() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let known = Path::new(&home).join(".local").join("bin").join("claude.exe");
    if known.exists() {
        return Some(known);
    }
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join("claude.exe")).find(|p| p.exists())
}

/// The reply of `/usage`, only if it really was the local command: an older CLI would send the
/// text to the model instead, and that costs usage.
fn usage_reply(json_out: &str) -> Option<Result<String, ()>> {
    let v: Value = serde_json::from_str(json_out.trim()).ok()?;
    if v["num_turns"].as_u64() != Some(0) || v["total_cost_usd"].as_f64() != Some(0.0) {
        return Some(Err(()));
    }
    if v["is_error"].as_bool() != Some(false) {
        return None;
    }
    v["result"].as_str().map(|s| Ok(s.to_string()))
}

/// `claude -p /usage` as plain text. Runs without the user's hooks, MCP servers or session file.
pub fn cli_usage() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    static OFF: AtomicBool = AtomicBool::new(false);
    const NO_WINDOW: u32 = 0x0800_0000;
    let failed = || "claude /usage".to_string();
    if OFF.load(Ordering::SeqCst) {
        return Err(failed());
    }
    let mut c = Command::new(claude_exe().ok_or_else(failed)?);
    c.args(["-p", "/usage", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(NO_WINDOW);
    // started from inside a Claude session, the dock must not pass that session's variables on
    for (k, _) in std::env::vars_os() {
        let n = k.to_string_lossy();
        if n.starts_with("CLAUDE") || n.starts_with("ANTHROPIC") {
            c.env_remove(&k);
        }
    }
    let mut ch = c.spawn().map_err(|_| failed())?;
    let mut so = ch.stdout.take().ok_or_else(failed)?;
    // read while it runs: a full pipe would block the child
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = so.read_to_string(&mut s);
        s
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(25);
    while matches!(ch.try_wait(), Ok(None)) {
        if std::time::Instant::now() >= deadline {
            let _ = ch.kill();
            let _ = ch.wait();
            return Err(failed());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    match usage_reply(&reader.join().map_err(|_| failed())?) {
        Some(Ok(text)) => Ok(text),
        Some(Err(())) => {
            OFF.store(true, Ordering::SeqCst);
            Err(failed())
        }
        None => Err(failed()),
    }
}

/// Newest reading of either source, in the shape the UI expects (resets_at in ms).
pub fn usage() -> Result<Value, String> {
    let live = live_path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let samples = desktop_history()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|h| h["samples"].as_array().cloned())
        .unwrap_or_default();
    let desk = samples.last().cloned();
    // [time, weekly %] of this account: the forecast learns the usual pace of earlier weeks
    let week: Vec<Value> = match &desk {
        Some(d) => samples.iter().filter(|s| s["org"] == d["org"] && s["u"]["sd"].is_number()).map(|s| json!([s["t"], s["u"]["sd"]])).collect(),
        None => vec![],
    };
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
        Ok(json!({"src": "code", "at": lt, "week": week, "usage": {"five_hour": win("five_hour"), "seven_day": win("seven_day")}}))
    } else {
        let s = desk.unwrap();
        Ok(json!({"src": "desktop", "at": dt, "week": week, "usage": {"five_hour": {"utilization": s["u"]["fh"]}, "seven_day": {"utilization": s["u"]["sd"]}}}))
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
    // an existing file that cannot be read or parsed must not be replaced with an empty one
    let readable = match std::fs::read_to_string(&path) {
        Ok(t) => t.trim().is_empty() || serde_json::from_str::<Value>(&t).is_ok_and(|v| v.is_object()),
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    };
    if !readable {
        return Err("~/.claude/settings.json okunamadı".into());
    }
    let mut s = read_settings();
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
    replace_file(&path, &serde_json::to_string_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
    Ok(link_state())
}

/// Swaps in new contents in one step, so a crash or power cut cannot leave half a file; the
/// previous version stays next to it as `<name>.smartdock-bak`.
fn replace_file(path: &Path, text: &str) -> std::io::Result<()> {
    // a linked settings file (dotfiles) keeps its link: the file it points to is replaced
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let named = |suffix: &str| {
        let mut n = path.clone().into_os_string();
        n.push(suffix);
        PathBuf::from(n)
    };
    if path.exists() {
        std::fs::copy(&path, named(".smartdock-bak"))?;
    }
    let tmp = named(".smartdock-tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, &path)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacing_settings_keeps_the_previous_version() {
        let dir = std::env::temp_dir().join("smartdock_test_settings");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        replace_file(&p, "one").unwrap();
        replace_file(&p, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(std::fs::read_to_string(dir.join("settings.json.smartdock-bak")).unwrap(), "one");
        assert!(!dir.join("settings.json.smartdock-tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_free_local_reply_counts() {
        let ok = r#"{"is_error":false,"num_turns":0,"total_cost_usd":0,"result":"Current session: 1% used"}"#;
        assert_eq!(usage_reply(ok), Some(Ok("Current session: 1% used".into())));
        assert_eq!(usage_reply(r#"{"is_error":false,"num_turns":1,"total_cost_usd":0.01,"result":"hi"}"#), Some(Err(())));
        assert_eq!(usage_reply("not json"), None);
    }

    // runs the installed CLI: cargo test --release live_cli_usage -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_cli_usage() {
        println!("{}", cli_usage().unwrap().lines().take(4).collect::<Vec<_>>().join("\n"));
    }
}
