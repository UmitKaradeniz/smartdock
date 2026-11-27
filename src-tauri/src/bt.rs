// Bluetooth beyond on/off: connect / disconnect paired audio devices (the same one-shot
// request the Sound control panel's Connect / Disconnect sends to the Bluetooth audio
// driver), find and pair new devices, and remove a pairing.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows::core::{Interface, GUID, HSTRING};
use windows::Devices::Bluetooth::BluetoothDevice;
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DevicePairingResultStatus, DeviceUnpairingResultStatus, DeviceWatcher};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Media::Audio::*;
use windows::Win32::Media::KernelStreaming::IKsControl;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

const KSPROPSETID_BTAUDIO: GUID = GUID::from_u128(0x7fa06c40_b8f6_4c7e_8556_e8c33a12e54d);
// PKEY_DeviceInterface_FriendlyName: the Bluetooth device's own name on its audio endpoints
const PKEY_IFACE_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x026e516e_b814_414b_83cd_856d6fef4822), pid: 2 };

#[repr(C)]
struct KsProp {
    set: GUID,
    id: u32,
    flags: u32,
}

/// (device name, driver filter) for every Bluetooth audio endpoint, connected or not.
fn filters() -> Vec<(String, IKsControl)> {
    let mut out = Vec::new();
    unsafe {
        let Ok(en) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
        let Ok(col) = en.EnumAudioEndpoints(eAll, DEVICE_STATE(DEVICE_STATEMASK_ALL)) else { return out };
        let mut seen = HashSet::new();
        for i in 0..col.GetCount().unwrap_or(0) {
            let Ok(ep) = col.Item(i) else { continue };
            let name = ep.OpenPropertyStore(STGM_READ).and_then(|ps| ps.GetValue(&PKEY_IFACE_NAME)).map(|v| v.to_string()).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let id = (|| -> windows::core::Result<String> {
                let topo: IDeviceTopology = ep.Activate(CLSCTX_ALL, None)?;
                let part: IPart = topo.GetConnector(0)?.GetConnectedTo()?.cast()?;
                let p = part.GetTopologyObject()?.GetDeviceId()?;
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as _));
                Ok(s)
            })()
            .unwrap_or_default();
            if !id.to_lowercase().contains("bth") || !seen.insert(id.clone()) {
                continue;
            }
            let Ok(f) = en.GetDevice(&HSTRING::from(&id)) else { continue };
            if let Ok(ks) = f.Activate::<IKsControl>(CLSCTX_ALL, None) {
                out.push((name, ks));
            }
        }
    }
    out
}

fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    a == b || a.contains(&b) || b.contains(&a)
}

/// Names of paired devices that can be connected / disconnected from here (audio ones).
pub fn audio_names() -> Vec<String> {
    filters().into_iter().map(|(n, _)| n).collect()
}

/// Ask the driver to connect (or drop) the device. True if any of its profiles took the request.
/// When the device has been away long enough for Windows to remove its audio driver, there is
/// nothing to ask: its audio services are switched off and on again, which makes Windows
/// rebuild the driver and connect (only services that were already on are touched).
pub fn connect(id: &str, name: &str, on: bool) -> bool {
    if ks(name, on) {
        return true;
    }
    on && reenable(id)
}

fn reenable(id: &str) -> bool {
    use windows::Win32::Devices::Bluetooth::*;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    let Some(addr) = BluetoothDevice::FromIdAsync(&HSTRING::from(id)).and_then(|a| a.get()).and_then(|d| d.BluetoothAddress()).ok() else { return false };
    const AUDIO: [u128; 3] = [
        0x0000110b_0000_1000_8000_00805f9b34fb, // A2DP sink (music)
        0x0000111e_0000_1000_8000_00805f9b34fb, // hands-free (calls)
        0x00001108_0000_1000_8000_00805f9b34fb, // headset
    ];
    unsafe {
        let p = BLUETOOTH_FIND_RADIO_PARAMS { dwSize: std::mem::size_of::<BLUETOOTH_FIND_RADIO_PARAMS>() as u32 };
        let mut radio = HANDLE::default();
        let Ok(f) = BluetoothFindFirstRadio(&p, &mut radio) else { return false };
        let _ = BluetoothFindRadioClose(f);
        let mut info = BLUETOOTH_DEVICE_INFO { dwSize: std::mem::size_of::<BLUETOOTH_DEVICE_INFO>() as u32, ..Default::default() };
        info.Address.Anonymous.ullLong = addr;
        let mut ok = false;
        if BluetoothGetDeviceInfo(radio, &mut info) == 0 {
            let mut n = 16u32;
            let mut svc = [GUID::zeroed(); 16];
            let _ = BluetoothEnumerateInstalledServices(radio, &info, &mut n, Some(svc.as_mut_ptr()));
            for g in svc.iter().take(n.min(16) as usize).filter(|g| AUDIO.contains(&g.to_u128())) {
                let _ = BluetoothSetServiceState(radio, &info, g, BLUETOOTH_SERVICE_DISABLE);
                ok |= BluetoothSetServiceState(radio, &info, g, BLUETOOTH_SERVICE_ENABLE) == 0;
            }
        }
        let _ = CloseHandle(radio);
        ok
    }
}

