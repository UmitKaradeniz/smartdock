// Top-level window enumeration and control (the "running apps" half of the dock).
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
    SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HDC,
    SRCCOPY,
};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_TERMINATE,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::*;

#[link(name = "user32")]
extern "system" {
    fn PrintWindow(hwnd: HWND, hdcblt: HDC, nflags: u32) -> BOOL;
}

#[derive(Serialize, Clone, PartialEq)]
pub struct Win {
    pub hwnd: isize,
    pub title: String,
    pub exe: String,
    pub aumid: String,
    pub pid: u32,
    pub minimized: bool,
    /// lives on another virtual desktop (listed only with ALL_DESKTOPS)
    pub other: bool,
}

pub static ALL_DESKTOPS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

thread_local! {
    // the list is read from the UI thread and the watcher thread; each keeps its own manager
    static VDM: Option<windows::Win32::UI::Shell::IVirtualDesktopManager> = unsafe {
        use windows::Win32::System::Com::*;
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&windows::Win32::UI::Shell::VirtualDesktopManager, None, CLSCTX_ALL).ok()
    };
}

/// The shell cloaks windows of other virtual desktops; other cloaked windows (suspended Store
/// apps, shell surfaces) are on the current desktop and stay hidden.
fn on_other_desktop(h: HWND) -> bool {
    VDM.with(|m| unsafe {
        let Some(m) = m else { return false };
        match m.GetWindowDesktopId(h) {
            Ok(g) if g.to_u128() != 0 => !m.IsWindowOnCurrentVirtualDesktop(h).map(|b| b.as_bool()).unwrap_or(true),
            _ => false,
        }
    })
}

unsafe extern "system" fn collect(h: HWND, lp: LPARAM) -> BOOL {
    let v = &mut *(lp.0 as *mut Vec<HWND>);
    v.push(h);
    TRUE
}

pub fn exe_of_pid(pid: u32) -> String {
    unsafe {
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut n = buf.len() as u32;
        let r = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut n);
        let _ = CloseHandle(p);
        if r.is_ok() { String::from_utf16_lossy(&buf[..n as usize]) } else { String::new() }
    }
}

fn aumid_of(h: HWND, pid: u32) -> String {
    let w = unsafe {
        SHGetPropertyStoreForWindow::<_, IPropertyStore>(h)
            .and_then(|ps| ps.GetValue(&PKEY_AppUserModel_ID))
            .map(|v| v.to_string())
            .unwrap_or_default()
    };
    if !w.is_empty() {
        return w;
    }
    // Packaged (MSIX/Store) desktop apps such as WhatsApp don't tag their windows; the process
    // knows its AUMID. Without it the icon was looked up from the locked WindowsApps exe.
    unsafe {
        use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 256];
        let mut n = buf.len() as u32;
        let ok = GetApplicationUserModelId(p, &mut n, windows::core::PWSTR(buf.as_mut_ptr())).is_ok();
        let _ = windows::Win32::Foundation::CloseHandle(p);
        if ok { String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)]) } else { String::new() }
    }
}

/// None: not a taskbar window; Some(other_desktop).
fn is_app_window(h: HWND, own: isize) -> Option<bool> {
    unsafe {
        if h.0 as isize == own || !IsWindowVisible(h).as_bool() {
            return None;
        }
        if GetWindow(h, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false) {
            return None;
        }
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0 {
            return None;
        }
        // InternalGetWindowText reads the stored title; GetWindowTextLength sends a message and
        // waited on a hung window (the one being ended), stalling the dock's UI thread
        let mut b = [0u16; 2];
        if InternalGetWindowText(h, &mut b) == 0 {
            return None;
        }
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
        const DWM_CLOAKED_SHELL: u32 = 2;
        if cloaked == 0 {
            Some(false)
        } else if cloaked & DWM_CLOAKED_SHELL != 0 && ALL_DESKTOPS.load(std::sync::atomic::Ordering::Relaxed) && on_other_desktop(h) {
            Some(true)
        } else {
            None
        }
    }
}

// per window: (pid, exe, aumid, polls seen). The exe of a pid never changes; apps may tag a
// window with its AUMID just after creating it, so a new window is read on every poll for a
// few seconds, an older one every ~5 s.
static META: Mutex<Option<HashMap<isize, (u32, String, String, u32)>>> = Mutex::new(None);

