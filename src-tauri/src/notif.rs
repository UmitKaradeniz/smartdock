// Unread notification counts per app, read from the Windows notification center.
// Needs "Notification access" (Settings > Privacy > Notifications); without it the dock still
// shows counts from window titles ("(3) WhatsApp") and flashing windows.
use serde_json::{json, Map, Value};
use std::sync::Mutex;
use std::time::Duration;
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Access};
use windows::UI::Notifications::NotificationKinds;

static LAST: Mutex<Option<Value>> = Mutex::new(None);

pub fn last() -> Value {
    LAST.lock().unwrap().clone().unwrap_or_else(|| json!({ "access": false, "ids": {}, "names": {} }))
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

/// Polls forever on the calling (MTA) thread; `emit` gets every change.
pub fn run(emit: impl Fn(&Value)) {
    let Ok(l) = UserNotificationListener::Current() else { return };
    let mut asked = false;
    loop {
        let allowed = matches!(l.GetAccessStatus(), Ok(Access::Allowed));
        if !allowed && !asked {
            asked = true;
            let _ = l.RequestAccessAsync().and_then(|op| op.get());
            continue;
        }
        let v = if allowed { read(&l).ok() } else { None };
        let v = v.unwrap_or_else(|| json!({ "access": false, "ids": {}, "names": {} }));
        let changed = LAST.lock().unwrap().as_ref() != Some(&v);
        if changed {
            *LAST.lock().unwrap() = Some(v.clone());
            emit(&v);
        }
        std::thread::sleep(Duration::from_secs(if allowed { 2 } else { 30 }));
    }
}