fn ks(name: &str, on: bool) -> bool {
    let p = KsProp { set: KSPROPSETID_BTAUDIO, id: if on { 0 } else { 1 }, flags: 1 /* KSPROPERTY_TYPE_GET */ };
    let mut ok = false;
    for (n, ks) in filters() {
        if same(&n, name) {
            let mut got = 0u32;
            ok |= unsafe { ks.KsProperty(&p as *const KsProp as *const _, std::mem::size_of::<KsProp>() as u32, std::ptr::null_mut(), 0, &mut got) }.is_ok();
        }
    }
    ok
}

// ---------- finding and pairing new devices ----------
struct Scan {
    w: DeviceWatcher,
    asked: Instant,
}
static SCAN: Mutex<Option<Scan>> = Mutex::new(None);
static FOUND: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new()); // (id, name)

fn start() -> Option<DeviceWatcher> {
    let sel = BluetoothDevice::GetDeviceSelectorFromPairingState(false).ok()?;
    let w = DeviceInformation::CreateWatcherAqsFilter(&sel).ok()?;
    w.Added(&TypedEventHandler::new(|_, d: &Option<DeviceInformation>| {
        if let Some(d) = d {
            let (id, name) = (d.Id()?.to_string(), d.Name()?.to_string());
            let mut f = FOUND.lock().unwrap();
            if !name.trim().is_empty() && !f.iter().any(|x| x.0 == id) {
                f.push((id, name));
            }
        }
        Ok(())
    }))
    .ok()?;
    // a watcher only keeps reporting with all three handlers attached
    w.Updated(&TypedEventHandler::new(|_, _: &Option<DeviceInformationUpdate>| Ok(()))).ok()?;
    w.Removed(&TypedEventHandler::new(|_, u: &Option<DeviceInformationUpdate>| {
        if let Some(u) = u {
            let id = u.Id()?.to_string();
            FOUND.lock().unwrap().retain(|x| x.0 != id);
        }
        Ok(())
    }))
    .ok()?;
    w.Start().ok()?;
    // stop once the panel stops asking
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(2));
        let mut g = SCAN.lock().unwrap();
        if g.as_ref().map_or(true, |s| s.asked.elapsed() > Duration::from_secs(8)) {
            if let Some(s) = g.take() {
                let _ = s.w.Stop();
            }
            FOUND.lock().unwrap().clear();
            return;
        }
    });
    Some(w)
}

/// Unpaired devices nearby; keeps a search running while this is called every few seconds.
pub fn scan() -> Vec<Value> {
    {
        let mut g = SCAN.lock().unwrap();
        match g.as_mut() {
            Some(s) => s.asked = Instant::now(),
            None => {
                if let Some(w) = start() {
                    *g = Some(Scan { w, asked: Instant::now() });
                }
            }
        }
    }
    let f = FOUND.lock().unwrap();
    f.iter().map(|(id, name)| json!({"id": id, "name": name})).collect()
}

pub fn pair(id: &str) -> bool {
    let r = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id))
        .and_then(|a| a.get())
        .and_then(|d| d.Pairing())
        .and_then(|p| p.PairAsync())
        .and_then(|a| a.get())
        .and_then(|r| r.Status());
    let ok = matches!(r, Ok(s) if s == DevicePairingResultStatus::Paired || s == DevicePairingResultStatus::AlreadyPaired);
    if ok {
        FOUND.lock().unwrap().retain(|x| x.0 != id);
    }
    ok
}

pub fn unpair(id: &str) -> bool {
    let r = DeviceInformation::CreateFromIdAsync(&HSTRING::from(id))
        .and_then(|a| a.get())
        .and_then(|d| d.Pairing())
        .and_then(|p| p.UnpairAsync())
        .and_then(|a| a.get())
        .and_then(|r| r.Status());
    matches!(r, Ok(s) if s == DeviceUnpairingResultStatus::Unpaired || s == DeviceUnpairingResultStatus::AlreadyUnpaired)
}
