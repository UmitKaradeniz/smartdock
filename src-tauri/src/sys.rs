// System stats, screen time, file index and AI-plan usage.
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use windows::core::HSTRING;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;

fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

struct Prev {
    idle: u64,
    total: u64,
    rx: u64,
    tx: u64,
    at: Option<Instant>,
}
static PREV: Mutex<Prev> = Mutex::new(Prev { idle: 0, total: 0, rx: 0, tx: 0, at: None });

#[derive(Serialize)]
pub struct Stats {
    cpu: f32,
    ram_used: u64,
    ram_total: u64,
    battery: Option<u8>,
    charging: bool,
    disk_free: u64,
    disk_total: u64,
    down: f64,
    up: f64,
}

fn net_bytes() -> (u64, u64) {
    unsafe {
        let mut t: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut t).is_err() || t.is_null() {
            return (0, 0);
        }
        let tb = &*t;
        let rows = std::slice::from_raw_parts(tb.Table.as_ptr(), tb.NumEntries as usize);
        let (mut rx, mut tx) = (0u64, 0u64);
        for r in rows {
            // physical, connected interfaces only (skip loopback/virtual filter duplicates)
            if r.Type == 24 || r.InterfaceAndOperStatusFlags._bitfield & 1 == 0 || r.OperStatus.0 != 1 {
                continue;
            }
            rx += r.InOctets;
            tx += r.OutOctets;
        }
        FreeMibTable(t as *const _);
        (rx, tx)
    }
}

pub fn stats() -> Stats {
    let (mut i, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe {
        let _ = GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u));
    }
    let (idle, total) = (ft(i), ft(k) + ft(u));
    let (rx, tx) = net_bytes();
    let mut p = PREV.lock().unwrap();
    let cpu = if p.total > 0 && total > p.total {
        let dt = (total - p.total) as f64;
        (100.0 * (1.0 - (idle - p.idle) as f64 / dt)).clamp(0.0, 100.0) as f32
    } else {
        0.0
    };
    let now = Instant::now();
    let (down, up) = match p.at {
        Some(a) if rx >= p.rx && tx >= p.tx => {
            let s = now.duration_since(a).as_secs_f64().max(0.2);
            ((rx - p.rx) as f64 / s, (tx - p.tx) as f64 / s)
        }
        _ => (0.0, 0.0),
    };
    *p = Prev { idle, total, rx, tx, at: Some(now) };
    drop(p);

    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    unsafe {
        let _ = GlobalMemoryStatusEx(&mut m);
    }
    let mut ps = SYSTEM_POWER_STATUS::default();
    unsafe {
        let _ = GetSystemPowerStatus(&mut ps);
    }
    let battery = if ps.BatteryFlag == 128 || ps.BatteryLifePercent > 100 { None } else { Some(ps.BatteryLifePercent) };
    let (mut free, mut tot) = (0u64, 0u64);
    unsafe {
        let _ = GetDiskFreeSpaceExW(&HSTRING::from("C:\\"), None, Some(&mut tot), Some(&mut free));
    }
    Stats {
        cpu,
        ram_used: m.ullTotalPhys - m.ullAvailPhys,
        ram_total: m.ullTotalPhys,
        battery,
        charging: ps.ACLineStatus == 1,
        disk_free: free,
        disk_total: tot,
        down,
        up,
    }
}

static SYS: Mutex<Option<sysinfo::System>> = Mutex::new(None);

/// Top processes by CPU or RAM, grouped by name. Only refreshed while a widget asks.
pub fn top(by_ram: bool) -> Vec<Value> {
    let mut g = SYS.lock().unwrap();
    let s = g.get_or_insert_with(sysinfo::System::new);
    s.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::new().with_cpu().with_memory().with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
    );
    let cores = s.cpus().len().max(1) as f32;
    let cores = if cores <= 1.0 { std::thread::available_parallelism().map(|n| n.get() as f32).unwrap_or(1.0) } else { cores };
    let mut m: HashMap<String, (f32, u64, String)> = HashMap::new();
    for p in s.processes().values() {
        let n = p.name().to_string_lossy().to_string();
        if n == "System Idle Process" || n == "Idle" {
            continue;
        }
        let e = m.entry(n).or_insert((0.0, 0, String::new()));
        e.0 += p.cpu_usage() / cores;
        e.1 += p.memory();
        if e.2.is_empty() {
            e.2 = p.exe().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        }
    }
    let mut v: Vec<_> = m.into_iter().collect();
    if by_ram {
        v.sort_by(|a, b| b.1 .1.cmp(&a.1 .1));
    } else {
        v.sort_by(|a, b| b.1 .0.partial_cmp(&a.1 .0).unwrap());
    }
    v.into_iter().take(5).map(|(n, (c, r, e))| json!({"name": n, "cpu": c, "ram": r, "exe": e})).collect()
}

