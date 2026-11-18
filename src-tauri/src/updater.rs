//! updater.rs
//! GitHub Releases & HTTPS Manifest Auto-Updater for Mintu Studio.
//! - Checks `latest.json` on GitHub Releases (or falls back to GitHub Releases REST API).
//! - Verifies downloaded installer SHA-256 using pure-Rust FIPS 180-4 implementation.
//! - Streams download progress via `studio-update-progress` Tauri events.
//! - Launches verified NSIS installer to seamlessly update Mintu Studio.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub sha256: Option<String>,
    pub pub_date: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub status: String,
}

#[derive(Debug, Deserialize)]
struct CustomUpdateManifest {
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    url: String,
    sha256: Option<String>,
}

/// Pure-Rust FIPS 180-4 SHA-256 (zero external crate dependency).
pub fn compute_sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    h.iter().map(|v| format!("{:08x}", v)).collect::<String>()
}

fn parse_semver(raw: &str) -> (u64, u64, u64) {
    let cleaned = raw.trim().trim_start_matches(['v', 'V']);
    let main_part = cleaned.split('-').next().unwrap_or(cleaned);
    let mut parts = main_part.split('.');
    let major = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    parse_semver(latest) > parse_semver(current)
}

fn sanitize_repo(repo: &str) -> Result<String, String> {
    let trimmed = repo
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/")
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let parts: Vec<&str> = trimmed.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() != 2 {
        return Err("GitHub repository format must be 'owner/repo'.".to_string());
    }
    for p in &parts {
        if !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return Err("Invalid characters in GitHub repository name.".to_string());
        }
    }
    Ok(format!("{}/{}", parts[0], parts[1]))
}

#[tauri::command]
pub fn updater_get_version() -> String {
    CURRENT_VERSION.to_string()
}

#[tauri::command]
pub async fn updater_check(
    repo: String,
    custom_manifest_url: Option<String>,
) -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("MintuStudio/{}", CURRENT_VERSION))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // 1. Try explicit custom manifest URL if provided
    if let Some(custom_url) = custom_manifest_url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()) {
        if !custom_url.starts_with("https://") {
            return Err("Custom update manifest URL must use https://".to_string());
        }
        let resp = client
            .get(&custom_url)
            .send()
            .await
            .map_err(|e| format!("Could not reach update manifest: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Update server returned HTTP {}", resp.status()));
        }
        let text = resp.text().await.map_err(|e| format!("Failed reading manifest: {}", e))?;
        let manifest: CustomUpdateManifest =
            serde_json::from_str(&text).map_err(|e| format!("Invalid latest.json manifest: {}", e))?;
        let latest = manifest.version.trim().trim_start_matches(['v', 'V']).to_string();
        return Ok(UpdateCheckResult {
            current_version: CURRENT_VERSION.to_string(),
            latest_version: latest.clone(),
            update_available: is_newer_version(&latest, CURRENT_VERSION),
            release_notes: manifest.notes.unwrap_or_default(),
            download_url: Some(manifest.url),
            sha256: manifest.sha256,
            pub_date: manifest.pub_date,
            source: custom_url,
        });
    }

    let clean_repo = sanitize_repo(&repo)?;

    // 2. Try GitHub Releases latest.json asset first (supports SHA-256 verification)
    let gh_manifest_url = format!(
        "https://github.com/{}/releases/latest/download/latest.json",
        clean_repo
    );
    if let Ok(resp) = client.get(&gh_manifest_url).send().await {
        if resp.status().is_success() {
            if let Ok(text) = resp.text().await {
                if let Ok(manifest) = serde_json::from_str::<CustomUpdateManifest>(&text) {
                    let latest = manifest.version.trim().trim_start_matches(['v', 'V']).to_string();
                    return Ok(UpdateCheckResult {
                        current_version: CURRENT_VERSION.to_string(),
                        latest_version: latest.clone(),
                        update_available: is_newer_version(&latest, CURRENT_VERSION),
                        release_notes: manifest.notes.unwrap_or_default(),
                        download_url: Some(manifest.url),
                        sha256: manifest.sha256,
                        pub_date: manifest.pub_date,
                        source: format!("github:{} (latest.json)", clean_repo),
                    });
                }
            }
        }
    }

    // 3. Fallback to GitHub Releases REST API (detects any uploaded -setup.exe automatically!)
    let api_url = format!("https://api.github.com/repos/{}/releases/latest", clean_repo);
    let resp = client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub connection error: {}", e))?;

    if resp.status().as_u16() == 404 {
        return Err(format!(
            "No published GitHub Release found yet for '{}' (publish a Release with a tag like v0.2.0).",
            clean_repo
        ));
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", resp.status()));
    }

    let text = resp.text().await.map_err(|e| format!("Failed reading GitHub response: {}", e))?;
    let val: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid GitHub JSON: {}", e))?;

    let tag = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or(CURRENT_VERSION);
    let latest = tag.trim().trim_start_matches(['v', 'V']).to_string();
    let notes = val
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pub_date = val
        .get("published_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut exe_url: Option<String> = None;
    if let Some(assets) = val.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let dl = asset.get("browser_download_url").and_then(|v| v.as_str());
            if name.ends_with("setup.exe") || name.ends_with(".exe") {
                if let Some(u) = dl {
                    exe_url = Some(u.to_string());
                    if name.ends_with("setup.exe") {
                        break;
                    }
                }
            }
        }
    }

    Ok(UpdateCheckResult {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest.clone(),
        update_available: is_newer_version(&latest, CURRENT_VERSION),
        release_notes: notes,
        download_url: exe_url,
        sha256: None,
        pub_date,
        source: format!("github:{}", clean_repo),
    })
}

