// Media session (now playing), radios (Wi-Fi / Bluetooth) and master volume.
use serde::Serialize;
use std::sync::Mutex;
use windows::Devices::Radios::{Radio, RadioKind, RadioState};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

pub fn mta() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct Media {
    pub title: String,
    pub artist: String,
    pub app: String,
    pub playing: bool,
    pub pos: f64,
    pub dur: f64,
    pub art: u32,
}

static MANAGER: Mutex<Option<Manager>> = Mutex::new(None);
pub static ART: Mutex<(u32, Vec<u8>)> = Mutex::new((0, Vec::new()));

fn session() -> Option<Session> {
    let mut m = MANAGER.lock().unwrap();
    if m.is_none() {
        *m = Manager::RequestAsync().ok()?.get().ok();
    }
    m.as_ref()?.GetCurrentSession().ok()
}

fn hash(s: &str) -> u32 {
    s.bytes().fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619))
}

pub fn media() -> Option<Media> {
    let s = session()?;
    let p = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = p.Title().ok()?.to_string();
    if title.is_empty() {
        return None;
    }
    let artist = p.Artist().map(|a| a.to_string()).unwrap_or_default();
    let playing = s.GetPlaybackInfo().ok().and_then(|i| i.PlaybackStatus().ok()) == Some(Status::Playing);
    let (mut pos, mut dur) = (0.0, 0.0);
    if let Ok(t) = s.GetTimelineProperties() {
        pos = t.Position().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
        dur = t.EndTime().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
    }
    let key = hash(&format!("{}{}", title, artist));
    {
        let mut art = ART.lock().unwrap();
        if art.0 != key {
            art.0 = key;
            art.1 = (|| -> Option<Vec<u8>> {
                let st = p.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
                let n = st.Size().ok()? as u32;
                let r = DataReader::CreateDataReader(&st).ok()?;
                r.LoadAsync(n).ok()?.get().ok()?;
                let mut b = vec![0u8; n as usize];
                r.ReadBytes(&mut b).ok()?;
                Some(b)
            })()
            .unwrap_or_default();
        }
    }
    Some(Media { title, artist, app: s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default(), playing, pos, dur, art: key })
}

pub fn media_cmd(cmd: &str) {
    if let Some(s) = session() {
        let _ = match cmd {
            "next" => s.TrySkipNextAsync().and_then(|a| a.get()),
            "prev" => s.TrySkipPreviousAsync().and_then(|a| a.get()),
            _ => s.TryTogglePlayPauseAsync().and_then(|a| a.get()),
        };
    }
}

#[derive(Serialize, Default)]
pub struct Radios {
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
}

pub fn radios() -> Radios {
    let mut r = Radios::default();
    let _ = Radio::RequestAccessAsync().and_then(|a| a.get());
    if let Ok(list) = Radio::GetRadiosAsync().and_then(|a| a.get()) {
        for x in list {
            let on = x.State().map(|s| s == RadioState::On).unwrap_or(false);
            match x.Kind() {
                Ok(k) if k == RadioKind::WiFi => r.wifi = Some(on),
                Ok(k) if k == RadioKind::Bluetooth => r.bluetooth = Some(on),
                _ => {}
            }
        }
    }
    r
}

pub fn set_radio(kind: &str, on: bool) -> bool {
    let want = if kind == "wifi" { RadioKind::WiFi } else { RadioKind::Bluetooth };
    let _ = Radio::RequestAccessAsync().and_then(|a| a.get());
    if let Ok(list) = Radio::GetRadiosAsync().and_then(|a| a.get()) {
        for x in list {
            if x.Kind().ok() == Some(want) {
                let st = if on { RadioState::On } else { RadioState::Off };
                return x.SetStateAsync(st).and_then(|a| a.get()).is_ok();
            }
        }
    }
    false
}

fn endpoint() -> Option<IAudioEndpointVolume> {
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        dev.Activate(CLSCTX_ALL, None).ok()
    }
}

#[derive(Serialize)]
pub struct Volume {
    pub level: f32,
    pub muted: bool,
}

pub fn volume() -> Option<Volume> {
    let v = endpoint()?;
    unsafe { Some(Volume { level: v.GetMasterVolumeLevelScalar().ok()?, muted: v.GetMute().ok()?.as_bool() }) }
}

pub fn set_volume(level: Option<f32>, muted: Option<bool>) {
    if let Some(v) = endpoint() {
        unsafe {
            if let Some(l) = level {
                let _ = v.SetMasterVolumeLevelScalar(l.clamp(0.0, 1.0), std::ptr::null());
                let _ = v.SetMute(false, std::ptr::null());
            }
            if let Some(m) = muted {
                let _ = v.SetMute(m, std::ptr::null());
            }
        }
    }
}

