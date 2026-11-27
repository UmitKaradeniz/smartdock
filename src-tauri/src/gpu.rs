// GPU load and video memory, read the way Task Manager does: the "GPU Engine" and
// "GPU Adapter Memory" performance counters (no admin, no vendor SDK). The query is
// only alive while a widget asks; it closes itself after a quiet spell.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows::core::w;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
use windows::Win32::System::Performance::*;

struct Q {
    q: isize,
    eng: isize,
    ded: isize,
    shr: isize,
    used: Instant,
}
static Q: Mutex<Option<Q>> = Mutex::new(None);
static ADAPTER: Mutex<Option<(String, u64, u64, String)>> = Mutex::new(None); // name, dedicated, shared, luid tag

/// The biggest hardware adapter: (name, dedicated bytes, shared bytes, "luid_0x..._0x...").
fn adapter() -> Option<(String, u64, u64, String)> {
    let mut g = ADAPTER.lock().unwrap();
    if g.is_none() {
        unsafe {
            let f: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            let mut best: Option<(String, u64, u64, String)> = None;
            let mut i = 0;
            while let Ok(a) = f.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = a.GetDesc1() else { continue };
                if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                    continue;
                }
                let n = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
                let name = String::from_utf16_lossy(&d.Description[..n]).trim().to_string();
                let tag = format!("luid_0x{:08x}_0x{:08x}", d.AdapterLuid.HighPart as u32, d.AdapterLuid.LowPart);
                let cand = (name, d.DedicatedVideoMemory as u64, d.SharedSystemMemory as u64, tag);
                if best.as_ref().map_or(true, |b| cand.1 > b.1) {
                    best = Some(cand);
                }
            }
            *g = best;
        }
    }
    g.clone()
}

/// Name of a process we may not open (dwm, system services), from a process snapshot.
fn proc_name(pid: u32) -> String {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return format!("PID {pid}") };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut name = format!("PID {pid}");
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            if e.th32ProcessID == pid {
                let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                name = String::from_utf16_lossy(&e.szExeFile[..n]);
                break;
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = windows::Win32::Foundation::CloseHandle(snap);
        name
    }
}

unsafe fn items(c: isize) -> Vec<(String, f64)> {
    let mut out = Vec::new();
    let (mut size, mut count) = (0u32, 0u32);
    let _ = PdhGetFormattedCounterArrayW(c, PDH_FMT(PDH_FMT_DOUBLE.0 | 0x8000), &mut size, &mut count, None);
    if size == 0 {
        return out;
    }
    let mut buf = vec![0u8; size as usize];
    let p = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
    if PdhGetFormattedCounterArrayW(c, PDH_FMT(PDH_FMT_DOUBLE.0 | 0x8000), &mut size, &mut count, Some(p)) == 0 {
        for i in 0..count as usize {
            let it = &*p.add(i);
            out.push((it.szName.to_string().unwrap_or_default().to_lowercase(), it.FmtValue.Anonymous.doubleValue));
        }
    }
    out
}

fn open() -> Option<Q> {
    unsafe {
        let mut q = 0isize;
        if PdhOpenQueryW(windows::core::PCWSTR::null(), 0, &mut q) != 0 {
            return None;
        }
        let (mut eng, mut ded, mut shr) = (0isize, 0isize, 0isize);
        let ok = PdhAddEnglishCounterW(q, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut eng) == 0;
        let _ = PdhAddEnglishCounterW(q, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"), 0, &mut ded);
        let _ = PdhAddEnglishCounterW(q, w!("\\GPU Adapter Memory(*)\\Shared Usage"), 0, &mut shr);
        if !ok {
            let _ = PdhCloseQuery(q);
            return None;
        }
        let _ = PdhCollectQueryData(q);
        let q = Q { q, eng, ded, shr, used: Instant::now() };
        // close the query once nobody has asked for a while
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(5));
            let mut g = Q.lock().unwrap();
            if g.as_ref().map_or(true, |x| x.used.elapsed() > Duration::from_secs(10)) {
                if let Some(x) = g.take() {
                    let _ = PdhCloseQuery(x.q);
                }
                return;
            }
        });
        Some(q)
    }
}

/// {name, load %, top processes, dedicated/shared memory used + total}, or null without a GPU.
pub fn stats() -> Value {
    let Some((name, ded_total, shr_total, tag)) = adapter() else { return Value::Null };
    let mut g = Q.lock().unwrap();
    if g.is_none() {
        *g = open();
    }
    let Some(q) = g.as_mut() else { return Value::Null };
    q.used = Instant::now();
    unsafe {
        if PdhCollectQueryData(q.q) != 0 {
            return Value::Null;
        }
        // load = busiest engine type (3D, copy, video decode...), as Task Manager shows it
        let mut by_type: HashMap<String, f64> = HashMap::new();
        let mut by_pid: HashMap<u32, HashMap<String, f64>> = HashMap::new();
        for (inst, v) in items(q.eng) {
            if !inst.contains(&tag) || v <= 0.0 {
                continue;
            }
            let ty = inst.rsplit("engtype_").next().unwrap_or("").to_string();
            *by_type.entry(ty.clone()).or_default() += v;
            if let Some(pid) = inst.strip_prefix("pid_").and_then(|s| s.split('_').next()).and_then(|s| s.parse().ok()) {
                *by_pid.entry(pid).or_default().entry(ty).or_default() += v;
            }
        }
        let load = by_type.values().cloned().fold(0.0, f64::max).min(100.0);
        let mut top: Vec<(u32, f64)> = by_pid.into_iter().map(|(p, m)| (p, m.values().cloned().fold(0.0, f64::max))).filter(|x| x.1 >= 0.5).collect();
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        let procs: Vec<Value> = top
            .into_iter()
            .take(5)
            .map(|(pid, v)| {
                let exe = crate::wins::exe_of_pid(pid);
                let n = std::path::Path::new(&exe).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| proc_name(pid));
                json!({"name": n, "exe": exe, "gpu": (v.min(100.0) * 10.0).round() / 10.0})
            })
            .collect();
        let mem = |c: isize| items(c).into_iter().filter(|(i, _)| i.contains(&tag)).map(|x| x.1).sum::<f64>() as u64;
        json!({
            "name": name, "load": (load * 10.0).round() / 10.0, "procs": procs,
            "ded_used": mem(q.ded), "ded_total": ded_total, "shr_used": mem(q.shr), "shr_total": shr_total,
        })
    }
}
