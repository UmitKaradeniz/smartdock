// Windows shell integration: taskbar hide/restore, appbar reservation,
// Start key, fullscreen detection, wallpaper, idle time.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetLastInputInfo, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, LASTINPUTINFO, VK_LWIN,
};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, SHQueryUserNotificationState, ABE_BOTTOM, ABE_TOP, ABM_GETSTATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
    ABM_SETSTATE, ABN_FULLSCREENAPP, ABS_AUTOHIDE, APPBARDATA, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::*;

static TASKBAR_HIDDEN: AtomicBool = AtomicBool::new(false);
static APPBAR: Mutex<Option<isize>> = Mutex::new(None);
static ORIG_STATE: Mutex<Option<u32>> = Mutex::new(None);
/// Last requested reservation (hwnd, physical px, top edge), re-asserted by check_appbar.
static WANT: Mutex<Option<(isize, i32, bool)>> = Mutex::new(None);
static LAST_MON: Mutex<Option<RECT>> = Mutex::new(None);
static APPBAR_FS: AtomicBool = AtomicBool::new(false);

fn tray_windows() -> Vec<HWND> {
    let mut v = Vec::new();
    unsafe {
        if let Ok(h) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
            v.push(h);
        }
        let mut prev = HWND::default();
        while let Ok(h) = FindWindowExW(HWND::default(), prev, w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) {
            if h.0.is_null() {
                break;
            }
            v.push(h);
            prev = h;
        }
    }
    v
}

fn abd(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

/// Puts the Windows taskbar in auto-hide (so it frees the work area) and hides it.
pub fn hide_taskbar(marker: &std::path::Path) {
    unsafe {
        let trays = tray_windows();
        let Some(main) = trays.first().copied() else { return };
        let mut d = abd(main);
        let cur = SHAppBarMessage(ABM_GETSTATE, &mut d) as u32;
        // Remember the user's original state once, across crashes, in a marker file.
        let orig = match std::fs::read_to_string(marker).ok().and_then(|s| s.trim().parse::<u32>().ok()) {
            Some(v) => v,
            None => {
                let _ = std::fs::write(marker, cur.to_string());
                cur
            }
        };
        *ORIG_STATE.lock().unwrap() = Some(orig);
        d.lParam = LPARAM((cur | ABS_AUTOHIDE) as isize);
        SHAppBarMessage(ABM_SETSTATE, &mut d);
        for t in trays {
            let _ = ShowWindow(t, SW_HIDE);
        }
    }
    TASKBAR_HIDDEN.store(true, Ordering::SeqCst);
}

/// Re-hides the taskbar if Explorer brought it back (restart, Start menu, etc).
pub fn guard_taskbar() {
    if !TASKBAR_HIDDEN.load(Ordering::SeqCst) {
        return;
    }
    unsafe {
        for t in tray_windows() {
            if IsWindowVisible(t).as_bool() {
                let _ = ShowWindow(t, SW_HIDE);
            }
        }
    }
}

pub fn restore_taskbar(marker: &std::path::Path) {
    if !TASKBAR_HIDDEN.swap(false, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let trays = tray_windows();
        if let Some(main) = trays.first().copied() {
            let mut d = abd(main);
            let orig = ORIG_STATE.lock().unwrap().unwrap_or(0);
            d.lParam = LPARAM(orig as isize);
            SHAppBarMessage(ABM_SETSTATE, &mut d);
        }
        for t in trays {
            let _ = ShowWindow(t, SW_SHOW);
        }
    }
    let _ = std::fs::remove_file(marker);
}

pub fn monitor_rect(hwnd: HWND) -> RECT {
    unsafe {
        let m = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(m, &mut mi);
        mi.rcMonitor
    }
}

// ---------- work-area reservation ----------
// Explorer kept ignoring the reservation when it was registered on the dock's own (tao/WebView2)
// window, while a plain native window got it every time. So the reservation lives on a
// dedicated invisible, click-through window that only exists to be the appbar.
static AB_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static BAD: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

unsafe extern "system" fn ab_proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> windows::Win32::Foundation::LRESULT {
    if msg == WM_MOUSEACTIVATE {
        return windows::Win32::Foundation::LRESULT(MA_NOACTIVATE as isize);
    }
    if msg == WM_USER + 77 && wp.0 as u32 == ABN_FULLSCREENAPP {
        APPBAR_FS.store(lp.0 != 0, Ordering::SeqCst);
    }
    DefWindowProcW(h, msg, wp, lp)
}

fn appbar_window() -> Option<HWND> {
    let h = AB_HWND.load(Ordering::SeqCst);
    if h != 0 {
        return Some(HWND(h as *mut _));
    }
    let (tx, rx) = std::sync::mpsc::channel::<isize>();
    std::thread::spawn(move || unsafe {
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        let Ok(inst) = GetModuleHandleW(None) else { return tx.send(0).unwrap_or(()) };
        let cls = w!("SmartDockAppBar");
        let wc = WNDCLASSW { lpfnWndProc: Some(ab_proc), hInstance: inst.into(), lpszClassName: cls, ..Default::default() };
        RegisterClassW(&wc);
        let ex = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT;
        let Ok(h) = CreateWindowExW(ex, cls, w!("smartdock reserve"), WS_POPUP, 0, 0, 1, 1, None, None, inst, None) else {
            return tx.send(0).unwrap_or(());
        };
        // fully transparent and click-through: it only holds the screen edge
        let _ = SetLayeredWindowAttributes(h, windows::Win32::Foundation::COLORREF(0), 0, LWA_ALPHA);
        let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
        let _ = tx.send(h.0 as isize);
        let mut m = MSG::default();
        while GetMessageW(&mut m, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&m);
            DispatchMessageW(&m);
        }
    });
    let h = rx.recv().unwrap_or(0);
    if h == 0 {
        return None;
    }
    AB_HWND.store(h, Ordering::SeqCst);
    Some(HWND(h as *mut _))
}