// ---------- screen time ----------
#[derive(Default)]
pub struct ScreenTime {
    pub day: String,
    pub apps: HashMap<String, u64>,
    hours: Vec<u64>, // 24 buckets, seconds
    switches: u64,
    first: Option<u64>, // first use, seconds after local midnight
    last_app: String,
    streak: u64,
    best: u64,
    best_app: String,
    hist: Vec<Value>, // past days, newest last: {"day","total","apps"(top 12)}
}
impl ScreenTime {
    fn fresh(day: String, hist: Vec<Value>) -> Self {
        ScreenTime { day, hours: vec![0; 24], hist, ..Default::default() }
    }
    fn summary(&self) -> Value {
        let mut top: Vec<_> = self.apps.iter().collect();
        top.sort_by(|a, b| b.1.cmp(a.1));
        let apps: serde_json::Map<String, Value> = top.into_iter().take(12).map(|(k, v)| (k.clone(), json!(v))).collect();
        json!({"day": self.day, "total": self.apps.values().sum::<u64>(), "apps": apps})
    }
}
pub static SCREEN: Mutex<Option<ScreenTime>> = Mutex::new(None);

pub fn today() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let off = local_offset_secs();
    let d = (now + off) / 86400;
    format!("{}", d)
}

fn local_offset_secs() -> i64 {
    unsafe {
        let mut tz = windows::Win32::System::Time::TIME_ZONE_INFORMATION::default();
        let r = windows::Win32::System::Time::GetTimeZoneInformation(&mut tz);
        let bias = tz.Bias + if r == 2 { tz.DaylightBias } else { 0 };
        -(bias as i64) * 60
    }
}

fn secs_of_day() -> u64 {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    (now + local_offset_secs()).rem_euclid(86400) as u64
}

pub fn screen_load(path: &Path) {
    let day = today();
    let v: Value = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let mut hist: Vec<Value> = v["hist"].as_array().cloned().unwrap_or_default();
    let mut st = ScreenTime::fresh(day.clone(), Vec::new());
    if let Some(o) = v["apps"].as_object() {
        for (k, x) in o {
            st.apps.insert(k.clone(), x.as_u64().unwrap_or(0));
        }
    }
    if v["day"].as_str() == Some(day.as_str()) {
        if let Some(h) = v["hours"].as_array() {
            for (i, x) in h.iter().take(24).enumerate() {
                st.hours[i] = x.as_u64().unwrap_or(0);
            }
        }
        st.switches = v["switches"].as_u64().unwrap_or(0);
        st.first = v["first"].as_u64();
        st.best = v["best"].as_u64().unwrap_or(0);
        st.best_app = v["bestApp"].as_str().unwrap_or("").to_string();
    } else if v["day"].is_string() && !st.apps.is_empty() {
        // the saved day is over: keep it in history
        st.day = v["day"].as_str().unwrap_or("").to_string();
        hist.push(st.summary());
        st.apps.clear();
        st.day = day;
    }
    let n = hist.len();
    st.hist = hist.split_off(n.saturating_sub(14));
    *SCREEN.lock().unwrap() = Some(st);
}

