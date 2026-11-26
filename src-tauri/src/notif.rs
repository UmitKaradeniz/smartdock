// Unread notification counts per app: toasts in the Windows notification center and the badge
// numbers apps put on their taskbar icon. Toasts need "Notification access" (Settings > Privacy >
// Notifications); badges, window titles ("(3) WhatsApp") and flashing windows work without it.
use serde_json::{json, Map, Value};
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::Duration;
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Access};
use windows::UI::Notifications::NotificationKinds;

static LAST: Mutex<Option<Value>> = Mutex::new(None);

pub fn last() -> Value {
    LAST.lock().unwrap().clone().unwrap_or_else(|| json!({ "access": false, "ids": {}, "names": {}, "badges": {} }))
}

fn read(l: &UserNotificationListener) -> windows::core::Result<Value> {
    let list = l.GetNotificationsAsync(NotificationKinds::Toast)?.get()?;
    // per app: creation times (unix ms); the UI counts only those newer than the last time
    // the user looked at the app, so old toasts left in the notification center don't count
    let (mut ids, mut names) = (Map::new(), Map::new());
    let push = |m: &mut Map<String, Value>, k: String, t: i64| {
        if k.is_empty() {
            return;
        }
        if let Some(Value::Array(a)) = m.get_mut(&k) {
            a.push(t.into());
        } else {
            m.insert(k, json!([t]));
        }
    };
    for n in list {
        let Ok(ai) = n.AppInfo() else { continue };
        // DateTime: 100 ns ticks since 1601
        let t = n.CreationTime().map(|d| (d.UniversalTime - 116_444_736_000_000_000) / 10_000).unwrap_or(0);
        push(&mut ids, ai.AppUserModelId().map(|s| s.to_string().to_lowercase()).unwrap_or_default(), t);
        let name = ai.DisplayInfo().and_then(|d| d.DisplayName()).map(|s| s.to_string().to_lowercase()).unwrap_or_default();
        push(&mut names, name, t);
    }
    Ok(json!({ "access": true, "ids": ids, "names": names }))
}

// Windows ships SQLite as winsqlite3.dll
#[link(name = "winsqlite3")]
extern "system" {
    fn sqlite3_open_v2(file: *const u8, db: *mut *mut c_void, flags: i32, vfs: *const u8) -> i32;
    fn sqlite3_busy_timeout(db: *mut c_void, ms: i32) -> i32;
    fn sqlite3_prepare_v2(db: *mut c_void, sql: *const u8, len: i32, stmt: *mut *mut c_void, tail: *mut *const u8) -> i32;
    fn sqlite3_step(stmt: *mut c_void) -> i32;
    fn sqlite3_column_blob(stmt: *mut c_void, col: i32) -> *const u8;
    fn sqlite3_column_bytes(stmt: *mut c_void, col: i32) -> i32;
    fn sqlite3_finalize(stmt: *mut c_void) -> i32;
    fn sqlite3_close(db: *mut c_void) -> i32;
}

/// `<badge value="3"/>` -> 3. Glyph badges ("alert", "away", ...) carry no count.
fn badge_value(xml: &str) -> Option<u64> {
    let v = xml.split_once("<badge")?.1.split_once("value=")?.1;
    let quote = v.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    v[1..].split(quote).next()?.parse().ok().filter(|n| *n > 0)
}

/// Taskbar badges per app id (WhatsApp, Teams, ...). No public API hands out other apps' badges,
/// so they come from Windows' own notification database, opened read-only. Only rows of type
/// 'badge' (a number) are queried, never notification text.
/// Size + last write of the notification database and its WAL; None when it can't be read.
fn db_stamp() -> Option<[u64; 4]> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let base = format!("{local}\\Microsoft\\Windows\\Notifications\\wpndatabase.db");
    let one = |p: &str| -> Option<[u64; 2]> {
        let m = std::fs::metadata(p).ok()?;
        let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos() as u64;
        Some([m.len(), t])
    };
    let [a, b] = one(&base)?;
    let [c, d] = one(&format!("{base}-wal")).unwrap_or([0, 0]);
    Some([a, b, c, d])
}

fn badges() -> Map<String, Value> {
    let mut out = Map::new();
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return out };
    let path = format!("{local}\\Microsoft\\Windows\\Notifications\\wpndatabase.db\0");
    const SQL: &str = "select h.PrimaryId, n.Payload from Notification n \
        join NotificationHandler h on h.RecordId = n.HandlerId where n.Type = 'badge' \
        and (n.ExpiryTime = 0 or n.ExpiryTime > (strftime('%s','now') + 11644473600) * 10000000)\0";
    const READONLY: i32 = 1;
    const ROW: i32 = 100;
    // SAFETY: both strings are NUL terminated; column pointers are copied before the next step.
    unsafe {
        let mut db = std::ptr::null_mut();
        let mut st = std::ptr::null_mut();
        if sqlite3_open_v2(path.as_ptr(), &mut db, READONLY, std::ptr::null()) == 0 {
            sqlite3_busy_timeout(db, 200);
            if sqlite3_prepare_v2(db, SQL.as_ptr(), -1, &mut st, std::ptr::null_mut()) == 0 {
                let text = |st, col| {
                    let p = sqlite3_column_blob(st, col);
                    let n = sqlite3_column_bytes(st, col) as usize;
                    if p.is_null() { String::new() } else { String::from_utf8_lossy(std::slice::from_raw_parts(p, n)).into_owned() }
                };
                while sqlite3_step(st) == ROW {
                    if let Some(n) = badge_value(&text(st, 1)) {
                        out.insert(text(st, 0).to_lowercase(), n.into());
                    }
                }
            }
            sqlite3_finalize(st);
        }
        sqlite3_close(db);
    }
    out
}

/// Polls forever on the calling (MTA) thread; `emit` gets every change.
pub fn run(emit: impl Fn(&Value)) {
    let Ok(l) = UserNotificationListener::Current() else { return };
    let mut asked = false;
    let (mut seen, mut idle) = (None, 0u32);
    loop {
        let allowed = matches!(l.GetAccessStatus(), Ok(Access::Allowed));
        if !allowed && !asked {
            asked = true;
            let _ = l.RequestAccessAsync().and_then(|op| op.get());
            continue;
        }
        // toasts and badges both live in wpndatabase.db: while it (and its WAL) is untouched,
        // skip the listener round trip and the SQLite read; look anyway every ~30 s
        let st = db_stamp();
        if st.is_some() && st == seen && idle < 15 {
            idle += 1;
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        (seen, idle) = (st, 0);
        let v = if allowed { read(&l).ok() } else { None };
        let mut v = v.unwrap_or_else(|| json!({ "access": false, "ids": {}, "names": {} }));
        v["badges"] = Value::Object(badges());
        let changed = LAST.lock().unwrap().as_ref() != Some(&v);
        if changed {
            *LAST.lock().unwrap() = Some(v.clone());
            emit(&v);
        }
        std::thread::sleep(Duration::from_secs(if allowed { 2 } else { 5 }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_values() {
        assert_eq!(badge_value(r#"<badge value="3"/>"#), Some(3));
        assert_eq!(badge_value("<badge version='1' value='12'/>"), Some(12));
        assert_eq!(badge_value(r#"<badge value="0"/>"#), None);
        assert_eq!(badge_value(r#"<badge value="alert"/>"#), None);
        assert_eq!(badge_value(""), None);
    }

    // reads this PC's database: cargo test --release live_badges -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_badges() {
        println!("{:?}", badges());
    }
}