unsafe fn apply_work_area(mon: RECT, px: i32, top: bool) {
    let work = RECT {
        left: mon.left,
        top: if top { mon.top + px } else { mon.top },
        right: mon.right,
        bottom: if top { mon.bottom } else { mon.bottom - px },
    };
    let _ = SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&work as *const _ as *mut _), SPIF_SENDCHANGE);
    *LAST_MON.lock().unwrap() = Some(mon);
}

/// Reserves `px` physical pixels at the top or bottom edge of the dock's monitor so maximized
/// windows stop right at the dock.
pub fn set_appbar(dock: HWND, px: i32, top: bool) {
    *WANT.lock().unwrap() = Some((dock.0 as isize, px, top));
    let Some(ab) = appbar_window() else { return };
    unsafe {
        let mut d = abd(ab);
        let mut reg = APPBAR.lock().unwrap();
        let mut ok_new = reg.is_some();
        if !ok_new {
            d.uCallbackMessage = WM_USER + 77;
            // fails while Explorer is still starting or after an unclean exit; check_appbar retries
            if SHAppBarMessage(ABM_NEW, &mut d) != 0 {
                *reg = Some(ab.0 as isize);
                ok_new = true;
            } else {
                ablog("NEW failed");
            }
        }
        drop(reg);
        if ok_new {
            let m = monitor_rect(dock);
            d.uEdge = if top { ABE_TOP } else { ABE_BOTTOM };
            d.rc = m;
            if top {
                d.rc.bottom = m.top + px;
            } else {
                d.rc.top = m.bottom - px;
            }
            SHAppBarMessage(ABM_QUERYPOS, &mut d);
            // QUERYPOS stacks us beside the (hidden, auto-hide) taskbar; the dock lives on the edge
            // itself, so the work area must end at edge +- px
            if top {
                d.rc.top = m.top;
                d.rc.bottom = m.top + px;
            } else {
                d.rc.top = m.bottom - px;
                d.rc.bottom = m.bottom;
            }
            SHAppBarMessage(ABM_SETPOS, &mut d);
            let r = d.rc;
            // the appbar window covers what it reserves, as the protocol expects
            let _ = SetWindowPos(ab, HWND_BOTTOM, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            ablog(&format!("SETPOS px={px} top={top} rc=({},{},{},{})", r.left, r.top, r.right, r.bottom));
        }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(MonitorFromWindow(dock, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            let (mon, work) = (mi.rcMonitor, mi.rcWork);
            let bad = if top { work.top < mon.top + px - 1 } else { work.bottom > mon.bottom - px + 1 };
            if bad {
                apply_work_area(mon, px, top);
                ablog(&format!("SPI_SETWORKAREA px={px} top={top}"));
            }
        }
    }
}

/// Small rolling diagnostics log for the work-area reservation (appbar.log in the data dir).
fn ablog(line: &str) {
    use std::io::Write;
    let p = crate::data("appbar.log");
    if std::fs::metadata(&p).map(|m| m.len() > 64_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} {line}");
    }
}

/// Re-applies the reservation when the work area no longer stops at the dock: a plain SETPOS
/// first (Explorer applies it asynchronously), a fresh registration only if that keeps failing.
pub fn check_appbar() {
    let Some((h, px, top)) = *WANT.lock().unwrap() else { return };
    unsafe {
        let dock = HWND(h as *mut _);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(dock, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            return;
        }
        let (mon, work) = (mi.rcMonitor, mi.rcWork);
        let bad = if top { work.top < mon.top + px - 1 } else { work.bottom > mon.bottom - px + 1 };
        if !bad {
            if BAD.swap(0, Ordering::SeqCst) != 0 {
                ablog(&format!("ok: work=({},{})", work.top, work.bottom));
            }
            return;
        }
        let n = BAD.fetch_add(1, Ordering::SeqCst) + 1;
        ablog(&format!("check #{n}: work=({},{}) mon=({},{}) px={px}", work.top, work.bottom, mon.top, mon.bottom));
        if n % 4 == 0 {
            // registration lost (Explorer restart, logon race): register from scratch
            if let Some(ab) = appbar_window() {
                let mut d = abd(ab);
                SHAppBarMessage(ABM_REMOVE, &mut d);
            }
            forget_appbar();
        }
        set_appbar(dock, px, top);
    }
}

/// Explorer restarted and dropped every appbar; the next set_appbar registers anew.
pub fn forget_appbar() {
    *APPBAR.lock().unwrap() = None;
}

pub fn remove_appbar() {
    *WANT.lock().unwrap() = None;
    let mut reg = APPBAR.lock().unwrap();
    if let Some(h) = reg.take() {
        unsafe {
            let mut d = abd(HWND(h as *mut _));
            SHAppBarMessage(ABM_REMOVE, &mut d);
        }
    }
    if let Some(mon) = LAST_MON.lock().unwrap().take() {
        unsafe {
            let _ = SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&mon as *const _ as *mut _), SPIF_SENDCHANGE);
        }
    }
}

