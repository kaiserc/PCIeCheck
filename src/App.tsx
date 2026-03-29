
import { useEffect, useState, useCallback } from 'react';
import {
  Cpu, HardDrive, RefreshCcw, AlertTriangle, Zap, CheckCircle,
  Info, ShieldCheck, BookOpen, ExternalLink, Search, Layers,
  History, ChevronDown, ChevronUp, Clock, Trash2
} from 'lucide-react';
import './index.css';

// Tauri-aware link opener: uses shell plugin inside .exe, window.open in browser
async function openUrl(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface PciDevice {
  Name: string; Category: string; Class: string; Status: string;
  InstanceId: string;
  DeviceWidth: number; DeviceMaxWidth: number; DeviceSpeed: number; DeviceMaxSpeed: number;
  SlotWidth: number; SlotMaxWidth: number; SlotSpeed: number; SlotMaxSpeed: number;
  WidthThrottled: boolean; SpeedThrottled: boolean; IsThrottled: boolean; ParentId: string;
  LaneSource?: 'CPU' | 'Chipset' | 'Unknown';
}

interface GpuZResult {
  GpuZRunning: boolean; Message?: string; CardName?: string;
  CurrentWidth?: number; MaxWidth?: number; CurrentSpeed?: number;
  RawBusInterface?: string; IsThrottled?: boolean;
}

interface NvidiaSmiResult {
  NvidiaSmiAvailable: boolean; Message?: string; CardName?: string;
  CurrentWidth?: number; MaxWidth?: number; CurrentSpeed?: number; MaxSpeed?: number;
  RawBusInterface?: string; IsThrottled?: boolean;
}

interface NvmeDrive { FriendlyName: string; SizeGB: number; MediaType: string; }

interface SystemInfo {
  Motherboard: { Make: string; Model: string; SearchUrl: string; ManualUrl: string; MfgUrl: string; };
  CPU: string;
  NvmeDrives: NvmeDrive[];
}

interface DisplayDevice {
  name: string; category: string;
  currentWidth: number; maxWidth: number; currentSpeed: number; maxSpeed: number;
  isThrottled: boolean; widthThrottled: boolean; speedThrottled: boolean;
  source: 'gpuz' | 'nvidia' | 'pnp';
  rawBusInterface?: string; instanceId: string;
  nvmeFriendlyName?: string; nvmeSizeGB?: number;
  laneSource?: 'CPU' | 'Chipset' | 'Unknown';
}

interface HistorySnapshot {
  timestamp: string;
  label: string;
  devices: DisplayDevice[];
  throttledCount: number;
}

const HISTORY_KEY = 'pcie_sentinel_history';
const MAX_HISTORY = 20;

function loadHistory(): HistorySnapshot[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

function saveSnapshot(devices: DisplayDevice[]) {
  const history = loadHistory();
  const snap: HistorySnapshot = {
    timestamp: new Date().toISOString(),
    label: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
    devices,
    throttledCount: devices.filter(d => d.isThrottled).length,
  };
  const updated = [snap, ...history].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

const SPEED_LABELS: Record<number, string> = {
  1: 'Gen 1 (2.5 GT/s)', 2: 'Gen 2 (5 GT/s)',
  3: 'Gen 3 (8 GT/s)',   4: 'Gen 4 (16 GT/s)', 5: 'Gen 5 (32 GT/s)',
};
const speedLabel = (n: number) => SPEED_LABELS[n] ?? `Gen ${n}`;

// ── Sub-components ─────────────────────────────────────────────────────────
function WidthBar({ current, max, throttled }: { current: number; max: number; throttled: boolean }) {
  const pct = Math.min(100, (current / (max || 1)) * 100);
  return (
    <div className="progress-container">
      <div className="progress-bar" style={{
        width: `${pct}%`,
        background: throttled ? 'var(--accent-red)' : 'var(--accent-blue)',
        boxShadow: throttled ? '0 0 10px rgba(239,68,68,0.5)' : '0 0 8px rgba(59,130,246,0.4)',
      }} />
    </div>
  );
}

function SourceBadge({ source }: { source: 'gpuz' | 'nvidia' | 'pnp' }) {
  if (source === 'gpuz')   return <span className="source-badge gpuz"><ShieldCheck size={10} /> GPU-Z Verified</span>;
  if (source === 'nvidia') return <span className="source-badge nvidia"><Zap size={10} /> nvidia-smi</span>;
  return <span className="source-badge pnp"><Info size={10} /> Windows PnP</span>;
}

function LaneSourceBadge({ lane }: { lane?: 'CPU' | 'Chipset' | 'Unknown' }) {
  if (!lane || lane === 'Unknown') return null;
  return (
    <span className={`source-badge lane-${lane.toLowerCase()}`} title={
      lane === 'CPU'
        ? 'Direct CPU PCIe lanes — lowest latency, highest bandwidth ceiling'
        : 'Chipset lanes via DMI — capped at Gen 3/4, slightly higher latency'
    }>
      {lane === 'CPU' ? '⚡' : '🔗'} {lane} Lanes
    </span>
  );
}

function DeviceCard({ device }: { device: DisplayDevice }) {
  const isGPU  = device.category === 'GPU';
  const isNVMe = device.category === 'NVMe';
  const displayName = isNVMe && device.nvmeFriendlyName ? device.nvmeFriendlyName : device.name;
  const icon = isGPU  ? <Cpu size={22} color="#60a5fa" /> :
               isNVMe ? <HardDrive size={22} color="#34d399" /> : null;

  return (
    <div className={`card ${device.isThrottled ? 'throttled' : ''}`}>
      <div className="device-header">
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            <span className={`badge badge-${device.category.toLowerCase()}`}>{device.category}</span>
            <SourceBadge source={device.source} />
            <LaneSourceBadge lane={device.laneSource} />
            {isNVMe && device.nvmeSizeGB && (
              <span className="source-badge pnp" style={{ opacity: 0.8 }}>
                <Layers size={10} /> {device.nvmeSizeGB >= 1000 ? `${(device.nvmeSizeGB / 1000).toFixed(1)} TB` : `${device.nvmeSizeGB} GB`}
              </span>
            )}
          </div>
          <h3 className="device-name">{displayName}</h3>
          {isNVMe && device.nvmeFriendlyName && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{device.name}</p>
          )}
          {device.rawBusInterface && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem', fontFamily: 'monospace' }}>
              {device.rawBusInterface}
            </p>
          )}
          {device.laneSource === 'Chipset' && isNVMe && (
            <p style={{ fontSize: '0.72rem', color: 'var(--accent-yellow)', marginTop: '0.2rem' }}>
              ⚠ Chipset slot — max bandwidth capped at Gen 3/4 x4
            </p>
          )}
        </div>
        {icon}
      </div>

      <div className="stats">
        <div className="stat-row">
          <div className="stat-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PCIe Link Width{device.source === 'pnp' ? <span style={{ opacity: 0.5 }}> (bridge)</span> : null}</span>
            {device.widthThrottled && <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>THROTTLED</span>}
          </div>
          <div className="stat-values">
            <span className="current-val" style={{ color: device.widthThrottled ? 'var(--accent-red)' : 'var(--accent-blue)' }}>
              x{device.currentWidth}
            </span>
            <span className="max-val">/ x{device.maxWidth} max</span>
          </div>
          <WidthBar current={device.currentWidth} max={device.maxWidth} throttled={device.widthThrottled} />
        </div>

        <div className="stat-row">
          <div className="stat-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PCIe Speed</span>
            {device.speedThrottled && <span style={{ color: 'var(--accent-yellow)' }}>BELOW MAX</span>}
          </div>
          <div className="stat-values">
            <Zap size={14} color={device.speedThrottled ? 'var(--accent-yellow)' : 'var(--accent-green)'} />
            <span className="current-val" style={{ fontSize: '1.05rem' }}>{speedLabel(device.currentSpeed)}</span>
          </div>
        </div>

        {device.isThrottled ? (
          <div className="throttled-alert">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>Bottleneck Detected</strong>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                Running at <strong>x{device.currentWidth}</strong> but capable of <strong>x{device.maxWidth}</strong>.{' '}
                {isGPU  && <>Caused by <strong>PCIe bifurcation</strong> — an M.2 drive sharing CPU lanes with the GPU slot.</>}
                {isNVMe && <>This drive is in a slot with fewer lanes than it supports.</>}
              </p>
            </div>
          </div>
        ) : (
          <div className="ok-status"><CheckCircle size={15} /><span>Running at full capacity</span></div>
        )}
      </div>
    </div>
  );
}

function MotherboardPanel({ info }: { info: SystemInfo }) {
  const shortMake = info.Motherboard.Make
    .replace('Micro-Star International Co., Ltd.', 'MSI')
    .replace(' International Co., Ltd.', '')
    .replace(' Technology Co., Ltd.', '');

  return (
    <div className="mb-panel">
      <div className="mb-header">
        <Cpu size={18} color="var(--accent-blue)" />
        <div>
          <div className="mb-title">{shortMake} {info.Motherboard.Model}</div>
          <div className="mb-sub">{info.CPU}</div>
        </div>
      </div>
      <div className="mb-links">
        <button className="mb-link" onClick={() => openUrl(info.Motherboard.SearchUrl)}>
          <Search size={13} /> PCIe Lane Map
        </button>
        <button className="mb-link" onClick={() => openUrl(info.Motherboard.ManualUrl)}>
          <BookOpen size={13} /> Find Manual PDF
        </button>
        <button className="mb-link primary" onClick={() => openUrl(info.Motherboard.MfgUrl)}>
          <ExternalLink size={13} /> Manufacturer Support
        </button>
      </div>
    </div>
  );
}

function GpuZNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="gpuz-notice">
      <Info size={18} style={{ flexShrink: 0 }} />
      <div>
        <strong>No hardware-verified GPU source active</strong>
        <p style={{ marginTop: '0.2rem', fontSize: '0.85rem', opacity: 0.9 }}>
          For accurate GPU bifurcation detection, open <strong>GPU-Z</strong> (AMD/NVIDIA/Intel)
          or ensure <strong>NVIDIA drivers</strong> are installed (nvidia-smi is checked automatically).
          Then click Refresh.
        </p>
      </div>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'inherit', padding: '0', fontSize: '1rem', opacity: 0.6, cursor: 'pointer' }}>✕</button>
    </div>
  );
}