pub fn screen_tick(exe: &str, secs: u64) {
    let mut g = SCREEN.lock().unwrap();
    let Some(st) = g.as_mut() else { return };
    let d = today();
    if st.day != d {
        let mut hist = std::mem::take(&mut st.hist);
        if !st.apps.is_empty() {
            hist.push(st.summary());
        }
        let n = hist.len();
        *st = ScreenTime::fresh(d, hist.split_off(n.saturating_sub(14)));
    }
    if exe.is_empty() {
        return;
    }
    let now = secs_of_day();
    st.first.get_or_insert(now);
    st.hours[(now / 3600).min(23) as usize] += secs;
    *st.apps.entry(exe.to_string()).or_insert(0) += secs;
    if st.last_app == exe {
        st.streak += secs;
    } else {
        st.switches += 1;
        st.last_app = exe.to_string();
        st.streak = secs;
    }
    if st.streak > st.best {
        st.best = st.streak;
        st.best_app = exe.to_string();
    }
}

pub fn screen_json() -> Value {
    let g = SCREEN.lock().unwrap();
    match g.as_ref() {
        Some(s) => json!({"day": s.day, "apps": s.apps, "hours": s.hours, "switches": s.switches, "first": s.first,
            "best": s.best, "bestApp": s.best_app, "hist": s.hist}),
        None => json!({}),
    }
}

pub fn screen_save(path: &Path) {
    let _ = std::fs::write(path, screen_json().to_string());
}

// ---------- file index ----------
pub static FILES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

pub fn build_index() {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let roots = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive\\Desktop", "OneDrive\\Documents"];
    let mut out = Vec::new();
    for r in roots {
        walk(&PathBuf::from(&home).join(r), 0, &mut out);
    }
    *FILES.lock().unwrap() = out;
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<(String, String)>) {
    if depth > 5 || out.len() > 120_000 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "$RECYCLE.BIN" || name == "__pycache__" {
            continue;
        }
        let p = e.path();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push((name.to_lowercase(), p.to_string_lossy().to_string()));
        if is_dir {
            walk(&p, depth + 1, out);
        }
    }
}

pub fn find_files(q: &str, limit: usize) -> Vec<Value> {
    let q = q.to_lowercase();
    let words: Vec<&str> = q.split_whitespace().collect();
    if words.is_empty() {
        return vec![];
    }
    let f = FILES.lock().unwrap();
    let mut hits: Vec<(i32, &String)> = f
        .iter()
        .filter(|(n, _)| words.iter().all(|w| n.contains(w)))
        .map(|(n, p)| (if n.starts_with(words[0]) { 0 } else { 1 } + (n.len() as i32 / 12), p))
        .collect();
    hits.sort_by_key(|h| h.0);
    hits.into_iter()
        .take(limit)
        .map(|(_, p)| {
            let md = std::fs::metadata(p).ok();
            json!({"path": p, "dir": md.as_ref().map(|m| m.is_dir()).unwrap_or(false), "size": md.map(|m| m.len()).unwrap_or(0)})
        })
        .collect()
}

// ---------- AI plan usage ----------
/// Claude: only what Claude Code / Claude desktop hand to the user, see claudelive.rs. The
/// Claude Code login token is not used: Anthropic does not allow it in other tools.
pub fn claude_usage() -> Result<Value, String> {
    crate::claudelive::usage()
}

/// Disabled: Google's Antigravity terms (Additional Terms §6) forbid third-party tools using the
/// Antigravity login; doing so has led to account suspensions. There is no official quota API.
pub fn antigravity_usage() -> Result<Value, String> {
    Err("Antigravity kotası Google kuralları gereği dock'tan okunmuyor (resmî API yok)".into())
}


pub fn codex_usage() -> Result<Value, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let raw = std::fs::read_to_string(Path::new(&home).join(".codex").join("auth.json"))
        .map_err(|_| "Codex oturumu bulunamadı".to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let tok = v["tokens"]["access_token"].as_str().ok_or("token yok")?;
    let acc = v["tokens"]["account_id"].as_str().unwrap_or("");
    let r: Value = ureq::get("https://chatgpt.com/backend-api/wham/usage")
        .set("Authorization", &format!("Bearer {}", tok))
        .set("ChatGPT-Account-Id", acc)
        .set("User-Agent", "smartdock")
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    Ok(r)
}

pub fn http_text(url: &str) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("webcal://") {
        return Err("yalnız https".into());
    }
    let u = url.replacen("webcal://", "https://", 1);
    ureq::get(&u)
        .set("User-Agent", "smartdock")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())
}
