#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claudelive;
mod devices;
mod shell;
mod shellitems;
mod sys;
mod tray;
mod quick;
mod desk;
mod wins;
mod notif;
mod autohide;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::http::Response;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use windows::core::HSTRING;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::*;

static OWN: AtomicIsize = AtomicIsize::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Painted part of the window (window-relative physical px): topmost and bottommost edge.
static HIT_TOP: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static HIT_BOT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static DOCK_TOP: AtomicBool = AtomicBool::new(false);
/// Fullscreen app in front, but the pointer hit the screen edge: dock shown over it.
static REVEALED: AtomicBool = AtomicBool::new(false);
/// Where set_geometry put the dock (physical px: x, y, w, h).
static TARGET: Mutex<Option<[i32; 4]>> = Mutex::new(None);
static TASKBAR_CREATED: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static DATA: OnceLock<PathBuf> = OnceLock::new();
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
static SHELLHOOK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
/// Windows asking for attention (FlashWindowEx): the dock marks them like the taskbar does.
static FLASHING: Mutex<Vec<isize>> = Mutex::new(Vec::new());
static APPS: Mutex<Vec<shellitems::App>> = Mutex::new(Vec::new());
static WANT_TASKBAR_HIDDEN: AtomicBool = AtomicBool::new(true);
static FS_HIDDEN: AtomicBool = AtomicBool::new(false);
static LAST_FG: AtomicIsize = AtomicIsize::new(0);
static START_FG: AtomicBool = AtomicBool::new(false);
static START_CLOSED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn data(f: &str) -> PathBuf {
    DATA.get().unwrap().join(f)
}
fn own() -> HWND {
    HWND(OWN.load(Ordering::SeqCst) as *mut _)
}

unsafe extern "system" fn no_frame(h: HWND, msg: u32, wp: windows::Win32::Foundation::WPARAM, lp: windows::Win32::Foundation::LPARAM, _id: usize, _data: usize) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Shell::DefSubclassProc;
    let tb = TASKBAR_CREATED.load(Ordering::Relaxed);
    if tb != 0 && msg == tb {
        // Explorer restarted: its appbar list is gone, register again on the next layout
        shell::forget_appbar();
        if let Some(a) = APP.get() {
            let _ = a.emit("display", ());
        }
    }
    let sh = SHELLHOOK.load(Ordering::Relaxed);
    if sh != 0 && msg == sh {
        // HSHELL_FLASH = HSHELL_REDRAW | HSHELL_HIGHBIT; activation or destruction clears it
        let mut f = FLASHING.lock().unwrap();
        match wp.0 {
            0x8006 => {
                if !f.contains(&lp.0) {
                    f.push(lp.0);
                }
            }
            2 | 4 | 0x8004 => f.retain(|&x| x != lp.0),
            _ => {}
        }
    }
    match msg {
        // shutdown is coming: the UI writes its pending config now
        WM_QUERYENDSESSION => {
            if let Some(a) = APP.get() {
                let _ = a.emit("flush", ());
            }
        }
        WM_DISPLAYCHANGE | WM_DPICHANGED => {
            let r = DefSubclassProc(h, msg, wp, lp);
            if let Some(a) = APP.get() {
                let _ = a.emit("display", ());
            }
            return r;
        }
        // logoff/shutdown never reaches RunEvent::Exit; don't leave the taskbar on auto-hide
        WM_ENDSESSION if wp.0 != 0 => cleanup(),
        // Windows pushes windows out of a shrunken work area (our own appbar included), which
        // lifted the dock off the screen edge; only set_geometry decides where the dock sits.
        WM_WINDOWPOSCHANGING => {
            let t = TARGET.lock().unwrap();
            if let Some([x, y, w, ht]) = *t {
                let p = &mut *(lp.0 as *mut WINDOWPOS);
                if p.flags.0 & SWP_NOMOVE.0 == 0 {
                    p.x = x;
                    p.y = y;
                }
                if p.flags.0 & SWP_NOSIZE.0 == 0 {
                    p.cx = w;
                    p.cy = ht;
                }
            }
        }
        WM_NCPAINT => return LRESULT(0),
        WM_NCACTIVATE => return LRESULT(1),
        WM_NCCALCSIZE if wp.0 != 0 => return LRESULT(0),
        WM_STYLECHANGING if wp.0 as i32 == GWL_STYLE.0 => {
            let ss = &mut *(lp.0 as *mut STYLESTRUCT);
            ss.styleNew &= !(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0;
            ss.styleNew |= WS_POPUP.0;
        }
        _ => {}
    }
    DefSubclassProc(h, msg, wp, lp)
}

fn shell_open(file: &str, args: &str) {
    unsafe {
        ShellExecuteW(HWND::default(), &HSTRING::from("open"), &HSTRING::from(file), &HSTRING::from(args), None, SW_SHOWNORMAL);
    }
}

