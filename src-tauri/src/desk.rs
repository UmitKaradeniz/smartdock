// Desktop icons and the LibreHardwareMonitor background service.
use windows::core::{Interface, VARIANT};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::*;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::*;

/// Icons left under the dock when its reserved strip appeared: Explorer does not re-flow the
/// desktop when the work area shrinks. Only those icons move, each to the first free grid cell
/// (column by column, like Windows itself); the rest of the user's layout stays as it is.
/// Uses IFolderView::SelectAndPositionItems, the supported way since Windows 10 1809.
pub fn fix_icons(dock: HWND) {
    let dock = dock.0 as isize; // HWND is not Send
    std::thread::spawn(move || unsafe {
        let dock = HWND(dock as _);
        std::thread::sleep(std::time::Duration::from_millis(800)); // let Explorer apply the new work area
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _ = run(dock);
        CoUninitialize();
    });
}

unsafe fn run(dock: HWND) -> windows::core::Result<()> {
    let sw: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;
    let loc = VARIANT::from(0i32); // CSIDL_DESKTOP
    let mut hwnd = 0i32;
    let disp = sw.FindWindowSW(&loc, &VARIANT::default(), SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?;
    let sp: IServiceProvider = disp.cast()?;
    let browser: IShellBrowser = sp.QueryService(&SID_STopLevelBrowser)?;
    let fv: IFolderView = browser.QueryActiveShellView()?.cast()?;
    if fv.GetAutoArrange().is_ok() {
        return Ok(()); // auto-arrange: Explorer lays them out itself
    }
    let lv = crate::quick::desktop_listview().ok_or(windows::core::Error::empty())?;

    // work area of the dock's monitor, in the desktop list view's coordinates
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let _ = GetMonitorInfoW(MonitorFromWindow(dock, MONITOR_DEFAULTTONEAREST), &mut mi);
    let mut a = POINT { x: mi.rcWork.left, y: mi.rcWork.top };
    let mut b = POINT { x: mi.rcWork.right, y: mi.rcWork.bottom };
    let _ = ScreenToClient(lv, &mut a);
    let _ = ScreenToClient(lv, &mut b);
    let work = RECT { left: a.x, top: a.y, right: b.x, bottom: b.y };

    let mut sp_ = POINT::default();
    fv.GetSpacing(&mut sp_)?;
    let (cw, ch) = (sp_.x.max(1), sp_.y.max(1));

    let en: IEnumIDList = fv.Items(SVGIO_ALLVIEW)?;
    let mut items: Vec<(*mut ITEMIDLIST, POINT)> = Vec::new();
    loop {
        let mut p = [std::ptr::null_mut(); 1];
        let mut got = 0u32;
        if en.Next(&mut p, Some(&mut got)).is_err() || got == 0 {
            break;
        }
        if let Ok(pt) = fv.GetItemPosition(p[0]) {
            items.push((p[0], pt));
        } else {
            CoTaskMemFree(Some(p[0] as _));
        }
    }
    // only icons on this monitor
    let mine: Vec<_> = items.iter().filter(|(_, p)| p.x >= work.left - cw / 2 && p.x < work.right).collect();
    if let (Some(x0), Some(y0)) = (mine.iter().map(|(_, p)| p.x).min(), mine.iter().map(|(_, p)| p.y).min()) {
        let x0 = x0.max(work.left);
        let y0 = y0.max(work.top);
        let rows = ((work.bottom - y0) / ch).max(1);
        let cols = ((work.right - x0) / cw).max(1);
        let cell = |p: &POINT| ((p.x - x0 + cw / 2).div_euclid(cw), (p.y - y0 + ch / 2).div_euclid(ch));
        let bad = |p: &POINT| p.y + ch > work.bottom || p.y < work.top;
        let mut used: std::collections::HashSet<(i32, i32)> = mine.iter().filter(|(_, p)| !bad(p)).map(|(_, p)| cell(p)).collect();
        for (pidl, p) in mine.iter().filter(|(_, p)| bad(p)) {
            let free = (0..cols).flat_map(|c| (0..rows).map(move |r| (c, r))).find(|k| !used.contains(k));
            let Some((c, r)) = free else { break };
            used.insert((c, r));
            let to = POINT { x: x0 + c * cw, y: y0 + r * ch };
            let _ = p;
            let _ = fv.SelectAndPositionItems(1, pidl as *const _ as *const *const ITEMIDLIST, Some(&to), SVSI_POSITIONITEM.0 as u32);
        }
    }
    for (p, _) in items {
        CoTaskMemFree(Some(p as _));
    }
    Ok(())
}

// ---------- LibreHardwareMonitor in the background ----------
const TASK: &str = "smartdock LibreHardwareMonitor";

fn hidden(cmd: &str, args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(cmd).args(args).creation_flags(0x0800_0000 /* CREATE_NO_WINDOW */).output().ok()
}

fn lhm_running() -> bool {
    hidden("tasklist", &["/FI", "IMAGENAME eq LibreHardwareMonitor.exe", "/NH"])
        .is_some_and(|o| String::from_utf8_lossy(&o.stdout).contains("LibreHardwareMonitor.exe"))
}

pub fn lhm_task_exists() -> bool {
    hidden("schtasks", &["/Query", "/TN", TASK]).is_some_and(|o| o.status.success())
}

/// Starts LHM silently through its elevated logon task (no UAC prompt, no window).
pub fn lhm_ensure() {
    std::thread::spawn(|| {
        if !lhm_running() && lhm_task_exists() {
            let _ = hidden("schtasks", &["/Run", "/TN", TASK]);
        }
    });
}

/// One-time setup (one UAC prompt): LHM starts minimized to the tray, keeps its local web
/// server on, and a logon task runs it elevated so it never asks again.
pub fn lhm_setup() -> Result<(), String> {
    let exe = crate::quick::lhm_exe().ok_or("LibreHardwareMonitor bulunamadı")?;
    let cfg = exe.with_file_name("LibreHardwareMonitor.config");
    let mut s = std::fs::read_to_string(&cfg).unwrap_or_else(|_| "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<configuration>\n  <appSettings>\n  </appSettings>\n</configuration>\n".into());
    for (k, v) in [("startMinMenuItem", "true"), ("minTrayMenuItem", "true"), ("minCloseMenuItem", "true"), ("runWebServerMenuItem", "true"), ("listenerPort", "8085")] {
        let key = format!("key=\"{k}\"");
        if let Some(i) = s.find(&key) {
            let end = s[i..].find("/>").map(|e| i + e).unwrap_or(i);
            s.replace_range(i..end, &format!("key=\"{k}\" value=\"{v}\" "));
        } else if let Some(i) = s.find("</appSettings>") {
            s.insert_str(i, &format!("  <add key=\"{k}\" value=\"{v}\" />\n  "));
        }
    }
    std::fs::write(&cfg, s).map_err(|e| e.to_string())?;
    // schtasks needs admin for /RL HIGHEST: ask once via UAC
    let args = format!("/Create /F /TN \"{TASK}\" /SC ONLOGON /RL HIGHEST /DELAY 0000:15 /TR \"\\\"{}\\\"\"", exe.display());
    let ok = unsafe {
        ShellExecuteW(HWND::default(), &windows::core::HSTRING::from("runas"), &windows::core::HSTRING::from("schtasks.exe"), &windows::core::HSTRING::from(args), None, windows::Win32::UI::WindowsAndMessaging::SW_HIDE)
    };
    if ok.0 as isize <= 32 {
        return Err("Yönetici onayı verilmedi".into());
    }
    // wait for the task, then start it now
    for _ in 0..40 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if lhm_task_exists() {
            let _ = hidden("schtasks", &["/Run", "/TN", TASK]);
            return Ok(());
        }
    }
    Err("Görev oluşturulamadı".into())
}