/// Start menu / Search flyout host window.
pub fn is_start_host(h: isize) -> bool {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(HWND(h as *mut _), Some(&mut pid));
        let e = crate::wins::exe_of_pid(pid).to_lowercase();
        e.ends_with("\\startmenuexperiencehost.exe") || e.ends_with("\\searchhost.exe") || e.ends_with("\\searchapp.exe")
    }
}

pub fn press_win() {
    unsafe {
        let k = |up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: VK_LWIN, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() },
            },
        };
        SendInput(&[k(false), k(true)], std::mem::size_of::<INPUT>() as i32);
    }
}

fn is_fullscreen_bounds(r: RECT, mon: RECT, work: RECT, appbar_fs: bool, d3d_fs: bool, zoomed: bool, style: u32) -> bool {
    let covers_mon = r.left <= mon.left + 1 && r.top <= mon.top + 1 && r.right >= mon.right - 1 && r.bottom >= mon.bottom - 1;
    if !covers_mon {
        return false;
    }
    let has_work_strip = work.bottom < mon.bottom - 2 || work.top > mon.top + 2;
    if has_work_strip {
        return true;
    }
    if appbar_fs || d3d_fs {
        return true;
    }
    !zoomed || (style & WS_CAPTION.0 != WS_CAPTION.0) || (style & WS_THICKFRAME.0 == 0)
}