pub fn list(own: isize) -> Vec<Win> {
    let mut hs: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut hs as *mut _ as isize));
    }
    let mut guard = META.lock().unwrap();
    let meta = guard.get_or_insert_with(HashMap::new);
    meta.retain(|k, _| hs.iter().any(|h| h.0 as isize == *k));
    let mut out = Vec::new();
    for h in hs {
        let Some(other) = is_app_window(h, own) else { continue };
        unsafe {
            let mut buf = [0u16; 256];
            let n = InternalGetWindowText(h, &mut buf).max(0);
            let title = String::from_utf16_lossy(&buf[..n as usize]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            let e = meta.entry(h.0 as isize).or_insert_with(|| (pid, exe_of_pid(pid), String::new(), 0));
            if e.0 != pid {
                *e = (pid, exe_of_pid(pid), String::new(), 0);
            }
            let lower = e.1.to_lowercase();
            if lower.ends_with("\\textinputhost.exe") || lower.ends_with("\\shellexperiencehost.exe") || lower.ends_with("\\smartdock.exe") {
                continue;
            }
            // a hung window would block the property store call; keep the AUMID we already have
            if (e.3 < 8 || e.3 % 8 == 0) && !IsHungAppWindow(h).as_bool() {
                e.2 = aumid_of(h, pid);
            }
            e.3 = e.3.wrapping_add(1);
            out.push(Win { hwnd: h.0 as isize, title, exe: e.1.clone(), aumid: e.2.clone(), pid, minimized: IsIconic(h).as_bool(), other });
        }
    }
    out
}

pub fn foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// Click on a running app: focus it, or minimize it when it is already in front.
pub fn activate(h: isize, minimize: bool) {
    unsafe {
        let hw = HWND(h as *mut _);
        if minimize && !IsIconic(hw).as_bool() {
            let _ = ShowWindow(hw, SW_MINIMIZE);
            return;
        }
        if IsIconic(hw).as_bool() {
            let _ = ShowWindow(hw, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hw);
    }
}

/// "End task" like the Windows taskbar's: the app's processes and everything they started
/// (helpers, renderers), children first so nothing respawns. Explorer and the dock are spared.
pub fn kill(pids: &[u32]) {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    let me = std::process::id();
    // (pid, parent, exe name) of every process
    let mut all: Vec<(u32, u32, String)> = Vec::new();
    unsafe {
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut ok = Process32FirstW(snap, &mut e).is_ok();
            while ok {
                let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                all.push((e.th32ProcessID, e.th32ParentProcessID, String::from_utf16_lossy(&e.szExeFile[..n]).to_lowercase()));
                ok = Process32NextW(snap, &mut e).is_ok();
            }
            let _ = CloseHandle(snap);
        }
    }
    let spared = |p: u32| p == me || p <= 4 || all.iter().any(|(q, _, n)| *q == p && matches!(n.as_str(), "explorer.exe" | "smartdock.exe" | "applicationframehost.exe"));
    let mut tree: Vec<u32> = pids.iter().copied().filter(|&p| !spared(p)).collect();
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i];
        for (p, pp, _) in &all {
            if *pp == parent && !tree.contains(p) && !spared(*p) {
                tree.push(*p);
            }
        }
        i += 1;
    }
    for &pid in tree.iter().rev() {
        unsafe {
            if let Ok(p) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(p, 1);
                let _ = CloseHandle(p);
            }
        }
    }
}

/// Last good preview per window. A minimized window is not drawn, so nothing can be captured
/// from it; like the taskbar, the dock shows the frame taken just before it was minimized.
static SHOTS: std::sync::Mutex<Vec<(isize, Vec<u8>)>> = std::sync::Mutex::new(Vec::new());
const SHOT_KEEP: usize = 32;

fn keep_shot(hwnd: isize, png: &[u8]) {
    let mut v = SHOTS.lock().unwrap();
    v.retain(|(h, _)| *h != hwnd && unsafe { IsWindow(HWND(*h as *mut _)).as_bool() });
    v.push((hwnd, png.to_vec()));
    let n = v.len();
    if n > SHOT_KEEP {
        v.drain(..n - SHOT_KEEP);
    }
}

pub fn preview_png(hwnd: isize, max_w: i32) -> Option<Vec<u8>> {
    let hw = HWND(hwnd as *mut _);
    unsafe {
        if !IsWindow(hw).as_bool() {
            return None;
        }
        if IsIconic(hw).as_bool() {
            return SHOTS.lock().unwrap().iter().find(|(h, _)| *h == hwnd).map(|(_, b)| b.clone());
        }
    }
    let png = capture(hwnd, max_w)?;
    keep_shot(hwnd, &png);
    Some(png)
}