// ---------------- commands ----------------
#[tauri::command]
fn get_windows() -> Value {
    let own = OWN.load(Ordering::SeqCst);
    let fg = wins::foreground();
    if fg != own && fg != 0 {
        LAST_FG.store(fg, Ordering::SeqCst);
    }
    let list = wins::list(own);
    let flash: Vec<isize> = {
        let mut f = FLASHING.lock().unwrap();
        f.retain(|h| *h != fg && list.iter().any(|w| w.hwnd == *h));
        f.clone()
    };
    json!({"list": list, "fg": LAST_FG.load(Ordering::SeqCst), "flash": flash})
}
#[tauri::command]
fn activate_window(hwnd: isize, toggle: bool) {
    let fg = wins::foreground();
    let front = if fg == OWN.load(Ordering::SeqCst) { LAST_FG.load(Ordering::SeqCst) } else { fg };
    wins::activate(hwnd, toggle && front == hwnd)
}
#[tauri::command]
fn close_window(hwnd: isize) {
    shell::post_close(hwnd)
}
#[tauri::command]
fn kill_pid(pid: u32) {
    wins::kill(pid)
}
#[tauri::command]
async fn list_apps(refresh: bool) -> Vec<shellitems::App> {
    if refresh || APPS.lock().unwrap().is_empty() {
        let a = shellitems::list_apps();
        *APPS.lock().unwrap() = a;
    }
    APPS.lock().unwrap().clone()
}
#[tauri::command]
fn launch(id: String) {
    if std::path::Path::new(&id).exists() {
        shell_open(&id, "");
    } else {
        shell_open("explorer.exe", &format!("shell:AppsFolder\\{}", id));
    }
}
#[tauri::command]
fn open_path(path: String) {
    shell_open(&path, "")
}
#[tauri::command]
fn reveal(path: String) {
    shell_open("explorer.exe", &format!("/select,\"{}\"", path))
}
#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") || url.starts_with("ms-settings:") {
        shell_open(&url, "")
    }
}
#[tauri::command]
async fn qs_get() -> Value {
    devices::mta();
    quick::qs_get()
}
#[tauri::command]
async fn qs_set(kind: String, on: bool) -> bool {
    devices::mta();
    quick::qs_set(&kind, on)
}
#[tauri::command]
async fn bt_devices() -> Vec<Value> {
    devices::mta();
    quick::bt_devices()
}
#[tauri::command]
fn storage_info() -> Value {
    quick::storage_info()
}
#[tauri::command]
async fn storage_scan() -> Value {
    tauri::async_runtime::spawn_blocking(quick::storage_scan).await.unwrap_or(Value::Null)
}
#[tauri::command]
async fn temps() -> Value {
    quick::temps()
}
/// One-time: LHM runs hidden at every logon (one UAC prompt), and is started now.
#[tauri::command]
async fn lhm_start() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(desk::lhm_setup).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn tray_list() -> Vec<tray::Item> {
    tray::list()
}
#[tauri::command]
fn tray_click(id: String, right: bool) {
    tray::click(&id, right)
}
/// Same as the taskbar's Show Desktop button: minimize all, or bring them back.
#[tauri::command]
fn toggle_desktop() {
    std::thread::spawn(|| unsafe {
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
        use windows::Win32::UI::Shell::{IShellDispatch4, Shell};
        // The click on the dock made the dock the foreground window, so after "restore" every
        // window came back inactive and the first input went to the dock (the window felt stuck).
        // Remember who was active when the desktop was shown and hand focus back on restore.
        let last = HWND(LAST_FG.load(Ordering::SeqCst) as *mut _);
        let showing = !last.0.is_null() && IsWindowVisible(last).as_bool() && !IsIconic(last).as_bool() && !is_desktop(last);
        if showing {
            DESK_PREV.store(last.0 as isize, Ordering::SeqCst);
        }
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if let Ok(s) = CoCreateInstance::<_, IShellDispatch4>(&Shell, None, CLSCTX_INPROC_SERVER) {
            let _ = s.ToggleDesktop();
        }
        CoUninitialize();
        if showing {
            return;
        }
        let prev = HWND(DESK_PREV.swap(0, Ordering::SeqCst) as *mut _);
        if prev.0.is_null() {
            return;
        }
        // wait for the restore animation to bring the window back
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(40));
            if IsWindow(prev).as_bool() && !IsIconic(prev).as_bool() {
                let fg = GetForegroundWindow();
                if fg.0.is_null() || fg.0 as isize == OWN.load(Ordering::SeqCst) || is_desktop(fg) {
                    let _ = SetForegroundWindow(prev);
                }
                return;
            }
        }
    });
}
static DESK_PREV: AtomicIsize = AtomicIsize::new(0);
fn is_desktop(h: HWND) -> bool {
    let mut cls = [0u16; 32];
    let n = unsafe { GetClassNameW(h, &mut cls) } as usize;
    let c = String::from_utf16_lossy(&cls[..n]);
    c == "Progman" || c == "WorkerW"
}
#[tauri::command]
fn press_start() {
    // Pressing the dock steals focus, which closes an open Start/Search before this runs.
    // If Start lost focus a moment ago, this click meant "close", so don't reopen it.
    let closed = START_CLOSED_AT.swap(0, Ordering::SeqCst);
    if closed != 0 && now_ms().saturating_sub(closed) < 800 {
        return;
    }
    shell::press_win()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Explorer re-shows the (auto-hide) taskbar when the pointer touches the screen edge; while
/// smartdock owns that edge it is hidden again the moment it appears, not seconds later.
unsafe extern "system" fn on_show(_: windows::Win32::UI::Accessibility::HWINEVENTHOOK, _: u32, h: HWND, obj: i32, _: i32, _: u32, _: u32) {
    if obj != OBJID_WINDOW.0 || !WANT_TASKBAR_HIDDEN.load(Ordering::SeqCst) {
        return;
    }
    let mut cls = [0u16; 32];
    let n = GetClassNameW(h, &mut cls) as usize;
    let c = &cls[..n];
    if c == windows::core::w!("Shell_TrayWnd").as_wide() || c == windows::core::w!("Shell_SecondaryTrayWnd").as_wide() {
        let _ = ShowWindow(h, SW_HIDE);
    }
}
/// A window starts to minimize: keep its last frame for the dock's hover preview.
unsafe extern "system" fn on_minimize(_: windows::Win32::UI::Accessibility::HWINEVENTHOOK, _: u32, h: HWND, obj: i32, _: i32, _: u32, _: u32) {
    if obj == OBJID_WINDOW.0 && !h.0.is_null() {
        wins::remember(h.0 as isize);
    }
}
unsafe extern "system" fn on_foreground(_: windows::Win32::UI::Accessibility::HWINEVENTHOOK, _: u32, h: HWND, _: i32, _: i32, _: u32, _: u32) {
    let v = h.0 as isize;
    if v == 0 {
        return;
    }
    let start = shell::is_start_host(v);
    if START_FG.swap(start, Ordering::SeqCst) && !start {
        START_CLOSED_AT.store(now_ms(), Ordering::SeqCst);
    }
    if v != OWN.load(Ordering::SeqCst) {
        LAST_FG.store(v, Ordering::SeqCst);
    }
}
/// Connected monitors, in the order the monitor setting counts them.
#[tauri::command]
fn monitors(app: AppHandle) -> Vec<Value> {
    let Some(win) = app.get_webview_window("dock") else { return vec![] };
    let main = win.primary_monitor().ok().flatten().map(|m| *m.position());
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| json!({"w": m.size().width, "h": m.size().height, "primary": Some(*m.position()) == main}))
        .collect()
}
#[tauri::command]
fn set_geometry(app: AppHandle, w: f64, h: f64, top: bool, reserve: f64, monitor: Option<usize>) {
    let Some(win) = app.get_webview_window("dock") else { return };
    let mons = win.available_monitors().unwrap_or_default();
    let mon = monitor
        .and_then(|i| mons.get(i).cloned())
        .or_else(|| win.primary_monitor().ok().flatten())
        .or_else(|| mons.first().cloned());
    let Some(mon) = mon else { return };
    let sf = mon.scale_factor();
    let (mx, my) = (mon.position().x, mon.position().y);
    let (mw, mh) = (mon.size().width as i32, mon.size().height as i32);
    // w <= 0: monitor-wide. Never the whole monitor height, or Windows treats the dock as a
    // fullscreen window (Focus Assist, game mode, other apps' fullscreen checks).
    let pw = if w <= 0.0 { mw } else { ((w * sf).round() as i32).min(mw) };
    let ph = ((h * sf).round() as i32).min(mh * 9 / 10);
    let x = mx + (mw - pw) / 2;
    // a Windows taskbar that stays visible keeps the edge; the dock sits next to it
    let rect = windows::Win32::Foundation::RECT { left: mx, top: my, right: mx + mw, bottom: my + mh };
    let inset = shell::taskbar_inset(rect, top);
    let y = if top { my + inset } else { my + mh - ph - inset };
    *TARGET.lock().unwrap() = Some([x, y, pw, ph]);
    DOCK_TOP.store(top, Ordering::SeqCst);
    unsafe {
        let _ = SetWindowPos(own(), HWND_TOPMOST, x, y, pw, ph, SWP_NOACTIVATE);
        if !FS_HIDDEN.load(Ordering::SeqCst) && !IsWindowVisible(own()).as_bool() {
            let _ = ShowWindow(own(), SW_SHOWNOACTIVATE);
        }
    }
    if reserve > 0.0 {
        shell::set_appbar(own(), (reserve * sf).round() as i32, top);
        desk::fix_icons(own());
    } else {
        shell::remove_appbar();
    }
}
/// Clickable (and painted) part of the dock window: union of rects (CSS px, window-relative);
/// empty = whole window.
#[tauri::command]
fn set_hit(app: AppHandle, rects: Vec<[f64; 4]>) {
    apply_hit(&app, &rects);
}
/// A click landed in the hover headroom (transparent, above/around the dock) that the
/// pointer had already left: shrink the region first, then replay the click so the window
/// underneath gets it instead of losing the user's first click.
#[tauri::command]
fn pass_click(app: AppHandle, rects: Vec<[f64; 4]>, right: bool) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEINPUT,
    };
    apply_hit(&app, &rects);
    let (d, u) = if right { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
    let m = |f| INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dwFlags: f, ..Default::default() } } };
    unsafe {
        SendInput(&[m(d), m(u)], std::mem::size_of::<INPUT>() as i32);
    }
}
/// IntelliHide mode (0 off, 1 smart, 2 always) and the dock's resting rect in client CSS px.
#[tauri::command]
fn set_autohide(app: AppHandle, mode: u8, rect: [f64; 4]) {
    let sf = app.get_webview_window("dock").and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
    let mut wr = windows::Win32::Foundation::RECT::default();
    unsafe {
        let _ = GetWindowRect(own(), &mut wr);
    }
    let px = |v: f64| (v * sf).round() as i32;
    *autohide::RECT_PX.lock().unwrap() = Some([wr.left + px(rect[0]), wr.top + px(rect[1]), wr.left + px(rect[2]), wr.top + px(rect[3])]);
    autohide::MODE.store(mode, Ordering::SeqCst);
    autohide::RESEND.store(true, Ordering::SeqCst);
}
fn apply_hit(app: &AppHandle, rects: &[[f64; 4]]) {
    use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR};
    let sf = app.get_webview_window("dock").and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
    unsafe {
        let (t0, b0) = rects.iter().fold((f64::MAX, f64::MIN), |(t, b), r| (t.min(r[1]), b.max(r[3])));
        if !rects.is_empty() {
            HIT_TOP.store((t0 * sf) as i32, Ordering::SeqCst);
            HIT_BOT.store((b0 * sf) as i32, Ordering::SeqCst);
        }
        let mk = |[l, t, r, b]: [f64; 4]| CreateRectRgn((l * sf).floor() as i32, (t * sf).floor() as i32, (r * sf).ceil() as i32, (b * sf).ceil() as i32);
        let rgn = match rects.split_first() {
            Some((first, rest)) => {
                let acc = mk(*first);
                for r in rest {
                    let x = mk(*r);
                    CombineRgn(acc, acc, x, RGN_OR);
                    let _ = DeleteObject(x);
                }
                acc
            }
            None => HRGN::default(),
        };
        // the system owns the region after this call
        SetWindowRgn(own(), rgn, false);
    }
}
#[tauri::command]
fn set_taskbar(hidden: bool) {
    WANT_TASKBAR_HIDDEN.store(hidden, Ordering::SeqCst);
    if hidden {
        shell::hide_taskbar(&data("taskbar.state"))
    } else {
        shell::restore_taskbar(&data("taskbar.state"))
    }
}
#[tauri::command]
fn get_stats() -> sys::Stats {
    sys::stats()
}
#[tauri::command]
async fn get_top(ram: bool) -> Vec<Value> {
    sys::top(ram)
}
#[tauri::command]
async fn media_cmd(cmd: String) {
    devices::mta();
    devices::media_cmd(&cmd)
}
#[tauri::command]
async fn media_get() -> Option<devices::Media> {
    devices::mta();
    devices::media()
}
#[tauri::command]
async fn radios_get() -> devices::Radios {
    devices::mta();
    devices::radios()
}
#[tauri::command]
async fn radio_set(kind: String, on: bool) -> bool {
    devices::mta();
    devices::set_radio(&kind, on)
}
#[tauri::command]
async fn volume_get() -> Option<devices::Volume> {
    devices::mta();
    devices::volume()
}
#[tauri::command]
async fn volume_set(level: Option<f32>, muted: Option<bool>) {
    devices::mta();
    devices::set_volume(level, muted)
}
#[tauri::command]
fn screen_time() -> Value {
    sys::screen_json()
}
#[tauri::command]
async fn find_files(q: String) -> Vec<Value> {
    sys::find_files(&q, 24)
}
#[tauri::command]
async fn claude_usage() -> Result<Value, String> {
    sys::claude_usage()
}
#[tauri::command]
async fn claude_cli_usage() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(claudelive::cli_usage).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn claude_link_get() -> Value {
    claudelive::link_state()
}
#[tauri::command]
fn claude_link_set(on: bool) -> Result<Value, String> {
    claudelive::set_link(on)
}
#[tauri::command]
async fn codex_usage() -> Result<Value, String> {
    sys::codex_usage()
}
#[tauri::command]
async fn antigravity_usage() -> Result<Value, String> {
    sys::antigravity_usage()
}
#[tauri::command]
async fn http_text(url: String) -> Result<String, String> {
    sys::http_text(&url)
}
#[tauri::command]
fn load_config() -> String {
    // a torn or empty write (power loss, crash) falls back to the last good copy
    let ok = |f: &str| std::fs::read_to_string(data(f)).ok().filter(|s| serde_json::from_str::<Value>(s).map(|v| v.is_object()).unwrap_or(false));
    ok("config.json").or_else(|| ok("config.bak")).unwrap_or_default()
}
#[tauri::command]
fn save_config(text: String) -> Result<(), String> {
    use std::io::Write;
    if !serde_json::from_str::<Value>(&text).map(|v| v.is_object()).unwrap_or(false) {
        return Err("invalid config".into());
    }
    let _g = CONFIG_LOCK.lock();
    let (main, tmp) = (data("config.json"), data("config.json.tmp"));
    if std::fs::read_to_string(&main).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some() {
        let _ = std::fs::copy(&main, data("config.bak"));
    }
    // flushed to disk before the swap: a reboot right after a change must not lose it
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, &main).map_err(|e| e.to_string())
}
#[tauri::command]
fn notif_get() -> Value {
    notif::last()
}
#[tauri::command]
fn wallpaper_info() -> Value {
    let p = shell::wallpaper_path().unwrap_or_default();
    let stamp = std::fs::metadata(&p).and_then(|m| m.modified()).map(|t| format!("{:?}", t)).unwrap_or_default();
    json!({"path": p, "stamp": stamp})
}
#[tauri::command]
fn recycle_bin(empty: bool) -> Value {
    use windows::Win32::UI::Shell::*;
    unsafe {
        if empty {
            let _ = SHEmptyRecycleBinW(HWND::default(), None, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND);
        }
        let mut q = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
        let _ = SHQueryRecycleBinW(None, &mut q);
        json!({"items": q.i64NumItems, "bytes": q.i64Size})
    }
}
#[tauri::command]
fn autostart(enable: bool) {
    use windows::Win32::System::Registry::*;
    let exe = std::env::current_exe().unwrap_or_default().to_string_lossy().to_string();
    let key = HSTRING::from("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    unsafe {
        if enable {
            let v: Vec<u16> = format!("\"{}\"", exe).encode_utf16().chain([0]).collect();
            let _ = RegSetKeyValueW(HKEY_CURRENT_USER, &key, &HSTRING::from("smartdock"), REG_SZ.0, Some(v.as_ptr() as *const _), (v.len() * 2) as u32);
        } else {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, &HSTRING::from("smartdock"));
        }
    }
}
#[tauri::command]
fn lock_pc() {
    unsafe {
        let _ = windows::Win32::System::Shutdown::LockWorkStation();
    }
}
#[tauri::command]
fn set_live_glass(on: bool) {
    unsafe {
        let _ = SetWindowDisplayAffinity(own(), if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
    }
}
/// Idle dock: ask WebView2 to trim its working set; active dock: normal.
#[tauri::command]
fn memory_low(app: AppHandle, low: bool) {
    if let Some(w) = app.get_webview_window("dock") {
        let _ = w.with_webview(move |pw| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;
            if let Ok(wv) = pw.controller().CoreWebView2() {
                if let Ok(w19) = wv.cast::<ICoreWebView2_19>() {
                    let lvl = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                    let _ = w19.SetMemoryUsageTargetLevel(lvl);
                }
            }
        });
    }
}
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0)
}