function HistoryPanel({ history, onClear }: { history: HistorySnapshot[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;

  return (
    <div className="history-panel">
      <button className="history-toggle" onClick={() => setOpen(o => !o)}>
        <History size={14} />
        <span>Scan History ({history.length})</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="history-content">
          <div className="history-header-row">
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              Last {history.length} scan{history.length > 1 ? 's' : ''} — stored locally
            </span>
            <button className="history-clear" onClick={onClear} title="Clear history">
              <Trash2 size={12} /> Clear
            </button>
          </div>
          <div className="history-list">
            {history.map((snap, i) => (
              <div key={snap.timestamp} className={`history-row ${snap.throttledCount > 0 ? 'has-issues' : 'all-good'}`}>
                <div className="history-meta">
                  <Clock size={11} />
                  <span className="history-label">{snap.label}</span>
                  {i === 0 && <span className="badge-latest">latest</span>}
                </div>
                <div className="history-devices">
                  {snap.devices.map(d => (
                    <span
                      key={d.instanceId}
                      className={`history-device ${d.isThrottled ? 'throttled' : 'ok'}`}
                      title={`${d.nvmeFriendlyName ?? d.name} — x${d.currentWidth}/${d.maxWidth}`}
                    >
                      {d.category === 'GPU' ? '🖥' : '💾'} x{d.currentWidth}
                      {d.widthThrottled && ' ⚠'}
                    </span>
                  ))}
                </div>
                {snap.throttledCount > 0 && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-red)', marginTop: '0.2rem' }}>
                    {snap.throttledCount} bottleneck{snap.throttledCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const [pciDevices, setPciDevices] = useState<DisplayDevice[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [gpuVerified, setGpuVerified] = useState<'gpuz' | 'nvidia' | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showGpuZNotice, setShowGpuZNotice] = useState(false);
  const [history, setHistory]         = useState<HistorySnapshot[]>(() => loadHistory());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pciRes, gpuzRes, sysRes, nvidiaRes] = await Promise.all([
        fetch('http://localhost:3001/api/pci'),
        fetch('http://localhost:3001/api/gpuz'),
        fetch('http://localhost:3001/api/system'),
        fetch('http://localhost:3001/api/nvidia'),
      ]);

      if (!pciRes.ok) throw new Error('Backend unreachable. Run: npm run api');

      const pciData: PciDevice[]    = await pciRes.json().then(r => Array.isArray(r) ? r : [r]);
      const gpuzRaw                 = gpuzRes.ok    ? await gpuzRes.json()   : null;
      const sysRaw                  = sysRes.ok     ? await sysRes.json()    : null;
      const nvidiaRaw               = nvidiaRes.ok  ? await nvidiaRes.json() : null;

      if (sysRaw) setSystemInfo(sysRaw as SystemInfo);

      // ── GPU-Z entries ───────────────────────────────────────────────────
      const gpuzGpus: GpuZResult[] = gpuzRaw
        ? (Array.isArray(gpuzRaw) ? gpuzRaw : [gpuzRaw]).filter((g: GpuZResult) => g.GpuZRunning)
        : [];

      // ── nvidia-smi entries ──────────────────────────────────────────────
      const nvidiaGpus: NvidiaSmiResult[] = nvidiaRaw
        ? (Array.isArray(nvidiaRaw) ? nvidiaRaw : [nvidiaRaw]).filter((g: NvidiaSmiResult) => g.NvidiaSmiAvailable)
        : [];

      const gpuzUp   = gpuzGpus.length > 0;
      const nvidiaUp = nvidiaGpus.length > 0;
      setGpuVerified(gpuzUp ? 'gpuz' : nvidiaUp ? 'nvidia' : null);
      setShowGpuZNotice(!gpuzUp && !nvidiaUp);

      // Speed→entry maps for matching against PnP GPU list
      const gpuzBySpeed   = new Map<number, GpuZResult>();
      const nvidiaBySpeed = new Map<number, NvidiaSmiResult>();
      gpuzGpus.forEach(g   => { if (g.CurrentSpeed)  gpuzBySpeed.set(g.CurrentSpeed, g); });
      nvidiaGpus.forEach(g => { if (g.CurrentSpeed)  nvidiaBySpeed.set(g.CurrentSpeed, g); });

      const nvmeNames: NvmeDrive[] = sysRaw?.NvmeDrives ?? [];
      const display: DisplayDevice[] = [];

      // ── GPUs: GPU-Z first, nvidia-smi fallback, then PnP ───────────────
      pciData.filter(d => d.Category === 'GPU').forEach(d => {
        const gpuZ   = gpuzBySpeed.get(d.DeviceSpeed)   ?? gpuzBySpeed.get(d.SlotSpeed);
        const nvidia = nvidiaBySpeed.get(d.DeviceSpeed) ?? nvidiaBySpeed.get(d.SlotSpeed);

        if (gpuZ?.CurrentWidth) {
          display.push({
            name: d.Name, category: 'GPU',
            currentWidth: gpuZ.CurrentWidth,
            maxWidth:     gpuZ.MaxWidth ?? d.DeviceMaxWidth,
            currentSpeed: gpuZ.CurrentSpeed ?? d.SlotSpeed,
            maxSpeed:     gpuZ.MaxWidth ?? d.DeviceMaxWidth,
            isThrottled:  gpuZ.IsThrottled ?? false,
            widthThrottled: (gpuZ.CurrentWidth ?? 0) < (gpuZ.MaxWidth ?? 0),
            speedThrottled: false, source: 'gpuz',
            rawBusInterface: gpuZ.RawBusInterface,
            instanceId: d.InstanceId, laneSource: d.LaneSource,
          });
          gpuzBySpeed.delete(d.DeviceSpeed);
        } else if (nvidia?.CurrentWidth) {
          display.push({
            name: d.Name, category: 'GPU',
            currentWidth: nvidia.CurrentWidth,
            maxWidth:     nvidia.MaxWidth ?? d.DeviceMaxWidth,
            currentSpeed: nvidia.CurrentSpeed ?? d.SlotSpeed,
            maxSpeed:     nvidia.MaxSpeed ?? d.SlotMaxSpeed,
            isThrottled:  nvidia.IsThrottled ?? false,
            widthThrottled: (nvidia.CurrentWidth ?? 0) < (nvidia.MaxWidth ?? 0),
            speedThrottled: false, source: 'nvidia',
            rawBusInterface: nvidia.RawBusInterface,
            instanceId: d.InstanceId, laneSource: d.LaneSource,
          });
          nvidiaBySpeed.delete(d.DeviceSpeed);
        } else {
          display.push({
            name: d.Name, category: 'GPU',
            currentWidth: d.SlotWidth, maxWidth: d.SlotMaxWidth,
            currentSpeed: d.SlotSpeed, maxSpeed: d.SlotMaxSpeed,
            isThrottled: d.IsThrottled, widthThrottled: d.WidthThrottled,
            speedThrottled: d.SpeedThrottled, source: 'pnp',
            instanceId: d.InstanceId, laneSource: d.LaneSource,
          });
        }
      });

      // ── NVMe drives: enrich with friendly names ─────────────────────────
      pciData.filter(d => d.Category === 'NVMe').forEach((d, idx) => {
        const friendly = nvmeNames[idx];
        display.push({
          name: d.Name, category: 'NVMe',
          currentWidth: d.SlotWidth, maxWidth: d.SlotMaxWidth,
          currentSpeed: d.SlotSpeed, maxSpeed: d.SlotMaxSpeed,
          isThrottled: d.IsThrottled, widthThrottled: d.WidthThrottled,
          speedThrottled: d.SpeedThrottled, source: 'pnp',
          instanceId: d.InstanceId, laneSource: d.LaneSource,
          nvmeFriendlyName: friendly?.FriendlyName,
          nvmeSizeGB: friendly?.SizeGB,
        });
      });

      display.sort((a, b) => {
        if (a.isThrottled && !b.isThrottled) return -1;
        if (!a.isThrottled && b.isThrottled) return 1;
        const order: Record<string, number> = { GPU: 0, NVMe: 1, Other: 2 };
        return (order[a.category] ?? 9) - (order[b.category] ?? 9);
      });

      setPciDevices(display);

      // ── Save to history ─────────────────────────────────────────────────
      if (display.length > 0) {
        setHistory(saveSnapshot(display));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const throttledCount = pciDevices.filter(d => d.isThrottled).length;

  const clearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>PCIe Lane Sentinel</h1>
          <p>Bifurcation detection via GPU-Z · nvidia-smi · Windows PnP</p>
        </div>
        <button onClick={fetchData} disabled={loading} id="refresh-btn">
          <RefreshCcw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Scanning...' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={20} />
          <div><strong>Connection Error</strong><p>{error}</p></div>
        </div>
      )}

      {systemInfo && <MotherboardPanel info={systemInfo} />}

      {!loading && pciDevices.length > 0 && (
        <div className={`summary-banner ${throttledCount > 0 ? 'has-issues' : 'all-good'}`}>
          {throttledCount > 0 ? (
            <><AlertTriangle size={18} /><span><strong>{throttledCount} bottleneck{throttledCount > 1 ? 's' : ''} detected</strong> — some devices are not running at full PCIe capacity.</span></>
          ) : (
            <><CheckCircle size={18} /><span><strong>All clear!</strong> All devices running at full PCIe capacity.</span></>
          )}
        </div>
      )}

      {showGpuZNotice && !loading && <GpuZNotice onDismiss={() => setShowGpuZNotice(false)} />}

      <div className="idle-notice">
        <Info size={13} />
        <span>GPUs drop to x1–x4 at idle to save power. Run a benchmark first for accurate GPU width.</span>
      </div>

      {loading && pciDevices.length === 0 ? (
        <div className="loader"><div className="spinner" /><p>Scanning PCIe hierarchy, NVMe drives, GPU-Z &amp; nvidia-smi…</p></div>
      ) : (
        <div className="grid">
          {pciDevices.map(device => <DeviceCard key={device.instanceId} device={device} />)}
        </div>
      )}

      <HistoryPanel history={history} onClear={clearHistory} />

      <footer style={{ marginTop: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
        {gpuVerified === 'gpuz'   && <span style={{ color: 'var(--accent-green)'  }}>⬤ GPU-Z Active</span>}
        {gpuVerified === 'nvidia' && <span style={{ color: 'var(--accent-green)'  }}>⬤ nvidia-smi Active</span>}
        {gpuVerified === null     && <span style={{ color: 'var(--accent-yellow)' }}>⬤ No hardware GPU source</span>}
        <span style={{ marginLeft: '1rem' }}>PCIe Lane Sentinel • GPU-Z SHM + nvidia-smi + Windows PnP</span>
      </footer>
    </div>
  );
}

export default App;
