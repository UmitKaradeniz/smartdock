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
