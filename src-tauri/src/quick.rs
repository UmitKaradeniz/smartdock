// Quick settings, Bluetooth devices, storage and temperatures: all through documented,
// user-level Windows APIs (no admin, no drivers).
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Registry::*;
use windows::Win32::UI::WindowsAndMessaging::*;

// ---------- registry ----------
fn reg_str(key: &str, name: &str) -> Option<String> {
    let mut buf = [0u16; 64];
    let mut n = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as _), Some(&mut n))
    };
    r.is_ok().then(|| String::from_utf16_lossy(&buf[..(n as usize / 2).saturating_sub(1)]))
}
fn reg_set_str(key: &str, name: &str, v: &str) -> bool {
    let w: Vec<u16> = v.encode_utf16().chain(Some(0)).collect();
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name), REG_SZ.0, Some(w.as_ptr() as _), (w.len() * 2) as u32).is_ok() }
}
fn reg_dword(key: &str, name: &str) -> Option<u32> {
    let mut v = 0u32;
    let mut n = 4u32;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name), RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as _), Some(&mut n)) };
    r.is_ok().then_some(v)
}
fn reg_set_dword(key: &str, name: &str, v: u32) -> bool {
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(name), REG_DWORD.0, Some(&v as *const u32 as _), 4).is_ok() }
}

// Settings > Privacy: "let apps access your microphone/camera" (store apps + desktop apps).
const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";
fn privacy_get(cap: &str) -> bool {
    reg_str(&format!("{CONSENT}{cap}"), "Value").map_or(true, |v| v != "Deny")
}
fn privacy_set(cap: &str, on: bool) -> bool {
    let v = if on { "Allow" } else { "Deny" };
    reg_set_str(&format!("{CONSENT}{cap}"), "Value", v) && reg_set_str(&format!("{CONSENT}{cap}\\NonPackaged"), "Value", v)
}

const THEME: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

// ---------- desktop icons ----------
fn defview() -> Option<HWND> {
    unsafe {
        let p = FindWindowW(w!("Progman"), PCWSTR::null()).ok()?;
        if let Ok(d) = FindWindowExW(p, HWND::default(), w!("SHELLDLL_DefView"), PCWSTR::null()) {
            return Some(d);
        }
        // after a wallpaper slideshow / Win+Tab, the icons live under a WorkerW
        let mut prev = HWND::default();
        while let Ok(wk) = FindWindowExW(HWND::default(), prev, w!("WorkerW"), PCWSTR::null()) {
            if let Ok(d) = FindWindowExW(wk, HWND::default(), w!("SHELLDLL_DefView"), PCWSTR::null()) {
                return Some(d);
            }
            prev = wk;
        }
        None
    }
}
pub fn desktop_listview() -> Option<HWND> {
    defview().and_then(|d| unsafe { FindWindowExW(d, HWND::default(), w!("SysListView32"), PCWSTR::null()).ok() })
}
fn icons_get() -> bool {
    desktop_listview().is_some_and(|l| unsafe { IsWindowVisible(l).as_bool() })
}

// ---------- keep awake ----------
static AWAKE: AtomicBool = AtomicBool::new(false);
fn awake_set(on: bool) {
    if AWAKE.swap(on, Ordering::SeqCst) == on || !on {
        return;
    }
    std::thread::spawn(|| {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
        while AWAKE.load(Ordering::SeqCst) {
            unsafe { SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) };
            std::thread::sleep(std::time::Duration::from_secs(20));
        }
    });
}

pub fn qs_get() -> Value {
    let r = crate::devices::radios();
    let rj = serde_json::to_value(&r).unwrap_or(Value::Null);
    let off = |k: &str| rj[k].as_bool() == Some(false);
    let any = !rj["wifi"].is_null() || !rj["bluetooth"].is_null();
    json!({
        "wifi": rj["wifi"], "bluetooth": rj["bluetooth"],
        "airplane": any && (rj["wifi"].is_null() || off("wifi")) && (rj["bluetooth"].is_null() || off("bluetooth")),
        "mic": privacy_get("microphone"), "camera": privacy_get("webcam"),
        "awake": AWAKE.load(Ordering::SeqCst),
        "icons": icons_get(),
        "dark": reg_dword(THEME, "AppsUseLightTheme") == Some(0),
    })
}

