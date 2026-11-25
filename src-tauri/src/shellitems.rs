// Everything that goes through Shell COM objects runs on one STA worker thread:
// installed-app enumeration (shell:AppsFolder), icons and file thumbnails.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Foundation::{HANDLE, SIZE};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath;
use windows::Win32::System::Com::*;
use windows::Win32::UI::Shell::*;

type Job = Box<dyn FnOnce() + Send>;
static WORKER: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
static ICONS: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();

pub fn start() {
    let (tx, rx) = channel::<Job>();
    std::thread::Builder::new()
        .name("shell-sta".into())
        .spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            while let Ok(job) = rx.recv() {
                job();
            }
        })
        .unwrap();
    let _ = WORKER.set(Mutex::new(tx));
    let _ = ICONS.set(Mutex::new(HashMap::new()));
}

/// Runs `f` on the shell thread and waits for the result.
pub fn run<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> R {
    let (tx, rx) = channel();
    let job: Job = Box::new(move || {
        let _ = tx.send(f());
    });
    WORKER.get().unwrap().lock().unwrap().send(job).unwrap();
    rx.recv().unwrap()
}

unsafe fn pwstr(p: PWSTR) -> String {
    let s = p.to_string().unwrap_or_default();
    CoTaskMemFree(Some(p.0 as *const _));
    s
}

#[derive(Serialize, Clone)]
pub struct App {
    pub name: String,
    pub id: String,
    pub target: String,
}

pub fn list_apps() -> Vec<App> {
    run(|| unsafe {
        let mut out = Vec::new();
        let Ok(folder) = SHGetKnownFolderItem::<_, IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, HANDLE::default()) else {
            return out;
        };
        let Ok(en) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else { return out };
        loop {
            let mut arr: [Option<IShellItem>; 1] = [None];
            let mut got = 0u32;
            let _ = en.Next(&mut arr, Some(&mut got));
            if got == 0 {
                break;
            }
            let Some(it) = arr[0].take() else { break };
            let name = it.GetDisplayName(SIGDN_NORMALDISPLAY).map(|p| pwstr(p)).unwrap_or_default();
            let id = it.GetDisplayName(SIGDN_PARENTRELATIVEPARSING).map(|p| pwstr(p)).unwrap_or_default();
            let target = it
                .cast::<IShellItem2>()
                .ok()
                .and_then(|i2| i2.GetString(&PKEY_Link_TargetParsingPath).ok())
                .map(|p| pwstr(p))
                .unwrap_or_default();
            if !name.is_empty() && !id.is_empty() {
                out.push(App { name, id, target });
            }
        }
        out
    })
}

unsafe fn bitmap_png(hb: HBITMAP) -> Option<Vec<u8>> {
    let mut bm = BITMAP::default();
    if GetObjectW(hb, std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buf = vec![0u8; (w * h * 4) as usize];
    let dc = GetDC(None);
    let lines = GetDIBits(dc, hb, 0, h as u32, Some(buf.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
    ReleaseDC(None, dc);
    if lines == 0 {
        return None;
    }
    // BGRA -> RGBA; shell bitmaps are usually premultiplied, undo that when it is.
    let no_alpha = buf.chunks(4).all(|p| p[3] == 0);
    let premul = !no_alpha && buf.chunks(4).all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);
    for p in buf.chunks_mut(4) {
        p.swap(0, 2);
        if no_alpha {
            p[3] = 255;
        } else if premul && p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in 0..3 {
                p[c] = ((p[c] as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let mut png_out = Vec::new();
    {
        let mut e = png::Encoder::new(&mut png_out, w as u32, h as u32);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut wr = e.write_header().ok()?;
        wr.write_image_data(&buf).ok()?;
    }
    Some(png_out)
}

/// `name` is a filesystem path or an AppsFolder id ("shell:AppsFolder\..." is added for ids).
pub fn image(name: String, size: i32, thumb: bool) -> Option<Vec<u8>> {
    let key = format!("{}|{}|{}", name, size, thumb);
    if let Some(v) = ICONS.get().unwrap().lock().unwrap().get(&key) {
        return Some(v.clone());
    }
    let n2 = name.clone();
    let png = run(move || unsafe {
        let parse = if n2.contains(":\\") || n2.starts_with("\\\\") || n2.starts_with("shell:") {
            n2.clone()
        } else {
            format!("shell:AppsFolder\\{}", n2)
        };
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(parse), None).ok()?;
        let f: IShellItemImageFactory = item.cast().ok()?;
        let flags = if thumb { SIIGBF_RESIZETOFIT } else { SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK };
        let hb = f.GetImage(SIZE { cx: size, cy: size }, flags).ok()?;
        let r = bitmap_png(hb);
        let _ = DeleteObject(hb);
        r
    })?;
    let mut c = ICONS.get().unwrap().lock().unwrap();
    if c.len() > 600 {
        c.clear();
    }
    c.insert(key, png.clone());
    Some(png)
}