// ---------------- custom protocol: sd://icon, thumb, art, wall ----------------
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query(uri: &str, key: &str) -> Option<String> {
    let q = uri.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| decode(v))
    })
}

fn serve_video(path: &str, range: Option<&str>) -> Option<Response<Vec<u8>>> {
    use std::io::{Read, Seek, SeekFrom};
    let ext = std::path::Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    let mime = match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => return None,
    };
    let mut f = std::fs::File::open(path).ok()?;
    let total = f.metadata().ok()?.len();
    if total == 0 {
        return None;
    }
    const CHUNK: u64 = 2 * 1024 * 1024;
    if let Some(r) = range.and_then(|s| s.strip_prefix("bytes=")) {
        let (a, b) = r.split_once('-').unwrap_or((r, ""));
        let start = a.trim().parse::<u64>().ok()?;
        if start >= total {
            return None;
        }
        let req_end = b.trim().parse::<u64>().ok();
        let end = req_end.unwrap_or(total - 1).min(start + CHUNK - 1).min(total - 1);
        let len = (end - start + 1) as usize;
        let mut buf = vec![0u8; len];
        f.seek(SeekFrom::Start(start)).ok()?;
        f.read_exact(&mut buf).ok()?;
        return Response::builder()
            .status(206)
            .header("Content-Type", mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", format!("bytes {start}-{end}/{total}"))
            .header("Content-Length", len.to_string())
            .header("Access-Control-Allow-Origin", "*")
            .body(buf)
            .ok();
    }
    if total <= 8 * 1024 * 1024 {
        let mut buf = Vec::with_capacity(total as usize);
        f.read_to_end(&mut buf).ok()?;
        return Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Length", total.to_string())
            .header("Access-Control-Allow-Origin", "*")
            .body(buf)
            .ok();
    }
    let end = (CHUNK - 1).min(total - 1);
    let len = (end + 1) as usize;
    let mut buf = vec![0u8; len];
    f.read_exact(&mut buf).ok()?;
    Response::builder()
        .status(206)
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", format!("bytes 0-{end}/{total}"))
        .header("Content-Length", len.to_string())
        .header("Access-Control-Allow-Origin", "*")
        .body(buf)
        .ok()
}

