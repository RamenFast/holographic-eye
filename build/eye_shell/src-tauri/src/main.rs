// The Holographic Eye — Tauri shell (D-0005).
// Copyright (C) 2026 Ben. GPLv3 — see LICENSE.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;

use std::path::PathBuf;
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn eye_url_with_token(token: Option<&str>) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(cli::PLANE)
        .map_err(|error| format!("invalid control-plane URL: {error}"))?;
    if let Some(token) = token.map(str::trim).filter(|token| !token.is_empty()) {
        url.query_pairs_mut().append_pair("token", token);
    }
    Ok(url)
}

fn eye_url() -> Result<tauri::Url, String> {
    eye_url_with_token(cli::read_token().as_deref())
}

fn wait_for_gateway(window: WebviewWindow) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if !cli::gateway_health().available {
            continue;
        }
        let Ok(url) = eye_url() else {
            return;
        };
        let navigate_window = window.clone();
        let _ = window.run_on_main_thread(move || {
            let _ = navigate_window.navigate(url);
        });
        return;
    });
}

#[cfg(target_os = "linux")]
const CLOSE_DECISION_SCRIPT: &str = r#"
if (typeof window.eyeRequestClose === 'undefined') return true;
if (typeof window.eyeRequestClose !== 'function') return false;
return (await window.eyeRequestClose()) === true;
"#;

#[cfg(target_os = "linux")]
#[derive(Default)]
struct CloseGate(std::sync::atomic::AtomicBool);

#[cfg(target_os = "linux")]
impl CloseGate {
    fn begin(&self) -> bool {
        !self.0.swap(true, std::sync::atomic::Ordering::AcqRel)
    }

    fn retry(&self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(target_os = "linux")]
fn install_close_guard(window: &WebviewWindow) {
    use javascriptcore::ValueExt;
    use std::sync::Arc;
    use webkit2gtk::WebViewExt;

    let pending = Arc::new(CloseGate::default());
    let close_window = window.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };
        // Stop the WM close before asking the page. Never grant remote IPC access.
        api.prevent_close();
        if !pending.begin() {
            return;
        }
        let callback_pending = pending.clone();
        let callback_window = close_window.clone();
        let dispatched = close_window.with_webview(move |webview| {
            webview.inner().call_async_javascript_function(
                CLOSE_DECISION_SCRIPT,
                None,
                None,
                None,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    let approved = result
                        .map(|value| value.is_boolean() && value.to_boolean())
                        .unwrap_or(false);
                    // Destroy does not ask again or change the page's reload guard.
                    if !approved || callback_window.destroy().is_err() {
                        callback_pending.retry();
                    }
                },
            );
        });
        if dispatched.is_err() {
            pending.retry();
        }
    });
}

fn launch_gui() -> Result<(), String> {
    tauri::Builder::default()
        .setup(|app| {
            let gateway_ready = cli::gateway_health().available;
            let start_url = if gateway_ready {
                WebviewUrl::External(eye_url().map_err(std::io::Error::other)?)
            } else {
                WebviewUrl::App(PathBuf::from("index.html"))
            };
            let window = WebviewWindowBuilder::new(app, "main", start_url)
                .title("The Holographic Eye")
                .inner_size(1440.0, 900.0)
                .min_inner_size(640.0, 480.0)
                .decorations(false)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .build()?;
            #[cfg(target_os = "linux")]
            install_close_guard(&window);
            if !gateway_ready {
                wait_for_gateway(window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|_| "native window initialization failed".to_string())
}

fn main() {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let force_json = raw_args.iter().any(|arg| arg == "--json");
    let route = match cli::parse_args(raw_args) {
        Ok(route) => route,
        Err(error) => {
            cli::emit_usage_error(&error, force_json);
            std::process::exit(3);
        }
    };

    if route.command == cli::Command::Gui {
        if let Err(error) = launch_gui() {
            cli::emit_runtime_error(&error);
            std::process::exit(4);
        }
    } else {
        let exit = cli::run(route);
        if exit != 0 {
            std::process::exit(exit);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn pending_close_ignores_duplicates_and_allows_retry() {
        let gate = CloseGate::default();
        assert!(gate.begin());
        assert!(!gate.begin());
        assert!(!gate.begin());
        gate.retry();
        assert!(gate.begin());
        assert!(!gate.begin());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn concurrent_close_requests_have_one_owner() {
        let gate = std::sync::Arc::new(CloseGate::default());
        let workers: Vec<_> = (0..16)
            .map(|_| {
                let gate = gate.clone();
                std::thread::spawn(move || gate.begin())
            })
            .collect();
        let owners = workers
            .into_iter()
            .filter_map(|worker| worker.join().ok())
            .filter(|owned| *owned)
            .count();
        assert_eq!(owners, 1);
        gate.retry();
        assert!(gate.begin());
    }

    #[test]
    fn unsafe_token_bytes_are_url_encoded_and_round_trip() {
        let token = "broken #%?&/=+[]{} snowman=☃";
        let url = eye_url_with_token(Some(token)).unwrap();
        assert!(!url.as_str().contains("broken #"));
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "token").unwrap().1,
            token
        );
    }

    #[test]
    fn token_edges_are_trimmed_before_encoding() {
        let url = eye_url_with_token(Some("\n\t value with spaces \r\n")).unwrap();
        assert_eq!(url.query_pairs().next().unwrap().1, "value with spaces");
    }

    #[test]
    fn missing_or_empty_token_uses_the_control_plane_root() {
        assert_eq!(
            eye_url_with_token(None).unwrap().as_str(),
            "http://127.0.0.1:8770/"
        );
        assert_eq!(eye_url_with_token(Some(" \n")).unwrap().query(), None);
    }
}