/// Called as a window starts to minimize, while it is still drawn.
pub fn remember(hwnd: isize) {
    if let Some(png) = capture(hwnd, 260) {
        keep_shot(hwnd, &png);
    }
}

fn capture(hwnd: isize, max_w: i32) -> Option<Vec<u8>> {
    unsafe {
        let hw = HWND(hwnd as *mut _);
        let mut r = RECT::default();
        if DwmGetWindowAttribute(hw, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).is_err()
            && GetWindowRect(hw, &mut r).is_err()
        {
            return None;
        }
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 16 || h <= 16 {
            return None;
        }
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return None;
        }
        let src_dc = CreateCompatibleDC(screen_dc);
        let src_bmp = CreateCompatibleBitmap(screen_dc, w, h);
        if src_dc.0.is_null() || src_bmp.0.is_null() {
            if !src_bmp.0.is_null() { let _ = DeleteObject(src_bmp); }
            if !src_dc.0.is_null() { let _ = DeleteDC(src_dc); }
            ReleaseDC(None, screen_dc);
            return None;
        }
        let old_src = SelectObject(src_dc, src_bmp);
        let mut ok = PrintWindow(hw, src_dc, 2).as_bool();
        if !ok {
            ok = PrintWindow(hw, src_dc, 0).as_bool();
        }
        if !ok {
            SelectObject(src_dc, old_src);
            let _ = DeleteObject(src_bmp);
            let _ = DeleteDC(src_dc);
            ReleaseDC(None, screen_dc);
            return None;
        }

        let mw = max_w.clamp(80, 480) as f64;
        let mh = ((max_w.clamp(80, 480) * 3) / 4).max(120) as f64;
        let scale = (mw / w as f64).min(mh / h as f64).min(1.0);
        let tw = ((w as f64 * scale).round() as i32).max(1);
        let th = ((h as f64 * scale).round() as i32).max(1);

        let dst_dc = CreateCompatibleDC(screen_dc);
        let dst_bmp = CreateCompatibleBitmap(screen_dc, tw, th);
        let mut png_out = None;
        if !dst_dc.0.is_null() && !dst_bmp.0.is_null() {
            let old_dst = SelectObject(dst_dc, dst_bmp);
            let _ = SetStretchBltMode(dst_dc, HALFTONE);
            let _ = SetBrushOrgEx(dst_dc, 0, 0, None);
            if StretchBlt(dst_dc, 0, 0, tw, th, src_dc, 0, 0, w, h, SRCCOPY).as_bool() {
                let mut bi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: tw,
                        biHeight: -th,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut buf = vec![0u8; (tw * th * 4) as usize];
                if GetDIBits(dst_dc, dst_bmp, 0, th as u32, Some(buf.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS) != 0 {
                    let mut lit = 0usize;
                    for p in buf.chunks_mut(4) {
                        p.swap(0, 2);
                        p[3] = 255;
                        if p[0] > 12 || p[1] > 12 || p[2] > 12 {
                            lit += 1;
                        }
                    }
                    // an all-black frame (window mid-animation, GPU surface not ready) is no preview
                    if lit * 50 < buf.len() / 4 {
                        SelectObject(dst_dc, old_dst);
                        let _ = DeleteObject(dst_bmp);
                        let _ = DeleteDC(dst_dc);
                        SelectObject(src_dc, old_src);
                        let _ = DeleteObject(src_bmp);
                        let _ = DeleteDC(src_dc);
                        ReleaseDC(None, screen_dc);
                        return None;
                    }
                    let mut out = Vec::new();
                    let ok_png = (|| -> Option<()> {
                        let mut enc = png::Encoder::new(&mut out, tw as u32, th as u32);
                        enc.set_color(png::ColorType::Rgba);
                        enc.set_depth(png::BitDepth::Eight);
                        let mut wr = enc.write_header().ok()?;
                        wr.write_image_data(&buf).ok()?;
                        Some(())
                    })()
                    .is_some();
                    if ok_png {
                        png_out = Some(out);
                    }
                }
            }
            SelectObject(dst_dc, old_dst);
        }
        if !dst_bmp.0.is_null() { let _ = DeleteObject(dst_bmp); }
        if !dst_dc.0.is_null() { let _ = DeleteDC(dst_dc); }
        SelectObject(src_dc, old_src);
        let _ = DeleteObject(src_bmp);
        let _ = DeleteDC(src_dc);
        ReleaseDC(None, screen_dc);
        png_out
    }
}