pub fn qs_set(kind: &str, on: bool) -> bool {
    match kind {
        "wifi" | "bluetooth" => crate::devices::set_radio(kind, on),
        "airplane" => {
            let a = crate::devices::set_radio("wifi", !on);
            let b = crate::devices::set_radio("bluetooth", !on);
            a || b
        }
        "mic" => privacy_set("microphone", on),
        "camera" => privacy_set("webcam", on),
        "awake" => {
            awake_set(on);
            true
        }
        "icons" => {
            if icons_get() != on {
                // the desktop's own "Show desktop icons" command
                if let Some(d) = defview() {
                    unsafe { SendMessageW(d, WM_COMMAND, WPARAM(0x7402), LPARAM(0)) };
                }
            }
            true
        }
        "dark" => {
            let v = if on { 0 } else { 1 };
            let ok = reg_set_dword(THEME, "AppsUseLightTheme", v) && reg_set_dword(THEME, "SystemUsesLightTheme", v);
            let s: Vec<u16> = "ImmersiveColorSet".encode_utf16().chain(Some(0)).collect();
            unsafe {
                let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(s.as_ptr() as isize), SMTO_ABORTIFHUNG, 200, None);
            }
            ok
        }
        _ => false,
    }
}

// ---------- bluetooth devices ----------
pub fn bt_devices() -> Vec<Value> {
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
    use windows::Devices::Enumeration::DeviceInformation;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let audio = crate::bt::audio_names();
    let classic = BluetoothDevice::GetDeviceSelectorFromPairingState(true).ok();
    let le = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true).ok();
    for (sel, is_le) in [(classic, false), (le, true)] {
        let Some(sel) = sel else { continue };
        let Ok(list) = DeviceInformation::FindAllAsyncAqsFilter(&sel).and_then(|a| a.get()) else { continue };
        for d in list {
            let name = d.Name().map(|n| n.to_string()).unwrap_or_default();
            let id = d.Id().unwrap_or_default();
            if name.is_empty() || !seen.insert(name.clone()) {
                continue;
            }
            let (on, av) = if is_le {
                (BluetoothLEDevice::FromIdAsync(&id).and_then(|a| a.get()).and_then(|x| x.ConnectionStatus()).ok() == Some(BluetoothConnectionStatus::Connected), false)
            } else {
                let x = BluetoothDevice::FromIdAsync(&id).and_then(|a| a.get()).ok();
                let on = x.as_ref().and_then(|x| x.ConnectionStatus().ok()) == Some(BluetoothConnectionStatus::Connected);
                // headphones / speakers: their audio driver may be gone while disconnected, the class stays
                let av = x.and_then(|x| x.ClassOfDevice().and_then(|c| c.MajorClass()).ok()) == Some(windows::Devices::Bluetooth::BluetoothMajorClass::AudioVideo);
                (on, av)
            };
            let a = av || audio.iter().any(|n| { let (x, y) = (n.to_lowercase(), name.to_lowercase()); x.contains(&y) || y.contains(&x) });
            out.push(json!({"id": id.to_string(), "name": name, "connected": on, "audio": a}));
        }
    }
    out.sort_by_key(|v| (!v["connected"].as_bool().unwrap_or(false), v["name"].as_str().unwrap_or("").to_lowercase()));
    out
}

// ---------- storage ----------
pub fn storage_info() -> Value {
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let (mut free, mut total) = (0u64, 0u64);
    unsafe {
        let _ = GetDiskFreeSpaceExW(w!("C:\\"), None, Some(&mut total), Some(&mut free));
    }
    json!({"drive": "C:", "total": total, "free": free})
}

static SCAN: Mutex<Option<(std::time::Instant, Value)>> = Mutex::new(None);

