// The Holographic Eye — Tauri shell (D-0005).
// A native Cinnamon-friendly window onto the control plane's frontend.
// Reads the bearer token from ~/.hermes/eye_token at launch; the UI itself
// is served by the wrapper provider inside the gateway (127.0.0.1:8770),
// so the shell stays a thin pane of glass.
// Copyright (C) 2026 Ben. GPLv3 — see LICENSE.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

const PLANE: &str = "http://127.0.0.1:8770";

fn eye_url() -> String {
    let token = dirs::home_dir()
        .map(|h| h.join(".hermes").join("eye_token"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| t.trim().to_string())
        .unwrap_or_default();
    if token.is_empty() {
        // no token → land on the plane root; the frontend will prompt
        format!("{PLANE}/")
    } else {
        format!("{PLANE}/?token={token}")
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url: tauri::Url = eye_url().parse().expect("static url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("The Holographic Eye")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1100.0, 680.0)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while launching The Holographic Eye");
}
