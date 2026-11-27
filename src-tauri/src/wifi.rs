// Wi-Fi networks through the Native Wifi API: list, connect (saved profile or a new
// personal-security one), disconnect and forget. User-level, no admin.
use serde_json::{json, Value};
use std::collections::HashMap;
use windows::core::{GUID, HSTRING, PCWSTR};
use windows::Win32::Foundation::{BOOL, HANDLE};
use windows::Win32::NetworkManagement::WiFi::*;

struct Client(HANDLE);
impl Drop for Client {
    fn drop(&mut self) {
        unsafe {
            let _ = WlanCloseHandle(self.0, None);
        }
    }
}

fn open() -> Option<(Client, GUID)> {
    unsafe {
        let (mut ver, mut h) = (0u32, HANDLE::default());
        if WlanOpenHandle(2, None, &mut ver, &mut h) != 0 {
            return None;
        }
        let c = Client(h);
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(c.0, None, &mut list) != 0 || list.is_null() {
            return None;
        }
        let l = &*list;
        let g = (l.dwNumberOfItems > 0).then(|| l.InterfaceInfo[0].InterfaceGuid);
        WlanFreeMemory(list as *const _);
        Some((c, g?))
    }
}

fn wstr(a: &[u16]) -> String {
    String::from_utf16_lossy(&a[..a.iter().position(|&c| c == 0).unwrap_or(a.len())])
}

struct Net {
    ssid: String,
    profile: String,
    signal: u32,
    secure: bool,
    connected: bool,
    auth: i32,
    cipher: i32,
}

/// Err(5) when Windows withholds the list: since Windows 11 24H2 it needs Location access.
fn networks_raw(c: &Client, g: &GUID) -> Result<Vec<Net>, u32> {
    let mut by: HashMap<String, Net> = HashMap::new();
    unsafe {
        let mut list: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
        let r = WlanGetAvailableNetworkList(c.0, g, 0, None, &mut list);
        if r != 0 || list.is_null() {
            return Err(r);
        }
        let l = &*list;
        for n in std::slice::from_raw_parts(l.Network.as_ptr(), l.dwNumberOfItems as usize) {
            let s = &n.dot11Ssid;
            let ssid = String::from_utf8_lossy(&s.ucSSID[..(s.uSSIDLength as usize).min(32)]).into_owned();
            if ssid.is_empty() || n.dot11BssType != dot11_BSS_type_infrastructure {
                continue;
            }
            let net = Net {
                ssid: ssid.clone(),
                profile: if n.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE != 0 { wstr(&n.strProfileName) } else { String::new() },
                signal: n.wlanSignalQuality,
                secure: n.bSecurityEnabled.as_bool(),
                connected: n.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED != 0,
                auth: n.dot11DefaultAuthAlgorithm.0,
                cipher: n.dot11DefaultCipherAlgorithm.0,
            };
            // the list repeats a network once per saved profile: keep the connected / saved one
            let rank = |x: &Net| (x.connected, !x.profile.is_empty(), x.signal);
            match by.get(&ssid) {
                Some(o) if rank(o) >= rank(&net) => {}
                _ => {
                    by.insert(ssid, net);
                }
            }
        }
        WlanFreeMemory(list as *const _);
    }
    let mut v: Vec<Net> = by.into_values().collect();
    v.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.signal.cmp(&a.signal)));
    Ok(v)
}

fn networks(c: &Client, g: &GUID) -> Vec<Net> {
    networks_raw(c, g).unwrap_or_default()
}