fn dir_size(p: &std::path::Path, depth: u32) -> u64 {
    use std::os::windows::fs::MetadataExt;
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    let mut sum = 0;
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if m.file_attributes() & 0x400 != 0 {
            continue; // reparse point: junction/symlink/cloud placeholder, counted where it really lives
        }
        if m.is_dir() {
            if depth < 64 {
                sum += dir_size(&e.path(), depth + 1);
            }
        } else {
            sum += m.len();
        }
    }
    sum
}

/// Walks every file on C: once (15-20 s); the result is kept for 5 minutes.
pub fn storage_scan() -> Value {
    if let Some((t, v)) = SCAN.lock().unwrap().as_ref() {
        if t.elapsed().as_secs() < 300 {
            return v.clone();
        }
    }
    use std::os::windows::fs::MetadataExt;
    let mut parts: Vec<(String, u64)> = Vec::new();
    let mut loose = 0u64;
    if let Ok(rd) = std::fs::read_dir("C:\\") {
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            let name = e.file_name().to_string_lossy().to_string();
            if m.file_attributes() & 0x400 != 0 {
                continue;
            }
            if m.is_dir() {
                parts.push((name, dir_size(&e.path(), 1)));
            } else if m.len() > 512 << 20 {
                parts.push((name, m.len())); // pagefile.sys, hiberfil.sys...
            } else {
                loose += m.len();
            }
        }
    }
    parts.sort_by(|a, b| b.1.cmp(&a.1));
    let v = json!({"parts": parts.iter().map(|(n, s)| json!({"name": n, "bytes": s})).collect::<Vec<_>>(), "loose": loose});
    *SCAN.lock().unwrap() = Some((std::time::Instant::now(), v.clone()));
    v
}

// ---------- temperatures ----------
/// ACPI thermal zones via the "Thermal Zone Information" performance counter (no admin).
/// Many desktops expose none; laptops usually expose one or two.
fn acpi_temps() -> Vec<Value> {
    use windows::Win32::System::Performance::*;
    let mut out = Vec::new();
    unsafe {
        let mut q = 0isize;
        if PdhOpenQueryW(PCWSTR::null(), 0, &mut q) != 0 {
            return out;
        }
        let mut c = 0isize;
        if PdhAddEnglishCounterW(q, w!("\\Thermal Zone Information(*)\\Temperature"), 0, &mut c) == 0 && PdhCollectQueryData(q) == 0 {
            let (mut size, mut count) = (0u32, 0u32);
            let _ = PdhGetFormattedCounterArrayW(c, PDH_FMT_DOUBLE, &mut size, &mut count, None);
            if size > 0 {
                let mut buf = vec![0u8; size as usize];
                let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                if PdhGetFormattedCounterArrayW(c, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) == 0 {
                    for i in 0..count as usize {
                        let it = &*items.add(i);
                        let k = it.FmtValue.Anonymous.doubleValue;
                        let name = it.szName.to_string().unwrap_or_default();
                        if k > 200.0 {
                            out.push(json!({"name": name, "c": ((k - 273.15) * 10.0).round() / 10.0}));
                        }
                    }
                }
            }
        }
        let _ = PdhCloseQuery(q);
    }
    out
}

