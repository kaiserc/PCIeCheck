# =====================================================================
# PCIe Lane Sentinel - Benchmark Launcher
# Priority:
#   1. GPU-Z (running) -- launch stress test via -stresstest flag
#   2. FurMark (v1 / v2) -- installed + portable paths
#   3. HeavyLoad
# =====================================================================

function Find-Tool($paths) {
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

# ---- 1. GPU-Z via running process --------------------------------
$gpuzProcess = Get-Process -Name "GPU-Z*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($gpuzProcess) {
    $gpuzPath = $null
    try { $gpuzPath = $gpuzProcess.MainModule.FileName } catch {}
    if (-not $gpuzPath) {
        $gpuzPath = (Get-CimInstance Win32_Process -Filter "ProcessId = $($gpuzProcess.Id)" -ErrorAction SilentlyContinue).ExecutablePath
    }
    if ($gpuzPath -and (Test-Path $gpuzPath)) {
        try {
            Start-Process -FilePath $gpuzPath -ArgumentList "-stresstest" -ErrorAction Stop
            @{
                Launched = $true
                Tool     = "GPU-Z Stress Test"
                Path     = $gpuzPath
                Message  = "GPU-Z stress test launched. Wait 10-15s for GPU to reach full load, then refresh."
            } | ConvertTo-Json
            exit
        } catch { }
    }
}

# ---- 2. GPU-Z from known install locations (not running) ---------
$gpuzPaths = @(
    "$env:ProgramFiles\GPU-Z\GPU-Z.exe",
    "${env:ProgramFiles(x86)}\GPU-Z\GPU-Z.exe",
    "$env:LOCALAPPDATA\GPU-Z\GPU-Z.exe",
    "C:\GPU-Z\GPU-Z.exe",
    "$env:USERPROFILE\Downloads\GPU-Z.exe",
    "$env:USERPROFILE\Desktop\GPU-Z.exe"
)
$gpuzInstalled = Find-Tool $gpuzPaths
if ($gpuzInstalled) {
    Start-Process -FilePath $gpuzInstalled -ArgumentList "-stresstest" -ErrorAction SilentlyContinue
    @{
        Launched = $true
        Tool     = "GPU-Z Stress Test"
        Path     = $gpuzInstalled
        Message  = "GPU-Z stress test launched. Wait 10-15s for GPU to reach full load, then refresh."
    } | ConvertTo-Json
    exit
}

# ---- 3. FurMark --------------------------------------------------
$furmarkPaths = @(
    "$env:ProgramFiles\FurMark_2\FurMark_GUI.exe",
    "$env:ProgramFiles\FurMark_2\FurMark2.exe",
    "$env:ProgramFiles\Geeks3D\FurMark_2\FurMark_GUI.exe",
    "$env:ProgramFiles\Geeks3D\FurMark_1\FurMark.exe",
    "$env:ProgramFiles\FurMark\FurMark.exe",
    "$env:ProgramFiles\Geeks3D\Benchmarks\FurMark\FurMark.exe",
    "${env:ProgramFiles(x86)}\FurMark\FurMark.exe",
    "C:\FurMark\FurMark.exe",
    "$env:USERPROFILE\Downloads\FurMark\FurMark.exe",
    "$env:USERPROFILE\Desktop\FurMark\FurMark.exe"
)

if ($null -ne (Get-Process -Name "FurMark*" -ErrorAction SilentlyContinue)) {
    @{ Launched = $false; AlreadyRunning = $true; Tool = "FurMark";
       Message = "FurMark is already running. GPU should be at full load." } | ConvertTo-Json
    exit
}

$furmark = Find-Tool $furmarkPaths
if ($furmark) {
    Start-Process -FilePath $furmark -ErrorAction SilentlyContinue
    @{ Launched = $true; Tool = "FurMark"; Path = $furmark;
       Message = "FurMark launched. Wait 10-15s for GPU to reach full load, then refresh." } | ConvertTo-Json
    exit
}

# ---- 4. HeavyLoad ------------------------------------------------
$heavyloadPaths = @(
    "$env:ProgramFiles\JAM Software\HeavyLoad\HeavyLoad.exe",
    "${env:ProgramFiles(x86)}\JAM Software\HeavyLoad\HeavyLoad.exe"
)

if ($null -ne (Get-Process -Name "HeavyLoad*" -ErrorAction SilentlyContinue)) {
    @{ Launched = $false; AlreadyRunning = $true; Tool = "HeavyLoad";
       Message = "HeavyLoad is already running. GPU should be at full load." } | ConvertTo-Json
    exit
}

$heavyload = Find-Tool $heavyloadPaths
if ($heavyload) {
    Start-Process -FilePath $heavyload -ErrorAction SilentlyContinue
    @{ Launched = $true; Tool = "HeavyLoad"; Path = $heavyload;
       Message = "HeavyLoad launched. Wait 10-15s for GPU to reach full load, then refresh." } | ConvertTo-Json
    exit
}

# ---- Nothing found -----------------------------------------------
@{
    Launched       = $false
    AlreadyRunning = $false
    Tool           = $null
    Message        = "No benchmark tool found. GPU-Z, FurMark, or HeavyLoad required."
    DownloadUrls   = @{
        FurMark   = "https://geeks3d.com/furmark/"
        HeavyLoad = "https://www.jam-software.com/heavyload"
    }
} | ConvertTo-Json