/// True when the foreground window covers its whole monitor (game, video, F11).
pub fn foreground_fullscreen(own: HWND) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg == own {
            return false;
        }
        let dock_mon = MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST);
        let fg_mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        if fg_mon != dock_mon {
            return false;
        }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(fg, &mut cls);
        let c = String::from_utf16_lossy(&cls[..n as usize]);
        if matches!(
            c.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "XamlExplorerHostIslandWindow" | "MultitaskingViewFrame"
        ) || is_start_host(fg.0 as isize)
        {
            return false;
        }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(dock_mon, &mut mi).as_bool() {
            return false;
        }
        let (mon, work) = (mi.rcMonitor, mi.rcWork);
        let mut r = RECT::default();
        if DwmGetWindowAttribute(fg, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).is_err()
            && GetWindowRect(fg, &mut r).is_err()
        {
            return false;
        }
        let appbar_fs = APPBAR_FS.load(Ordering::SeqCst);
        let d3d_fs = SHQueryUserNotificationState().ok() == Some(QUNS_RUNNING_D3D_FULL_SCREEN);
        let st = GetWindowLongPtrW(fg, GWL_STYLE) as u32;
        let zoomed = IsZoomed(fg).as_bool();
        is_fullscreen_bounds(r, mon, work, appbar_fs, d3d_fs, zoomed, st)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rc(l: i32, t: i32, r: i32, b: i32) -> RECT {
        RECT { left: l, top: t, right: r, bottom: b }
    }

    #[test]
    fn borderless_fullscreen_detected() {
        let mon = rc(0, 0, 1920, 1080);
        assert!(is_fullscreen_bounds(mon, mon, mon, false, false, false, WS_POPUP.0));
    }

    #[test]
    fn caption_fullscreen_with_reserved_work_area_detected() {
        let mon = rc(0, 0, 1920, 1080);
        let work = rc(0, 0, 1920, 1016);
        assert!(is_fullscreen_bounds(mon, mon, work, false, false, true, (WS_CAPTION | WS_THICKFRAME).0));
    }

    #[test]
    fn normal_maximized_with_reserved_work_area_not_fullscreen() {
        let mon = rc(0, 0, 1920, 1080);
        let work = rc(0, 0, 1920, 1016);
        assert!(!is_fullscreen_bounds(work, mon, work, false, false, true, (WS_CAPTION | WS_THICKFRAME).0));
    }

    #[test]
    fn normal_maximized_without_reserved_work_area_not_fullscreen() {
        let mon = rc(0, 0, 1920, 1080);
        assert!(!is_fullscreen_bounds(mon, mon, mon, false, false, true, (WS_CAPTION | WS_THICKFRAME).0));
    }

    #[test]
    fn appbar_or_d3d_fullscreen_when_work_equals_mon() {
        let mon = rc(0, 0, 1920, 1080);
        assert!(is_fullscreen_bounds(mon, mon, mon, true, false, true, (WS_CAPTION | WS_THICKFRAME).0));
        assert!(is_fullscreen_bounds(mon, mon, mon, false, true, true, (WS_CAPTION | WS_THICKFRAME).0));
    }

    #[test]
    fn floating_window_not_fullscreen() {
        let mon = rc(0, 0, 1920, 1080);
        let win = rc(100, 100, 1600, 900);
        assert!(!is_fullscreen_bounds(win, mon, mon, false, false, false, WS_POPUP.0));
    }
}

pub fn idle_ms() -> u32 {
    unsafe {
        let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut li).as_bool() {
            windows::Win32::System::SystemInformation::GetTickCount().wrapping_sub(li.dwTime)
        } else {
            0
        }
    }
}

pub fn wallpaper_path() -> Option<String> {
    unsafe {
        let mut buf = [0u16; 520];
        SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.len() as u32, Some(buf.as_mut_ptr() as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).ok()?;
        let n = buf.iter().position(|&c| c == 0).unwrap_or(0);
        let p = String::from_utf16_lossy(&buf[..n]);
        if p.is_empty() { None } else { Some(p) }
    }
}

pub fn post_close(h: isize) {
    unsafe {
        let _ = PostMessageW(HWND(h as *mut _), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
}