#[tauri::command]
pub async fn updater_download_and_install(
    app: AppHandle,
    download_url: String,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    let trimmed = download_url.trim();
    if !trimmed.starts_with("https://") {
        return Err("Update download URL must use https://".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("MintuStudio/{}", CURRENT_VERSION))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("Update download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut temp_path: PathBuf = std::env::temp_dir();
    temp_path.push(format!("MintuStudio-Update-{}.exe", std::process::id()));

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Could not create temp installer file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_pct: u8 = 255;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        let pct = if total_bytes > 0 {
            ((downloaded.saturating_mul(100)) / total_bytes).min(100) as u8
        } else {
            0
        };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit(
                "studio-update-progress",
                UpdateDownloadProgress {
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: pct,
                    status: "downloading".to_string(),
                },
            );
        }
    }
    file.flush().await.map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Verify SHA-256 when provided in latest.json
    if let Some(expected) = expected_sha256.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
        let _ = app.emit(
            "studio-update-progress",
            UpdateDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes,
                percent: 100,
                status: "verifying".to_string(),
            },
        );
        let bytes = tokio::fs::read(&temp_path)
            .await
            .map_err(|e| format!("Could not read downloaded installer: {}", e))?;
        let actual = compute_sha256_hex(&bytes);
        if actual != expected {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(format!(
                "SHA-256 verification failed! Expected {}, got {}. Installer deleted for safety.",
                expected, actual
            ));
        }
    }

    let _ = app.emit(
        "studio-update-progress",
        UpdateDownloadProgress {
            downloaded_bytes: downloaded,
            total_bytes,
            percent: 100,
            status: "installing".to_string(),
        },
    );

    // Launch NSIS installer (standard UI so user sees completion and Mintu Studio relaunches)
    let mut cmd = std::process::Command::new(&temp_path);
    cmd.spawn()
        .map_err(|e| format!("Could not launch update installer: {}", e))?;

    // Exit current instance cleanly shortly after launching installer
    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        app_clone.exit(0);
    });

    Ok(temp_path.to_string_lossy().to_string())
}
