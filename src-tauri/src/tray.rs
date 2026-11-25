// System tray (notification area) icons, so the dock can show the "hidden icons" flyout itself
// while the Windows taskbar is hidden. systray-util spies on Shell_NotifyIcon traffic (and
// forwards it, so Explorer's own tray keeps working); clicks go straight to the owning app.
use serde::Serialize;
use std::sync::Mutex;
use systray_util::{Systray, SystrayEvent, SystrayIcon};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::*;

struct Ico {
    hwnd: isize,
    uid: u32,
    cb: u32,
    ver: Option<u32>,
    tip: String,
    png: Vec<u8>,
    hash: String,
    visible: bool,
}

#[derive(Serialize)]
pub struct Item {
    id: String,
    tip: String,
    img: String, // hash, for cache busting
}

static ICONS: Mutex<Vec<(String, Ico)>> = Mutex::new(Vec::new());

fn ico(i: &SystrayIcon) -> Option<Ico> {
    let png = i.to_image_format(image::ImageFormat::Png).unwrap_or_default();
    Some(Ico {
        hwnd: i.window_handle?,
        uid: i.uid?,
        cb: i.callback_message?,
        ver: i.version,
        tip: i.tooltip.clone(),
        png,
        hash: i.icon_image_hash.clone().unwrap_or_default(),
        visible: i.is_visible,
    })
}

/// Starts the spy thread; `changed` runs after every add/update/remove.
pub fn start(changed: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        let Ok(mut st) = Systray::new() else { return };
        while let Some(ev) = st.events_blocking() {
            let mut v = ICONS.lock().unwrap();
            match ev {
                SystrayEvent::IconAdd(i) | SystrayEvent::IconUpdate(i) => {
                    let id = i.stable_id.to_string();
                    match ico(&i) {
                        Some(x) => match v.iter_mut().find(|(k, _)| *k == id) {
                            Some(slot) => slot.1 = x,
                            None => v.push((id, x)),
                        },
                        None => v.retain(|(k, _)| *k != id),
                    }
                }
                SystrayEvent::IconRemove(id) => {
                    let id = id.to_string();
                    v.retain(|(k, _)| *k != id);
                }
            }
            drop(v);
            changed();
        }
    });
}

pub fn list() -> Vec<Item> {
    let mut v = ICONS.lock().unwrap();
    // drop icons whose app died without removing them (Explorer does the same lazily)
    v.retain(|(_, i)| unsafe { IsWindow(HWND(i.hwnd as _)).as_bool() });
    v.iter()
        .filter(|(_, i)| i.visible && !i.png.is_empty())
        .map(|(k, i)| Item { id: k.clone(), tip: i.tip.clone(), img: i.hash.clone() })
        .collect()
}

pub fn png(id: &str) -> Option<Vec<u8>> {
    ICONS.lock().unwrap().iter().find(|(k, _)| k == id).map(|(_, i)| i.png.clone())
}

/// Same messages Explorer sends for a click (NOTIFYICON_VERSION 0-4).
pub fn click(id: &str, right: bool) {
    let v = ICONS.lock().unwrap();
    let Some((_, i)) = v.iter().find(|(k, _)| k == id) else { return };
    let (h, uid, cb, ver) = (HWND(i.hwnd as _), i.uid, i.cb, i.ver.unwrap_or(0));
    drop(v);
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, Some(&mut pid));
        // let its menu/window take focus (and close again on an outside click)
        let _ = AllowSetForegroundWindow(pid);
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        let send = |m: u32| {
            let (wp, lp) = if ver > 3 {
                (((pt.y as u32 & 0xffff) << 16) | (pt.x as u32 & 0xffff), ((uid & 0xffff) << 16) | (m & 0xffff))
            } else {
                (uid, m & 0xffff)
            };
            let _ = SendNotifyMessageW(h, cb, WPARAM(wp as usize), LPARAM(lp as i32 as isize));
        };
        let (down, up) = if right { (WM_RBUTTONDOWN, WM_RBUTTONUP) } else { (WM_LBUTTONDOWN, WM_LBUTTONUP) };
        send(down);
        send(up);
        if ver >= 3 {
            send(if right { WM_CONTEXTMENU } else { 0x400 /* NIN_SELECT */ });
        }
    }
}
