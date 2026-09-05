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
                .min_inner_size(1100.0, 680.0)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .build()?;
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