// ---------- output devices and per-app volume ----------
use windows::core::{Interface, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{
    eCommunications, eMultimedia, AudioSessionStateExpired, ERole, IAudioSessionControl2, IAudioSessionManager2, ISimpleAudioVolume, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoTaskMemFree, STGM_READ};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

const PKEY_FRIENDLY: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };

// The undocumented IPolicyConfig the Sound panel itself uses to change the default device
// (no public API does this). Its vtable has been stable since Windows 7: SetDefaultEndpoint
// is slot 13 (3 IUnknown + 10 before it).
const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

fn enumerator() -> Option<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok() }
}

fn dev_id(d: &windows::Win32::Media::Audio::IMMDevice) -> String {
    unsafe {
        d.GetId().map_or(String::new(), |p| {
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as _));
            s
        })
    }
}

#[derive(Serialize)]
pub struct Output {
    id: String,
    name: String,
    default: bool,
}

/// Active speakers / headphones, the default first.
pub fn outputs() -> Vec<Output> {
    let mut out = Vec::new();
    let Some(en) = enumerator() else { return out };
    unsafe {
        let def = en.GetDefaultAudioEndpoint(eRender, eConsole).map(|d| dev_id(&d)).unwrap_or_default();
        let Ok(col) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
        for i in 0..col.GetCount().unwrap_or(0) {
            let Ok(d) = col.Item(i) else { continue };
            let id = dev_id(&d);
            let name = d.OpenPropertyStore(STGM_READ).and_then(|ps| ps.GetValue(&PKEY_FRIENDLY)).map(|v| v.to_string()).unwrap_or_default();
            out.push(Output { default: id == def, id, name });
        }
    }
    out.sort_by_key(|o| !o.default);
    out
}

pub fn set_output(id: &str) -> bool {
    unsafe {
        let Ok(unk) = CoCreateInstance::<_, windows::core::IUnknown>(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL) else { return false };
        let mut p = std::ptr::null_mut();
        if unk.query(&IID_POLICY_CONFIG, &mut p).is_err() || p.is_null() {
            return false;
        }
        let vt = *(p as *const *const usize);
        let set: extern "system" fn(*mut std::ffi::c_void, PCWSTR, ERole) -> HRESULT = std::mem::transmute(*vt.add(13));
        let release: extern "system" fn(*mut std::ffi::c_void) -> u32 = std::mem::transmute(*vt.add(2));
        let h = HSTRING::from(id);
        let ok = [eConsole, eMultimedia, eCommunications].iter().fold(false, |ok, r| set(p, PCWSTR(h.as_ptr()), *r).is_ok() || ok);
        release(p);
        ok
    }
}

/// Every live audio session on the default output as (pid, volume control).
fn sessions() -> Vec<(u32, ISimpleAudioVolume)> {
    let mut out = Vec::new();
    unsafe {
        let Some(en) = enumerator() else { return out };
        let Ok(dev) = en.GetDefaultAudioEndpoint(eRender, eConsole) else { return out };
        let Ok(mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { return out };
        let Ok(list) = mgr.GetSessionEnumerator() else { return out };
        for i in 0..list.GetCount().unwrap_or(0) {
            let Ok(s) = list.GetSession(i) else { continue };
            if s.GetState().ok() == Some(AudioSessionStateExpired) {
                continue;
            }
            let (Ok(s2), Ok(v)) = (s.cast::<IAudioSessionControl2>(), s.cast::<ISimpleAudioVolume>()) else { continue };
            out.push((s2.GetProcessId().unwrap_or(0), v));
        }
    }
    out
}

#[derive(Serialize)]
pub struct AppVol {
    pid: u32,
    name: String,
    exe: String,
    level: f32,
    muted: bool,
}

/// Apps that have audio open, one row per process (system sounds as pid 0).
pub fn app_volumes() -> Vec<AppVol> {
    let mut out: Vec<AppVol> = Vec::new();
    for (pid, v) in sessions() {
        if out.iter().any(|a| a.pid == pid) {
            continue;
        }
        let exe = if pid == 0 { String::new() } else { crate::wins::exe_of_pid(pid) };
        if pid != 0 && exe.is_empty() {
            continue;
        }
        let name = std::path::Path::new(&exe).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        unsafe { out.push(AppVol { pid, name, exe, level: v.GetMasterVolume().unwrap_or(1.0), muted: v.GetMute().map(|b| b.as_bool()).unwrap_or(false) }) };
    }
    out
}

pub fn set_app_volume(pid: u32, level: Option<f32>, muted: Option<bool>) {
    for (p, v) in sessions() {
        if p != pid {
            continue;
        }
        unsafe {
            if let Some(l) = level {
                let _ = v.SetMasterVolume(l.clamp(0.0, 1.0), std::ptr::null());
            }
            if let Some(m) = muted {
                let _ = v.SetMute(m, std::ptr::null());
            }
        }
    }
}
