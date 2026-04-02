use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
use std::os::windows::process::CommandExt;
use tauri::Emitter;

// ── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PciDevice {
    pub name: String,
    pub category: String,
    pub class: String,
    pub status: String,
    pub instance_id: String,
    pub device_width: i32,
    pub device_max_width: i32,
    pub device_speed: i32,
    pub device_max_speed: i32,
    pub slot_width: i32,
    pub slot_max_width: i32,
    pub slot_speed: i32,
    pub slot_max_speed: i32,
    pub width_throttled: bool,
    pub speed_throttled: bool,
    pub is_throttled: bool,
    pub parent_id: Option<String>,
    pub lane_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GpuZResult {
    #[serde(rename = "GpuZRunning")]
    pub gpu_z_running: bool,
    pub card_name: Option<String>,
    pub current_width: Option<i32>,
    pub max_width: Option<i32>,
    pub current_speed: Option<i32>,
    pub raw_bus_interface: Option<String>,
    pub is_throttled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct NvmeDrive {
    pub friendly_name: String,
    #[serde(rename = "SizeGB")]
    pub size_gb: f64,
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SystemInfo {
    pub motherboard: MotherboardInfo,
    #[serde(rename = "CPU")]
    pub cpu: String,
    pub nvme_drives: Vec<NvmeDrive>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MotherboardInfo {
    pub make: String,
    pub model: String,
    pub search_url: String,
    pub manual_url: String,
    pub mfg_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BenchmarkResult {
    pub launched: bool,
    pub already_running: Option<bool>,
    pub tool: Option<String>,
    pub path: Option<String>,
    pub message: String,
    pub download_urls: Option<BenchmarkDownloadUrls>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BenchmarkDownloadUrls {
    pub fur_mark: String,
    pub heavy_load: String,
}

// ── Helper Functions ───────────────────────────────────────────────────────

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn run_powershell_script(app: &tauri::AppHandle, script_name: &str) -> Result<String, String> {
    let script_path = get_script_path(script_name)?;
    
    // Convert ps1 filename into a nice log message
    let action_name = script_name.replace(".ps1", "").replace("-", " ");
    app.emit("scan-log", format!("Executing {}...", action_name)).ok();
    
    let output = Command::new("powershell")
        .args([
            "-WindowStyle", "Hidden",
            "-ExecutionPolicy", "Bypass",
            "-File", &script_path
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PowerShell script failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn get_script_path(script_name: &str) -> Result<String, String> {
    // In Tauri app, scripts are bundled with the executable
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe dir: {}", e))?;
    
    let exe_dir = exe_dir.parent()
        .ok_or("Exe has no parent directory")?;
    
    // Try multiple possible locations
    let candidates = vec![
        exe_dir.join("scripts").join(script_name),
        exe_dir.join(script_name),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts").join(script_name),
    ];

    for path in candidates {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    Err(format!("Script not found: {}", script_name))
}

fn parse_json<T>(json_str: &str) -> Result<T, String> 
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_str(json_str).map_err(|e| format!("JSON parse error: {}", e))
}

// ── Tauri Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pci_data(app: tauri::AppHandle) -> Result<Vec<PciDevice>, String> {
    let json = run_powershell_script(&app, "get-pci-data.ps1")?;
    
    // Handle case where script returns non-JSON or error object
    if !json.trim().starts_with('[') && !json.trim().starts_with('{') {
        return Err(format!("Unexpected output from get-pci-data.ps1: {}", &json[..json.len().min(200)]));
    }

    let devices = parse_json::<Vec<PciDevice>>(&json)?;
    Ok(devices)
}

#[tauri::command]
pub async fn get_gpuz_data(app: tauri::AppHandle) -> Result<Vec<GpuZResult>, String> {
    let json = run_powershell_script(&app, "get-gpuz-data.ps1")?;
    
    // GPU-Z script returns either an object or array
    if !json.trim().starts_with('[') && !json.trim().starts_with('{') {
        return Err(format!("Unexpected output from get-gpuz-data.ps1: {}", &json[..json.len().min(200)]));
    }

    // Try to parse as array first, then as single object
    if let Ok(gpus) = parse_json::<Vec<GpuZResult>>(&json) {
        return Ok(gpus);
    }
    
    if let Ok(single) = parse_json::<GpuZResult>(&json) {
        return Ok(vec![single]);
    }

    Err(format!("Failed to parse GPU-Z data: {}", &json[..json.len().min(200)]))
}

#[tauri::command]
pub async fn get_system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let json = run_powershell_script(&app, "get-system-info.ps1")?;
    
    if !json.trim().starts_with('{') {
        return Err(format!("Unexpected output from get-system-info.ps1: {}", &json[..json.len().min(200)]));
    }

    parse_json(&json)
}

#[tauri::command]
pub async fn get_nvidia_data(app: tauri::AppHandle) -> Result<Vec<GpuZResult>, String> {
    let json = run_powershell_script(&app, "get-nvidia-data.ps1")?;
    
    if !json.trim().starts_with('[') && !json.trim().starts_with('{') {
        return Err(format!("Unexpected output from get-nvidia-data.ps1: {}", &json[..json.len().min(200)]));
    }

    // Try to parse as array first, then as single object
    if let Ok(gpus) = parse_json::<Vec<GpuZResult>>(&json) {
        return Ok(gpus);
    }
    
    if let Ok(single) = parse_json::<GpuZResult>(&json) {
        return Ok(vec![single]);
    }

    Err(format!("Failed to parse NVIDIA data: {}", &json[..json.len().min(200)]))
}

#[tauri::command]
pub async fn launch_benchmark(app: tauri::AppHandle) -> Result<BenchmarkResult, String> {
    let json = run_powershell_script(&app, "launch-benchmark.ps1")?;
    
    if !json.trim().starts_with('{') {
        return Err(format!("Unexpected output from launch-benchmark.ps1: {}", &json[..json.len().min(200)]));
    }

    parse_json(&json)
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}