fn capture_backdrop_bmp(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    if w <= 0 || h <= 0 || w > 3840 || h > 400 {
        return None;
    }
    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return None;
        }
        let dst_dc = CreateCompatibleDC(screen_dc);
        let bmp = CreateCompatibleBitmap(screen_dc, w, h);
        if dst_dc.0.is_null() || bmp.0.is_null() {
            if !bmp.0.is_null() { let _ = DeleteObject(bmp); }
            if !dst_dc.0.is_null() { let _ = DeleteDC(dst_dc); }
            ReleaseDC(None, screen_dc);
            return None;
        }
        let old = SelectObject(dst_dc, bmp);
        let mut out = None;
        if BitBlt(dst_dc, 0, 0, w, h, screen_dc, x, y, SRCCOPY).is_ok() {
            let px_len = (w as usize) * (h as usize) * 4;
            let file_size = (54 + px_len) as u32;
            let mut buf = vec![0u8; 54 + px_len];
            // 14-byte BITMAPFILEHEADER
            buf[0] = b'B';
            buf[1] = b'M';
            buf[2..6].copy_from_slice(&file_size.to_le_bytes());
            buf[10..14].copy_from_slice(&54u32.to_le_bytes());
            // 40-byte BITMAPINFOHEADER (top-down 32bpp BGRA)
            buf[14..18].copy_from_slice(&40u32.to_le_bytes());
            buf[18..22].copy_from_slice(&w.to_le_bytes());
            buf[22..26].copy_from_slice(&(-h).to_le_bytes());
            buf[26..28].copy_from_slice(&1u16.to_le_bytes());
            buf[28..30].copy_from_slice(&32u16.to_le_bytes());
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            if GetDIBits(dst_dc, bmp, 0, h as u32, Some(buf[54..].as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS) != 0 {
                out = Some(buf);
            }
        }
        SelectObject(dst_dc, old);
        let _ = DeleteObject(bmp);
        let _ = DeleteDC(dst_dc);
        ReleaseDC(None, screen_dc);
        out
    }
}

