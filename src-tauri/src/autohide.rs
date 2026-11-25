// IntelliHide: tells the UI whether an application window covers the dock's resting place.
// The UI decides when to slide away (pointer, open panels, edit mode); this only watches windows.
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::*;

/// 0 off, 1 smart (hide while covered), 2 always
pub static MODE: AtomicU8 = AtomicU8::new(0);
/// the dock's resting rect in screen pixels
pub static RECT_PX: Mutex<Option<[i32; 4]>> = Mutex::new(None);
/// set by every UI update: the current state is sent again (the UI may have missed the first one)
pub static RESEND: AtomicBool = AtomicBool::new(true);

struct Scan {
    r: [i32; 4],
    own: u32,
    hit: bool,
}

unsafe extern "system" fn each(h: HWND, lp: LPARAM) -> BOOL {
    let s = &mut *(lp.0 as *mut Scan);
    if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
        return true.into();
    }
    let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
    if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0) != 0 {
        return true.into();
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(h, Some(&mut pid));
    if pid == s.own {
        return true.into();
    }
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
    if cloaked != 0 {
        return true.into();
    }
    let mut buf = [0u16; 64];
    let n = GetClassNameW(h, &mut buf) as usize;
    let cls = String::from_utf16_lossy(&buf[..n]);
    // desktop, taskbars, Start/Search hosts and menus never count as "covering"
    if matches!(cls.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Windows.UI.Core.CoreWindow" | "#32768" | "tooltips_class32") {
        return true.into();
    }
    // the visible frame, without the invisible resize borders
    let mut w = RECT::default();
    if DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut w as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
        let _ = GetWindowRect(h, &mut w);
    }
    let [l, t, r, b] = s.r;
    if w.left < r && w.right > l && w.top < b && w.bottom > t && w.right - w.left > 40 && w.bottom - w.top > 40 {
        s.hit = true;
        return false.into();
    }
    true.into()
}

fn covered(r: [i32; 4]) -> bool {
    let mut s = Scan { r, own: std::process::id(), hit: false };
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut s as *mut _ as isize));
    }
    s.hit
}

/// Polls only while IntelliHide is on: one window walk costs well under a millisecond.
pub fn start(app: AppHandle, start_open: fn() -> bool) {
    std::thread::spawn(move || {
        let mut last: Option<bool> = None;
        loop {
            let mode = MODE.load(Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(if mode == 0 { 800 } else { 180 }));
            if mode == 0 {
                last = None;
                continue;
            }
            let Some(r) = *RECT_PX.lock().unwrap() else { continue };
            // an open Start menu reveals the dock, like the native taskbar
            let v = !start_open() && covered(r);
            if RESEND.swap(false, Ordering::SeqCst) || last != Some(v) {
                last = Some(v);
                let _ = app.emit("cover", v);
            }
        }
    });
}