/// Visible networks, strongest first; `scan` asks the adapter for a fresh scan (results land a few seconds later).
pub fn list(scan: bool) -> Value {
    let Some((c, g)) = open() else { return json!({"ok": false, "nets": []}) };
    if scan {
        unsafe {
            let _ = WlanScan(c.0, &g, None, None, None);
        }
    }
    let found = match networks_raw(&c, &g) {
        Ok(v) => v,
        Err(5) => return json!({"ok": false, "location": true, "nets": []}),
        Err(_) => Vec::new(),
    };
    let nets: Vec<Value> = found
        .into_iter()
        .take(24)
        .map(|n| {
            let personal = matches!(n.auth, 1 | 4 | 7 | 9);
            json!({"ssid": n.ssid, "signal": n.signal, "secure": n.secure, "connected": n.connected, "saved": !n.profile.is_empty(), "enterprise": !personal})
        })
        .collect();
    json!({"ok": true, "nets": nets})
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn profile_xml(n: &Net, key: &str) -> Option<String> {
    let (auth, enc) = match n.auth {
        1 => ("open", "none"),
        4 => ("WPAPSK", if n.cipher == 2 { "TKIP" } else { "AES" }),
        7 => ("WPA2PSK", if n.cipher == 2 { "TKIP" } else { "AES" }),
        9 => ("WPA3SAE", "AES"),
        _ => return None,
    };
    let hex: String = n.ssid.bytes().map(|b| format!("{b:02X}")).collect();
    let shared = if auth == "open" {
        String::new()
    } else {
        format!("<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>", esc(key))
    };
    Some(format!(
        "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>{s}</name><SSIDConfig><SSID><hex>{hex}</hex><name>{s}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>{auth}</authentication><encryption>{enc}</encryption><useOneX>false</useOneX></authEncryption>{shared}</security></MSM></WLANProfile>",
        s = esc(&n.ssid)
    ))
}

fn connect_profile(c: &Client, g: &GUID, profile: &str) -> bool {
    let p = HSTRING::from(profile);
    let params = WLAN_CONNECTION_PARAMETERS {
        wlanConnectionMode: wlan_connection_mode_profile,
        strProfile: PCWSTR(p.as_ptr()),
        pDot11Ssid: std::ptr::null_mut(),
        pDesiredBssidList: std::ptr::null_mut(),
        dot11BssType: dot11_BSS_type_infrastructure,
        dwFlags: 0,
    };
    unsafe { WlanConnect(c.0, g, &params, None) == 0 }
}

/// Connect and wait (up to ~15 s) for the link. A profile made here for a wrong
/// password is removed again, so the next try asks for it afresh.
/// Ok(()) | Err("password" | "enterprise" | "failed" | "nowifi")
pub fn connect(ssid: &str, password: Option<String>) -> Result<(), &'static str> {
    let (c, g) = open().ok_or("nowifi")?;
    let n = networks(&c, &g).into_iter().find(|n| n.ssid == ssid).ok_or("failed")?;
    let mut made = false;
    let profile = if !n.profile.is_empty() && password.is_none() {
        n.profile.clone()
    } else {
        if n.secure && password.as_deref().map_or(true, str::is_empty) {
            return Err("password");
        }
        let xml = profile_xml(&n, password.as_deref().unwrap_or("")).ok_or("enterprise")?;
        let mut reason = 0u32;
        let r = unsafe { WlanSetProfile(c.0, &g, 0, &HSTRING::from(xml), PCWSTR::null(), BOOL(1), None, &mut reason) };
        if r != 0 {
            return Err(if n.secure { "password" } else { "failed" });
        }
        made = true;
        n.ssid.clone()
    };
    if !connect_profile(&c, &g, &profile) {
        return Err("failed");
    }
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if networks(&c, &g).iter().any(|x| x.ssid == ssid && x.connected) {
            return Ok(());
        }
    }
    if made {
        unsafe {
            let _ = WlanDeleteProfile(c.0, &g, &HSTRING::from(&profile), None);
        }
        return Err("password");
    }
    Err("failed")
}

pub fn disconnect() -> bool {
    open().map_or(false, |(c, g)| unsafe { WlanDisconnect(c.0, &g, None) == 0 })
}

/// Remove the saved profile ("Forget").
pub fn forget(ssid: &str) -> bool {
    let Some((c, g)) = open() else { return false };
    let Some(n) = networks(&c, &g).into_iter().find(|n| n.ssid == ssid && !n.profile.is_empty()) else { return false };
    unsafe { WlanDeleteProfile(c.0, &g, &HSTRING::from(&n.profile), None) == 0 }
}