fn respond(uri: String, range: Option<String>) -> Response<Vec<u8>> {
    let path = uri.split('?').next().unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
    if path == "backdrop" {
        let x = query(&uri, "x").and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
        let y = query(&uri, "y").and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
        let w = query(&uri, "w").and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
        let h = query(&uri, "h").and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
        if let Some(b) = capture_backdrop_bmp(x, y, w, h) {
            return Response::builder()
                .header("Content-Type", "image/bmp")
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .body(b)
                .unwrap();
        }
        return Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap();
    }
    if path == "winprev" {
        let hwnd = query(&uri, "hwnd").and_then(|s| s.parse::<isize>().ok()).unwrap_or(0);
        let w = query(&uri, "w").and_then(|s| s.parse::<i32>().ok()).unwrap_or(260);
        if let Some(b) = wins::preview_png(hwnd, w) {
            return Response::builder()
                .header("Content-Type", "image/png")
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .body(b)
                .unwrap();
        }
        return Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap();
    }
    if path == "file" {
        if let Some(p) = query(&uri, "path") {
            if let Some(res) = serve_video(&p, range.as_deref()) {
                return res;
            }
        }
        return Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap();
    }
    let body: Option<(Vec<u8>, &str)> = match path.as_str() {
        "icon" | "thumb" => {
            let id = query(&uri, "id").unwrap_or_default();
            let s = query(&uri, "s").and_then(|s| s.parse().ok()).unwrap_or(64);
            shellitems::image(id, s, path == "thumb").map(|b| (b, "image/png"))
        }
        "art" => {
            let a = devices::ART.lock().unwrap();
            (!a.1.is_empty()).then(|| (a.1.clone(), "image/jpeg"))
        }
        "tray" => tray::png(&query(&uri, "id").unwrap_or_default()).map(|b| (b, "image/png")),
        "wall" => shell::wallpaper_path().and_then(|p| std::fs::read(p).ok()).map(|b| (b, "image/jpeg")),
        _ => None,
    };
    match body {
        Some((b, t)) => Response::builder()
            .header("Content-Type", t)
            .header("Cache-Control", "max-age=86400")
            .header("Access-Control-Allow-Origin", "*")
            .body(b)
            .unwrap(),
        None => Response::builder().status(404).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap(),
    }
}