// ---------- LibreHardwareMonitor ----------
// LHM (running elevated, its own driver) serves every sensor at /data.json when its
// "Remote Web Server" option is on. We only read it; no driver or admin rights here.
fn lhm_val(v: &str) -> Option<f64> {
    v.split_whitespace().next()?.replace(',', ".").parse().ok()
}
fn lhm_walk(n: &Value, hw: &str, out: &mut Vec<(String, String, f64)>) {
    let id = n["SensorId"].as_str().unwrap_or("");
    let ty = n["Type"].as_str().unwrap_or("");
    if ty == "Temperature" || id.contains("/temperature/") {
        if let Some(c) = n["Value"].as_str().and_then(lhm_val) {
            // the sensor id names its hardware ("/gpu-intel/...", "/intelcpu/..."); Intel Arc's image is just "intel.png"
            let kind = if id.starts_with("/gpu") { "gpu" } else if id.contains("cpu/") { "cpu" } else { hw };
            out.push((kind.to_string(), n["Text"].as_str().unwrap_or("").to_string(), c));
        }
    }
    // hardware nodes carry an image (cpu.png, nvidia.png, hdd.png, mainboard.png...)
    let img = n["ImageURL"].as_str().unwrap_or("");
    let here = if img.contains("cpu") { "cpu" } else if img.contains("nvidia") || img.contains("ati") || img.contains("intel") && img.contains("gpu") || img.contains("gpu") { "gpu" }
        else if img.contains("hdd") || img.contains("nvme") { "disk" } else if img.contains("mainboard") || img.contains("chip") { "board" } else { hw };
    if let Some(ch) = n["Children"].as_array() {
        for c in ch {
            lhm_walk(c, here, out);
        }
    }
}
fn lhm() -> Option<Value> {
    let v: Value = ureq::get("http://127.0.0.1:8085/data.json").timeout(std::time::Duration::from_millis(1500)).call().ok()?.into_json().ok()?;
    let mut all = Vec::new();
    lhm_walk(&v, "", &mut all);
    if all.is_empty() {
        return None;
    }
    let pick = |hw: &str, names: &[&str]| -> Option<f64> {
        let xs: Vec<_> = all.iter().filter(|(h, _, _)| h == hw).collect();
        names.iter().find_map(|n| xs.iter().find(|(_, t, _)| t.contains(n)).map(|x| x.2)).or_else(|| xs.iter().map(|x| x.2).reduce(f64::max))
    };
    let cpu = pick("cpu", &["Package", "Tctl", "Tdie", "Core Max", "Core Average"]);
    let mut zones = Vec::new();
    for (hw, label, names) in [("cpu", "CPU", &["Package", "Tctl", "Tdie", "Core Max"][..]), ("gpu", "Ekran kartı", &["GPU Core", "Core"][..]), ("board", "Anakart", &["Motherboard", "System"][..]), ("disk", "Disk", &["Temperature", "Composite"][..])] {
        if let Some(c) = pick(hw, names) {
            zones.push(json!({"name": label, "c": (c * 10.0).round() / 10.0}));
        }
    }
    Some(json!({"source": "lhm", "cpu": cpu, "zones": zones}))
}

pub fn lhm_exe() -> Option<std::path::PathBuf> {
    let la = std::env::var("LOCALAPPDATA").ok()?;
    let pk = std::path::Path::new(&la).join(r"Microsoft\WinGet\Packages");
    std::fs::read_dir(&pk).ok()?.flatten().find(|e| e.file_name().to_string_lossy().starts_with("LibreHardwareMonitor")).map(|e| e.path().join("LibreHardwareMonitor.exe")).filter(|p| p.exists())
        .or_else(|| Some(std::path::PathBuf::from(r"C:\Program Files\LibreHardwareMonitor\LibreHardwareMonitor.exe")).filter(|p| p.exists()))
}

pub static LHM_STATE: Mutex<Option<(std::time::Instant, bool, bool)>> = Mutex::new(None);

/// Real sensors from LibreHardwareMonitor when it runs; ACPI thermal zones otherwise.
pub fn temps() -> Value {
    if let Some(v) = lhm() {
        return v;
    }
    let z = acpi_temps();
    // the folder scan and the schtasks child process ran on every 5 s poll; a minute is enough
    // (lhm_setup clears this so its result shows at once)
    let (lhm, task) = {
        let mut c = LHM_STATE.lock().unwrap();
        match *c {
            Some((t, l, k)) if t.elapsed() < std::time::Duration::from_secs(60) => (l, k),
            _ => {
                let v = (lhm_exe().is_some(), crate::desk::lhm_task_exists());
                *c = Some((std::time::Instant::now(), v.0, v.1));
                v
            }
        }
    };
    json!({"source": "acpi", "lhm": lhm, "task": task, "cpu": Value::Null, "zones": z})
}