// ---------------- background watchers ----------------
fn watchers(app: AppHandle) {
    // windows + fullscreen + taskbar guard + screen time
    let a = app.clone();
    std::thread::spawn(move || {
        let mut last = Value::Null;
        let mut n: u64 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(600));
            n += 1;
            let w = get_windows();
            if w != last {
                let _ = a.emit("wins", &w);
                last = w;
            }
            let fs = if wins::foreground() == OWN.load(Ordering::SeqCst) {
                FS_HIDDEN.load(Ordering::SeqCst)
            } else {
                shell::foreground_fullscreen(own())
            };
            if fs != FS_HIDDEN.load(Ordering::SeqCst) {
                FS_HIDDEN.store(fs, Ordering::SeqCst);
                REVEALED.store(false, Ordering::SeqCst);
                unsafe {
                    let _ = ShowWindow(own(), if fs { SW_HIDE } else { SW_SHOWNOACTIVATE });
                }
                let _ = a.emit("fullscreen", fs);
            }
            if n % 4 == 0 && WANT_TASKBAR_HIDDEN.load(Ordering::SeqCst) {
                shell::guard_taskbar();
            }
            // at logon the dock can start before Explorer accepts appbars, and Explorer drops
            // them on its own; keep maximized windows ending right above the dock
            if n % 3 == 0 {
                shell::check_appbar();
            }
            if n % 5 == 0 && shell::idle_ms() < 120_000 {
                let fg = wins::foreground();
                if fg != OWN.load(Ordering::SeqCst) && fg != 0 {
                    let mut pid = 0u32;
                    unsafe {
                        GetWindowThreadProcessId(HWND(fg as *mut _), Some(&mut pid));
                    }
                    sys::screen_tick(&wins::exe_of_pid(pid), 3);
                }
            }
            if n % 100 == 0 {
                sys::screen_save(&data("screentime.json"));
            }
        }
    });
    // Claude usage: a new reading lands in a file (Claude Code status line, Claude desktop);
    // tell the UI right away instead of waiting for the next poll
    let a = app.clone();
    std::thread::spawn(move || {
        let mut last = claudelive::stamp();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let t = claudelive::stamp();
            if t != last {
                last = t;
                let _ = a.emit("claude-usage", t);
            }
        }
    });
    // fullscreen: the dock is tucked away, and slides back when the pointer hits its screen edge
    let a = app.clone();
    std::thread::spawn(move || {
        let mut edge_ticks: u8 = 0;
        loop {
            let fs = FS_HIDDEN.load(Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(if fs { 35 } else { 300 }));
            let Some([x, y, w, h]) = *TARGET.lock().unwrap() else {
                edge_ticks = 0;
                continue;
            };
            if !fs {
                edge_ticks = 0;
                continue;
            }
            let mut pt = windows::Win32::Foundation::POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() || pt.x < x || pt.x >= x + w {
                edge_ticks = 0;
                continue;
            }
            let top = DOCK_TOP.load(Ordering::SeqCst);
            let at_edge = if top { pt.y <= y + 1 } else { pt.y >= y + h - 2 };
            // leave = pointer well past the painted part (dock, open panel) toward the screen center
            let gone = if top { pt.y > y + HIT_BOT.load(Ordering::SeqCst) + 40 } else { pt.y < y + HIT_TOP.load(Ordering::SeqCst) - 40 };
            let shown = REVEALED.load(Ordering::SeqCst);
            if !shown && at_edge {
                edge_ticks = edge_ticks.saturating_add(1);
                if edge_ticks >= 6 {
                    edge_ticks = 0;
                    REVEALED.store(true, Ordering::SeqCst);
                    unsafe {
                        let _ = ShowWindow(own(), SW_SHOWNOACTIVATE);
                        let _ = SetWindowPos(own(), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                    let _ = a.emit("reveal", true);
                }
            } else {
                edge_ticks = 0;
                if shown && gone {
                    REVEALED.store(false, Ordering::SeqCst);
                    unsafe {
                        let _ = ShowWindow(own(), SW_HIDE);
                    }
                    let _ = a.emit("reveal", false);
                }
            }
        }
    });
    // media session
    let a = app.clone();
    std::thread::spawn(move || {
        devices::mta();
        let mut last: Option<devices::Media> = None;
        loop {
            let m = devices::media();
            let changed = match (&m, &last) {
                (Some(x), Some(y)) => x.title != y.title || x.playing != y.playing || x.art != y.art || (x.pos - y.pos).abs() > 3.0,
                (None, None) => false,
                _ => true,
            };
            if changed {
                let _ = a.emit("media", &m);
            }
            if m.is_some() {
                last = m;
            } else if last.is_some() {
                last = None;
            }
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
    // unread notification counts per app (Windows notification center)
    let a = app.clone();
    std::thread::spawn(move || {
        devices::mta();
        notif::run(|v| {
            let _ = a.emit("notifs", v);
        });
    });
    // file index + wallpaper
    let a = app.clone();
    std::thread::spawn(move || {
        let mut wall = String::new();
        let mut n = 0u64;
        loop {
            if n % 90 == 0 {
                sys::build_index();
            }
            let w = wallpaper_info().to_string();
            if w != wall {
                if !wall.is_empty() {
                    let _ = a.emit("wallpaper", ());
                }
                wall = w;
            }
            n += 1;
            std::thread::sleep(Duration::from_secs(10));
        }
    });
}

fn cleanup() {
    shell::remove_appbar();
    if let Some(d) = DATA.get() {
        shell::restore_taskbar(&d.join("taskbar.state"));
        sys::screen_save(&d.join("screentime.json"));
    }
}

fn main() {
    // Claude Code's status line command: save the usage numbers and exit, no window
    if std::env::args().any(|a| a == "--statusline") {
        claudelive::statusline_main();
        return;
    }
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |i| {
        cleanup();
        prev(i)
    }));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = app.emit("hotkey", "search");
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _sc, ev| {
                    if ev.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("dock") {
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("hotkey", "search");
                    }
                })
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("sd", |_ctx, req, responder| {
            let uri = req.uri().to_string();
            let range = req.headers().get("range").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
            std::thread::spawn(move || responder.respond(respond(uri, range)));
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let _ = DATA.set(dir);
            shellitems::start();
            sys::screen_load(&data("screentime.json"));
            let w = app.get_webview_window("dock").unwrap();
            OWN.store(w.hwnd()?.0 as isize, Ordering::SeqCst);
            // A dock never needs a caption: tao's frameless windows keep WS_CAPTION, which Windows
            // briefly paints as a classic title bar whenever the window region changes.
            unsafe {
                let st = GetWindowLongPtrW(own(), GWL_STYLE);
                let strip = (WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0 as isize;
                SetWindowLongPtrW(own(), GWL_STYLE, (st & !strip) | WS_POPUP.0 as isize);
                // tao re-applies its styles later and SetWindowRgn drops DWM composition of the frame,
                // so also veto caption styles and swallow every non-client paint for good.
                let _ = APP.set(app.handle().clone());
                TASKBAR_CREATED.store(RegisterWindowMessageW(windows::core::w!("TaskbarCreated")), Ordering::Relaxed);
                let _ = windows::Win32::UI::Shell::SetWindowSubclass(own(), Some(no_frame), 1, 0);
                let _ = SetWindowPos(own(), HWND::default(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
                SHELLHOOK.store(RegisterWindowMessageW(windows::core::w!("SHELLHOOK")), Ordering::Relaxed);
                let _ = RegisterShellHookWindow(own());
            }
            if app.global_shortcut().register("Alt+Space").is_err() {
                let _ = app.global_shortcut().register("Ctrl+Alt+Space");
            }
            unsafe {
                use windows::Win32::UI::Accessibility::SetWinEventHook;
                SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
                SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, None, Some(on_show), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
                SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZESTART, None, Some(on_minimize), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            }
            let a = app.handle().clone();
            tray::start(move || {
                let _ = a.emit("tray", ());
            });
            desk::lhm_ensure();
            watchers(app.handle().clone());
            autohide::start(app.handle().clone(), || START_FG.load(Ordering::SeqCst));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_windows, activate_window, close_window, kill_pid, list_apps, launch, open_path, reveal, open_url,
            press_start, monitors, toggle_desktop, tray_list, tray_click, qs_get, qs_set, bt_devices, storage_info, storage_scan, temps, lhm_start, set_geometry, set_hit, pass_click, set_autohide, set_taskbar, get_stats, get_top, media_get, media_cmd, radios_get, radio_set, volume_get,
            volume_set, screen_time, find_files, claude_usage, claude_cli_usage, claude_link_get, claude_link_set, codex_usage, antigravity_usage, http_text, load_config, save_config, notif_get,
            wallpaper_info, recycle_bin, autostart, lock_pc, set_live_glass, memory_low, quit
        ])
        .build(tauri::generate_context!())
        .expect("tauri build");

    app.run(|_, e| {
        if let RunEvent::Exit = e {
            cleanup();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serve_video_handles_full_range_and_rejects_non_video() {
        let dir = std::env::temp_dir().join("smartdock_test_media");
        let _ = std::fs::create_dir_all(&dir);
        let mp4 = dir.join("clip.mp4");
        let txt = dir.join("note.txt");
        let payload: Vec<u8> = (0..64u8).collect();
        std::fs::write(&mp4, &payload).unwrap();
        std::fs::write(&txt, b"hello").unwrap();

        let full = serve_video(mp4.to_str().unwrap(), None).expect("full 200");
        assert_eq!(full.status().as_u16(), 200);
        assert_eq!(full.body(), &payload);

        let part = serve_video(mp4.to_str().unwrap(), Some("bytes=0-15")).expect("partial 206");
        assert_eq!(part.status().as_u16(), 206);
        assert_eq!(part.headers().get("content-range").unwrap().to_str().unwrap(), "bytes 0-15/64");
        assert_eq!(part.body(), &payload[0..16]);

        assert!(serve_video(txt.to_str().unwrap(), None).is_none());

        let _ = std::fs::remove_file(&mp4);
        let _ = std::fs::remove_file(&txt);
    }

    #[test]
    fn preview_png_rejects_invalid_hwnd() {
        assert!(wins::preview_png(0, 260).is_none());
    }
}
