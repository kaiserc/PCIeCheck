
import { useEffect, useState, useCallback } from 'react';
import {
  Cpu, HardDrive, RefreshCcw, AlertTriangle, Zap, CheckCircle,
  Info, ShieldCheck, BookOpen, ExternalLink, Search, Layers,
  History, ChevronDown, ChevronUp, Clock, Trash2, Flame,
  Sun, Moon, Copy, LayoutGrid
} from 'lucide-react';
import './index.css';

async function openUrl(url: string) {
  try { const { open } = await import('@tauri-apps/plugin-shell'); await open(url); }
  catch { window.open(url, '_blank', 'noopener,noreferrer'); }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface PciDevice {
  Name: string; Category: string; Class: string; Status: string; InstanceId: string;
  DeviceWidth: number; DeviceMaxWidth: number; DeviceSpeed: number; DeviceMaxSpeed: number;
  SlotWidth: number; SlotMaxWidth: number; SlotSpeed: number; SlotMaxSpeed: number;
  WidthThrottled: boolean; SpeedThrottled: boolean; IsThrottled: boolean; ParentId: string;
  LaneSource?: 'CPU' | 'Chipset' | 'Unknown';
}
interface GpuZResult {
  GpuZRunning: boolean; CardName?: string;
  CurrentWidth?: number; MaxWidth?: number; CurrentSpeed?: number;
  RawBusInterface?: string; IsThrottled?: boolean;
}
interface NvidiaSmiResult {
  NvidiaSmiAvailable: boolean; CardName?: string;
  CurrentWidth?: number; MaxWidth?: number; CurrentSpeed?: number; MaxSpeed?: number;
  RawBusInterface?: string; IsThrottled?: boolean;
}
interface NvmeDrive { FriendlyName: string; SizeGB: number; MediaType: string; }
interface SystemInfo {
  Motherboard: { Make: string; Model: string; SearchUrl: string; ManualUrl: string; MfgUrl: string; };
  CPU: string; NvmeDrives: NvmeDrive[];
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
interface HistorySnapshot { timestamp: string; label: string; devices: DisplayDevice[]; throttledCount: number; }
interface BenchmarkResult { Launched: boolean; AlreadyRunning?: boolean; Tool?: string; Message: string; DownloadUrls?: { FurMark: string; HeavyLoad: string }; }

const HISTORY_KEY   = 'pcie_sentinel_history';
const LAST_SCAN_KEY = 'pcie_sentinel_last';
const THEME_KEY     = 'pcie_sentinel_theme';
const MAX_HISTORY   = 20;

function loadHistory(): HistorySnapshot[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; } }
function saveSnapshot(devices: DisplayDevice[]) {
  const snap: HistorySnapshot = { timestamp: new Date().toISOString(), label: new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }), devices, throttledCount: devices.filter(d => d.isThrottled).length };
  const updated = [snap, ...loadHistory()].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

const SPEED_LABELS: Record<number, string> = { 1:'Gen 1 (2.5 GT/s)', 2:'Gen 2 (5 GT/s)', 3:'Gen 3 (8 GT/s)', 4:'Gen 4 (16 GT/s)', 5:'Gen 5 (32 GT/s)' };
const speedLabel = (n: number) => SPEED_LABELS[n] ?? `Gen ${n}`;

// ── Generic Slot Layouts per platform ─────────────────────────────────────
type SlotKind = 'pcie-x16' | 'pcie-x4' | 'pcie-x1' | 'm2';
interface SlotDef { id: string; label: string; kind: SlotKind; laneSource: 'CPU'|'Chipset'; maxGen: number; maxWidth: number; sharesNote?: string; }

// AMD AM5 — X870E / X870 / X670E / X670 / B650E / B650
const AMD_AM5: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:5, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:5, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'CPU',     maxGen:5, maxWidth:4, sharesNote:'May share lanes with PCIEX16_1' },
  { id:'m3', label:'M.2_3',     kind:'m2',        laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m4', label:'M.2_4',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m5', label:'M.2_5',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

// AMD AM4 — X570 (chipset supports Gen 4)
const AMD_AM4_X570: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:4, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m3', label:'M.2_3',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
  { id:'p2', label:'PCIEX1_2',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

// AMD AM4 — B550 (chipset is Gen 3 only)
const AMD_AM4_B550: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:4, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

// AMD AM4 — B450 / X470 (Gen 2 chipset, Gen 3 CPU slot)
const AMD_AM4_B450: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:3, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:3, maxWidth:4, sharesNote:'May share lanes with PCIEX16_1 on some boards' },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:2, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:2, maxWidth:1  },
];

// Intel LGA1700 — Z790 / Z690 / B760 / H770 (12th/13th/14th gen)
const INTEL_LGA1700: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:5, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:5, maxWidth:4  },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'s3', label:'PCIEX16_3', kind:'pcie-x4',   laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m3', label:'M.2_3',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'m4', label:'M.2_4',     kind:'m2',        laneSource:'Chipset', maxGen:4, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

// Intel LGA1200 — Z590 / Z490 / B560 / H570 (10th/11th gen)
const INTEL_LGA1200: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:4, maxWidth:16 },  // 11th=Gen4, 10th=Gen3
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:4, maxWidth:4  },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'m3', label:'M.2_3',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
  { id:'p2', label:'PCIEX1_2',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

// Intel LGA1151 — Z390 / Z370 / B365 / H370 (8th/9th gen)
const INTEL_LGA1151: SlotDef[] = [
  { id:'s1', label:'PCIEX16_1', kind:'pcie-x16', laneSource:'CPU',     maxGen:3, maxWidth:16 },
  { id:'m1', label:'M.2_1',     kind:'m2',        laneSource:'CPU',     maxGen:3, maxWidth:4, sharesNote:'May share bandwidth with PCIEX16_1 on some boards' },
  { id:'s2', label:'PCIEX16_2', kind:'pcie-x4',   laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'m2', label:'M.2_2',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'m3', label:'M.2_3',     kind:'m2',        laneSource:'Chipset', maxGen:3, maxWidth:4  },
  { id:'p1', label:'PCIEX1_1',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
  { id:'p2', label:'PCIEX1_2',  kind:'pcie-x1',   laneSource:'Chipset', maxGen:3, maxWidth:1  },
];

interface LayoutResult { layout: SlotDef[]; platformName: string; }

function detectLayout(cpu: string, moboModel: string): LayoutResult {
  const c = cpu.toLowerCase();
  const m = moboModel.toLowerCase();

  // ── AMD AM5 ──────────────────────────────────────────────────────
  if (/x870|b850|x670|b650/.test(m))                                            return { layout: AMD_AM5,        platformName: 'AMD AM5 (X870/X670/B650)' };
  if (c.includes('ryzen') && /\b9[0-9]{3}x?3?d?\b/.test(c))                   return { layout: AMD_AM5,        platformName: 'AMD AM5' };

  // ── AMD AM4 by chipset ──────────────────────────────────────────
  if (/x570/.test(m))                                                            return { layout: AMD_AM4_X570,   platformName: 'AMD AM4 (X570)' };
  if (/b550/.test(m))                                                            return { layout: AMD_AM4_B550,   platformName: 'AMD AM4 (B550)' };
  if (/x470|b450|a520|b550m/.test(m))                                           return { layout: AMD_AM4_B450,   platformName: 'AMD AM4 (B450/X470)' };
  // AM4 by CPU generation
  if (c.includes('ryzen') && /\b[135][0-9]{3}x?\b/.test(c))                   return { layout: AMD_AM4_B550,   platformName: 'AMD AM4' };

  // ── Intel LGA1700 ────────────────────────────────────────────────
  if (/z790|z690|b760|h770/.test(m))                                             return { layout: INTEL_LGA1700,  platformName: 'Intel LGA1700 (Z790/Z690)' };
  if (/core.?i[3579].?1[234][0-9]{3}/.test(c))                                  return { layout: INTEL_LGA1700,  platformName: 'Intel LGA1700' };

  // ── Intel LGA1200 ────────────────────────────────────────────────
  if (/z590|z490|b560|h570/.test(m))                                             return { layout: INTEL_LGA1200,  platformName: 'Intel LGA1200 (Z590/Z490)' };
  if (/core.?i[3579].?1[01][0-9]{3}/.test(c))                                   return { layout: INTEL_LGA1200,  platformName: 'Intel LGA1200' };

  // ── Intel LGA1151 ────────────────────────────────────────────────
  if (/z390|z370|b365|h370|z270|z170/.test(m))                                  return { layout: INTEL_LGA1151,  platformName: 'Intel LGA1151 (Z390/Z370)' };
  if (/core.?i[3579].?[89][0-9]{3}/.test(c))                                    return { layout: INTEL_LGA1151,  platformName: 'Intel LGA1151' };

  // ── Fallback ──────────────────────────────────────────────────────
  return { layout: AMD_AM5, platformName: 'Unknown (showing AMD AM5 generic)' };
}


// ── Sub-components ─────────────────────────────────────────────────────────
function WidthBar({ current, max, throttled }: { current: number; max: number; throttled: boolean }) {
  const pct = Math.min(100, (current / (max || 1)) * 100);
  return (
    <div className="progress-container">
      <div className="progress-bar" style={{ width:`${pct}%`, background: throttled?'var(--accent-red)':'var(--accent-blue)', boxShadow: throttled?'0 0 10px rgba(239,68,68,0.5)':'0 0 8px rgba(59,130,246,0.4)' }} />
    </div>
  );
}

function SourceBadge({ source }: { source: 'gpuz'|'nvidia'|'pnp' }) {
  if (source==='gpuz')   return <span className="source-badge gpuz"><ShieldCheck size={10}/> GPU-Z Verified</span>;
  if (source==='nvidia') return <span className="source-badge nvidia"><Zap size={10}/> nvidia-smi</span>;
  return <span className="source-badge pnp"><Info size={10}/> Windows PnP</span>;
}

function LaneSourceBadge({ lane }: { lane?: 'CPU'|'Chipset'|'Unknown' }) {
  if (!lane || lane==='Unknown') return null;
  return <span className={`source-badge lane-${lane.toLowerCase()}`} title={lane==='CPU'?'Direct CPU PCIe lanes':'Chipset lanes via DMI — capped at Gen 3/4'}>{lane==='CPU'?'⚡':'🔗'} {lane} Lanes</span>;
}

function DeviceCard({ device }: { device: DisplayDevice }) {
  const isGPU=device.category==='GPU', isNVMe=device.category==='NVMe';
  const displayName = isNVMe && device.nvmeFriendlyName ? device.nvmeFriendlyName : device.name;
  const icon = isGPU ? <Cpu size={22} color="#60a5fa"/> : isNVMe ? <HardDrive size={22} color="#34d399"/> : null;
  return (
    <div className={`card ${device.isThrottled?'throttled':''}`}>
      <div className="device-header">
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:'0.4rem',alignItems:'center',flexWrap:'wrap',marginBottom:'0.4rem'}}>
            <span className={`badge badge-${device.category.toLowerCase()}`}>{device.category}</span>
            <SourceBadge source={device.source}/>
            <LaneSourceBadge lane={device.laneSource}/>
            {isNVMe && device.nvmeSizeGB && <span className="source-badge pnp" style={{opacity:0.8}}><Layers size={10}/> {device.nvmeSizeGB>=1000?`${(device.nvmeSizeGB/1000).toFixed(1)} TB`:`${device.nvmeSizeGB} GB`}</span>}
          </div>
          <h3 className="device-name">{displayName}</h3>
          {isNVMe && device.nvmeFriendlyName && <p style={{fontSize:'0.72rem',color:'var(--text-secondary)',marginTop:'0.15rem'}}>{device.name}</p>}
          {device.rawBusInterface && <p style={{fontSize:'0.72rem',color:'var(--text-secondary)',marginTop:'0.15rem',fontFamily:'monospace'}}>{device.rawBusInterface}</p>}
        </div>
        {icon}
      </div>
      <div className="stats">
        <div className="stat-row">
          <div className="stat-label" style={{display:'flex',justifyContent:'space-between'}}>
            <span>PCIe Link Width{device.source==='pnp'?<span style={{opacity:0.5}}> (bridge)</span>:null}</span>
            {device.widthThrottled && <span style={{color:'var(--accent-red)',fontWeight:700}}>THROTTLED</span>}
          </div>
          <div className="stat-values">
            <span className="current-val" style={{color:device.widthThrottled?'var(--accent-red)':'var(--accent-blue)'}}>x{device.currentWidth}</span>
            <span className="max-val">/ x{device.maxWidth} max</span>
          </div>
          <WidthBar current={device.currentWidth} max={device.maxWidth} throttled={device.widthThrottled}/>
        </div>
        <div className="stat-row">
          <div className="stat-label" style={{display:'flex',justifyContent:'space-between'}}>
            <span>PCIe Speed</span>
            {device.speedThrottled && <span style={{color:'var(--accent-yellow)'}}>BELOW MAX</span>}
          </div>
          <div className="stat-values">
            <Zap size={14} color={device.speedThrottled?'var(--accent-yellow)':'var(--accent-green)'}/>
            <span className="current-val" style={{fontSize:'1.05rem'}}>{speedLabel(device.currentSpeed)}</span>
          </div>
        </div>
        {device.isThrottled ? (
          <div className="throttled-alert">
            <AlertTriangle size={18} style={{flexShrink:0}}/>
            <div>
              <strong>Bottleneck Detected</strong>
              <p style={{marginTop:'0.25rem',fontSize:'0.85rem'}}>Running at <strong>x{device.currentWidth}</strong> but capable of <strong>x{device.maxWidth}</strong>.{' '}
                {isGPU && <>Caused by <strong>PCIe bifurcation</strong> — an M.2 drive is sharing CPU lanes with the GPU slot.</>}
                {isNVMe && <>This drive is in a slot with fewer lanes than it supports.</>}
              </p>
            </div>
          </div>
        ) : (
          <div className="ok-status"><CheckCircle size={15}/><span>Running at full capacity</span></div>
        )}
      </div>
    </div>
  );
}

function MotherboardPanel({ info }: { info: SystemInfo }) {
  const shortMake = info.Motherboard.Make.replace('Micro-Star International Co., Ltd.','MSI').replace(' International Co., Ltd.','').replace(' Technology Co., Ltd.','');
  return (
    <div className="mb-panel">
      <div className="mb-header"><Cpu size={18} color="var(--accent-blue)"/>
        <div><div className="mb-title">{shortMake} {info.Motherboard.Model}</div><div className="mb-sub">{info.CPU}</div></div>
      </div>
      <div className="mb-links">
        <button className="mb-link" onClick={()=>openUrl(info.Motherboard.SearchUrl)}><Search size={13}/> PCIe Lane Map</button>
        <button className="mb-link" onClick={()=>openUrl(info.Motherboard.ManualUrl)}><BookOpen size={13}/> Find Manual PDF</button>
        <button className="mb-link primary" onClick={()=>openUrl(info.Motherboard.MfgUrl)}><ExternalLink size={13}/> Manufacturer Support</button>
      </div>
    </div>
  );
}

function SlotDiagram({ devices, cpu, moboModel }: { devices: DisplayDevice[]; cpu: string; moboModel: string }) {
  const { layout, platformName } = detectLayout(cpu, moboModel);
  const gpus  = devices.filter(d => d.category==='GPU');
  const nvmes = devices.filter(d => d.category==='NVMe');
  let gi=0, ni=0;

  return (
    <div className="slot-diagram">
      <div className="slot-diagram-header"><LayoutGrid size={14}/> Motherboard Slot Map <span style={{fontWeight:400,opacity:0.6,textTransform:'none',letterSpacing:0}}>— {platformName} generic layout</span></div>
      <div className="slot-list">
        {layout.map(slot => {
          let device: DisplayDevice|null = null;
          if (slot.kind==='pcie-x16'||slot.kind==='pcie-x4') { device = gpus[gi] ?? null; if(gpus[gi]) gi++; }
          if (slot.kind==='m2') { device = nvmes[ni] ?? null; if(nvmes[ni]) ni++; }

          const barWidth = `${Math.max(12, (slot.maxWidth/16)*100*0.65)}%`;
          const barClass = device
            ? (device.category==='GPU' ? (device.widthThrottled?'gpu-bad':'gpu-ok') : (device.widthThrottled?'nvme-bad':'nvme-ok'))
            : 'empty';
          const label = device
            ? (device.nvmeFriendlyName ? `${device.nvmeFriendlyName.split(' ').slice(0,3).join(' ')}` : device.name.split(' ').slice(0,3).join(' '))
            : 'Empty';

          return (
            <div key={slot.id}>
              <div className="slot-row">
                <span className="slot-label">{slot.label}</span>
                <div className="slot-bar-wrap">
                  <div className={`slot-bar ${barClass}`} style={{width: barWidth}}>{label}</div>
                  {device?.widthThrottled && <span style={{fontSize:'0.7rem',color:'var(--accent-red)'}}>⚠ x{device.currentWidth}/{device.maxWidth}</span>}
                  {!device && <span style={{fontSize:'0.7rem',color:'var(--text-secondary)',opacity:0.5}}>Gen {slot.maxGen} x{slot.maxWidth}</span>}
                </div>
                <span className={`slot-badge ${slot.laneSource==='CPU'?'cpu':'chip'}`}>{slot.laneSource==='CPU'?'⚡ CPU':'🔗 Chip'}</span>
              </div>
              {slot.sharesNote && device && <div className="slot-share-note" style={{paddingLeft:'108px'}}>⚠ {slot.sharesNote} — may cause GPU bifurcation</div>}
            </div>
          );
        })}
      </div>
      <div className="slot-diagram-note">Generic illustration — slot order may differ. Check your motherboard manual for exact lane sharing rules.</div>
    </div>
  );
}

function BenchmarkPrompt({ onRefresh }: { onRefresh: ()=>void }) {
  const [status, setStatus]       = useState<'idle'|'launching'|'countdown'|'notfound'>('idle');
  const [toolName, setToolName]   = useState('');
  const [countdown, setCountdown] = useState(15);
  const [dlUrls, setDlUrls]       = useState<{FurMark:string;HeavyLoad:string}|null>(null);

  const launch = async () => {
    setStatus('launching');
    try {
      const res  = await fetch('http://localhost:3001/api/launch-benchmark', { method:'POST' });
      const data: BenchmarkResult = await res.json();
      if (data.Launched || data.AlreadyRunning) { setToolName(data.Tool??'Benchmark'); setStatus('countdown'); startCountdown(); }
      else { setDlUrls(data.DownloadUrls??null); setStatus('notfound'); }
    } catch { setStatus('notfound'); }
  };

  const startCountdown = () => {
    let n=15; setCountdown(n);
    const t = setInterval(()=>{ n--; setCountdown(n); if(n<=0){ clearInterval(t); setStatus('idle'); onRefresh(); } }, 1000);
  };

  if (status==='countdown') return (
    <div className="benchmark-bar running">
      <Flame size={16} className="flame-icon"/>
      <span><strong>{toolName} running</strong> — auto-refreshing in <strong>{countdown}s</strong></span>
      <button className="bench-skip" onClick={()=>{setStatus('idle');onRefresh();}}>Scan now</button>
    </div>
  );
  if (status==='notfound') return (
    <div className="benchmark-bar notfound">
      <Info size={15} style={{flexShrink:0}}/>
      <span>No benchmark tool found.{' '}{dlUrls && <><button className="bench-dl" onClick={()=>openUrl(dlUrls.FurMark)}>FurMark</button> or <button className="bench-dl" onClick={()=>openUrl(dlUrls.HeavyLoad)}>HeavyLoad</button></>}</span>
      <button className="bench-skip" onClick={()=>setStatus('idle')}>✕</button>
    </div>
  );
  return (
    <div className="benchmark-bar">
      <Flame size={15} style={{flexShrink:0,opacity:0.7}}/>
      <span style={{flex:1}}>GPUs drop to x1–x4 at idle. Stress the GPU first for accurate PCIe width readings.</span>
      <button className="bench-launch" onClick={launch} disabled={status==='launching'}>{status==='launching'?'Launching…':'🎮 Run Benchmark'}</button>
    </div>
  );
}

function HistoryPanel({ history, onClear }: { history: HistorySnapshot[]; onClear: ()=>void }) {
  const [open, setOpen] = useState(false);
  if (history.length===0) return null;
  return (
    <div className="history-panel">
      <button className="history-toggle" onClick={()=>setOpen(o=>!o)}>
        <History size={14}/><span>Scan History ({history.length})</span>{open?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
      </button>
      {open && (
        <div className="history-content">
          <div className="history-header-row">
            <span style={{color:'var(--text-secondary)',fontSize:'0.75rem'}}>Last {history.length} scan{history.length>1?'s':''}</span>
            <button className="history-clear" onClick={onClear}><Trash2 size={12}/> Clear</button>
          </div>
          <div className="history-list">
            {history.map((snap,i)=>(
              <div key={snap.timestamp} className={`history-row ${snap.throttledCount>0?'has-issues':'all-good'}`}>
                <div className="history-meta"><Clock size={11}/><span className="history-label">{snap.label}</span>{i===0&&<span className="badge-latest">latest</span>}</div>
                <div className="history-devices">
                  {snap.devices.map(d=><span key={d.instanceId} className={`history-device ${d.isThrottled?'throttled':'ok'}`} title={`${d.nvmeFriendlyName??d.name} — x${d.currentWidth}/${d.maxWidth}`}>{d.category==='GPU'?'🖥':'💾'} x{d.currentWidth}{d.widthThrottled&&' ⚠'}</span>)}
                </div>
                {snap.throttledCount>0&&<span style={{fontSize:'0.72rem',color:'var(--accent-red)',marginTop:'0.2rem'}}>{snap.throttledCount} bottleneck{snap.throttledCount>1?'s':''}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExportButton({ devices, systemInfo }: { devices: DisplayDevice[]; systemInfo: SystemInfo|null }) {
  const [state, setState] = useState<'idle'|'copied'>('idle');

  const buildReport = () => {
    const line = '─'.repeat(52);
    const now  = new Date().toLocaleString('en-GB', { dateStyle:'long', timeStyle:'short' });
    const mb   = systemInfo ? `${systemInfo.Motherboard.Make} ${systemInfo.Motherboard.Model}` : 'Unknown';
    const cpu  = systemInfo?.CPU ?? 'Unknown';
    const throttled = devices.filter(d=>d.isThrottled);

    let r = `${line}\nPCIe Lane Sentinel Report\nGenerated: ${now}\n${line}\n`;
    r += `Motherboard: ${mb}\nCPU: ${cpu}\n`;
    r += `Status: ${throttled.length>0?`${throttled.length} BOTTLENECK(S) DETECTED`:'All devices running at full capacity'}\n${line}\n\n`;

    devices.forEach(d=>{
      const name = d.nvmeFriendlyName ?? d.name;
      const size = d.nvmeSizeGB ? (d.nvmeSizeGB>=1000?`${(d.nvmeSizeGB/1000).toFixed(1)}TB`:`${d.nvmeSizeGB}GB`) : '';
      r += `[${d.category}] ${name}${size?' ('+size+')':''}\n`;
      r += `  Link Width : x${d.currentWidth} / x${d.maxWidth}${d.widthThrottled?' *** THROTTLED ***':' (OK)'}\n`;
      r += `  Link Speed : ${speedLabel(d.currentSpeed)}\n`;
      r += `  Lane Type  : ${d.laneSource??'Unknown'}\n`;
      r += `  Data Source: ${d.source==='gpuz'?'GPU-Z Verified':d.source==='nvidia'?'nvidia-smi':'Windows PnP'}\n`;
      if (d.widthThrottled) r += `  Cause      : PCIe bifurcation — check M.2 slot bandwidth sharing in board manual.\n`;
      r += '\n';
    });

    r += `${line}\nCreated by PCIe Lane Sentinel — https://github.com/kaiserc/PCIeCheck\n${line}`;
    return r;
  };

  const copy = async () => {
    await navigator.clipboard.writeText(buildReport());
    setState('copied');
    setTimeout(()=>setState('idle'), 2500);
  };

  if (devices.length===0) return null;
  return (
    <button className={`export-btn ${state==='copied'?'copied':''}`} onClick={copy}>
      <Copy size={13}/>{state==='copied'?'Copied!':'Export Report'}
    </button>
  );
}

function WelcomeScreen({ onScan, lastScan }: { onScan: ()=>void; lastScan: string|null }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-logo"><Cpu size={34} color="#60a5fa"/></div>
      <div>
        <div className="welcome-title">PCIe Lane Sentinel</div>
        <p className="welcome-sub">Detect PCIe bifurcation bottlenecks — find out if your GPU is secretly running at x8 instead of x16.</p>
      </div>
      <div className="welcome-tips">
        <div className="welcome-tip"><CheckCircle size={14} color="var(--accent-green)" style={{flexShrink:0,marginTop:'0.1rem'}}/><span><strong>Open GPU-Z first</strong> for hardware-verified GPU lane readings</span></div>
        <div className="welcome-tip"><Zap size={14} color="var(--accent-blue)" style={{flexShrink:0,marginTop:'0.1rem'}}/><span><strong>Run a GPU load</strong> (game or benchmark) — idle GPUs drop to x4 to save power</span></div>
        <div className="welcome-tip"><Info size={14} color="var(--accent-yellow)" style={{flexShrink:0,marginTop:'0.1rem'}}/><span>Scan takes <strong>20–90 seconds</strong> — Windows PnP enumeration is slow. One-time wait per session.</span></div>
      </div>
      {lastScan && <div className="cached-banner"><Clock size={12}/> Last scan: {lastScan}</div>}
      <button className="scan-btn" onClick={onScan}><RefreshCcw size={18}/> Start Scan</button>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const [scanState, setScanState]     = useState<'welcome'|'scanning'|'done'>('welcome');
  const [pciDevices, setPciDevices]   = useState<DisplayDevice[]>([]);
  const [systemInfo, setSystemInfo]   = useState<SystemInfo|null>(null);
  const [gpuVerified, setGpuVerified] = useState<'gpuz'|'nvidia'|null>(null);
  const [error, setError]             = useState<string|null>(null);
  const [showGpuZNotice, setShowGpuZNotice] = useState(false);
  const [history, setHistory]         = useState<HistorySnapshot[]>(()=>loadHistory());
  const [lastScanLabel, setLastScanLabel]   = useState<string|null>(()=> { try { return JSON.parse(localStorage.getItem(LAST_SCAN_KEY)??'null')?.label??null; } catch { return null; } });
  const [theme, setTheme]             = useState<'dark'|'light'>(()=>(localStorage.getItem(THEME_KEY)??'dark') as 'dark'|'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const fetchData = useCallback(async () => {
    setScanState('scanning');
    setError(null);
    try {
      const [pciRes, gpuzRes, sysRes, nvRes] = await Promise.all([
        fetch('http://localhost:3001/api/pci'), fetch('http://localhost:3001/api/gpuz'),
        fetch('http://localhost:3001/api/system'), fetch('http://localhost:3001/api/nvidia'),
      ]);
      if (!pciRes.ok) throw new Error('Backend unreachable — run: npm run api');

      const pciData: PciDevice[] = await pciRes.json().then(r=>Array.isArray(r)?r:[r]);
      const gpuzRaw = gpuzRes.ok  ? await gpuzRes.json()  : null;
      const sysRaw  = sysRes.ok   ? await sysRes.json()   : null;
      const nvRaw   = nvRes.ok    ? await nvRes.json()     : null;

      if (sysRaw) setSystemInfo(sysRaw as SystemInfo);

      const gpuzGpus: GpuZResult[]    = gpuzRaw ? (Array.isArray(gpuzRaw)?gpuzRaw:[gpuzRaw]).filter((g:GpuZResult)=>g.GpuZRunning) : [];
      const nvidiaGpus: NvidiaSmiResult[] = nvRaw ? (Array.isArray(nvRaw)?nvRaw:[nvRaw]).filter((g:NvidiaSmiResult)=>g.NvidiaSmiAvailable) : [];
      const gpuzUp=gpuzGpus.length>0, nvUp=nvidiaGpus.length>0;
      setGpuVerified(gpuzUp?'gpuz':nvUp?'nvidia':null);
      setShowGpuZNotice(!gpuzUp && !nvUp);

      const gpuzBySpeed=new Map<number,GpuZResult>(); gpuzGpus.forEach(g=>{if(g.CurrentSpeed)gpuzBySpeed.set(g.CurrentSpeed,g);});
      const nvBySpeed=new Map<number,NvidiaSmiResult>(); nvidiaGpus.forEach(g=>{if(g.CurrentSpeed)nvBySpeed.set(g.CurrentSpeed,g);});
      const nvmeNames: NvmeDrive[] = sysRaw?.NvmeDrives??[];
      const display: DisplayDevice[] = [];

      pciData.filter(d=>d.Category==='GPU').forEach(d=>{
        const gz=gpuzBySpeed.get(d.DeviceSpeed)??gpuzBySpeed.get(d.SlotSpeed);
        const nv=nvBySpeed.get(d.DeviceSpeed)??nvBySpeed.get(d.SlotSpeed);
        if (gz?.CurrentWidth) {
          display.push({ name:d.Name, category:'GPU', currentWidth:gz.CurrentWidth, maxWidth:gz.MaxWidth??d.DeviceMaxWidth, currentSpeed:gz.CurrentSpeed??d.SlotSpeed, maxSpeed:gz.MaxWidth??d.DeviceMaxWidth, isThrottled:gz.IsThrottled??false, widthThrottled:(gz.CurrentWidth??0)<(gz.MaxWidth??0), speedThrottled:false, source:'gpuz', rawBusInterface:gz.RawBusInterface, instanceId:d.InstanceId, laneSource:d.LaneSource });
          gpuzBySpeed.delete(d.DeviceSpeed);
        } else if (nv?.CurrentWidth) {
          display.push({ name:d.Name, category:'GPU', currentWidth:nv.CurrentWidth, maxWidth:nv.MaxWidth??d.DeviceMaxWidth, currentSpeed:nv.CurrentSpeed??d.SlotSpeed, maxSpeed:nv.MaxSpeed??d.SlotMaxSpeed, isThrottled:nv.IsThrottled??false, widthThrottled:(nv.CurrentWidth??0)<(nv.MaxWidth??0), speedThrottled:false, source:'nvidia', rawBusInterface:nv.RawBusInterface, instanceId:d.InstanceId, laneSource:d.LaneSource });
          nvBySpeed.delete(d.DeviceSpeed);
        } else {
          display.push({ name:d.Name, category:'GPU', currentWidth:d.SlotWidth, maxWidth:d.SlotMaxWidth, currentSpeed:d.SlotSpeed, maxSpeed:d.SlotMaxSpeed, isThrottled:d.IsThrottled, widthThrottled:d.WidthThrottled, speedThrottled:d.SpeedThrottled, source:'pnp', instanceId:d.InstanceId, laneSource:d.LaneSource });
        }
      });
      pciData.filter(d=>d.Category==='NVMe').forEach((d,i)=>{
        const fr=nvmeNames[i];
        display.push({ name:d.Name, category:'NVMe', currentWidth:d.SlotWidth, maxWidth:d.SlotMaxWidth, currentSpeed:d.SlotSpeed, maxSpeed:d.SlotMaxSpeed, isThrottled:d.IsThrottled, widthThrottled:d.WidthThrottled, speedThrottled:d.SpeedThrottled, source:'pnp', instanceId:d.InstanceId, laneSource:d.LaneSource, nvmeFriendlyName:fr?.FriendlyName, nvmeSizeGB:fr?.SizeGB });
      });

      display.sort((a,b)=>{ if(a.isThrottled&&!b.isThrottled)return -1; if(!a.isThrottled&&b.isThrottled)return 1; return ({GPU:0,NVMe:1,Other:2}[a.category]??9)-({GPU:0,NVMe:1,Other:2}[b.category]??9); });
      setPciDevices(display);

      const snap = saveSnapshot(display);
      setHistory(snap);
      const label = new Date().toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'});
      setLastScanLabel(label);
      localStorage.setItem(LAST_SCAN_KEY, JSON.stringify({label}));
      setScanState('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setScanState('welcome');
    }
  }, []);

  const throttledCount = pciDevices.filter(d=>d.isThrottled).length;

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>PCIe Lane Sentinel</h1>
          <p>Bifurcation detection · GPU-Z · nvidia-smi · Windows PnP</p>
        </div>
        <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
          <ExportButton devices={pciDevices} systemInfo={systemInfo}/>
          <button className="theme-toggle" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>
            {theme==='dark'?<Sun size={14}/>:<Moon size={14}/>} {theme==='dark'?'Light':'Dark'}
          </button>
          {scanState==='done' && (
            <button onClick={fetchData} disabled={scanState!=='done'} id="refresh-btn">
              <RefreshCcw size={16}/> Scan Again
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner"><AlertTriangle size={20}/><div><strong>Error</strong><p>{error}</p></div></div>}

      {scanState==='welcome' && <WelcomeScreen onScan={fetchData} lastScan={lastScanLabel}/>}

      {scanState==='scanning' && (
        <div className="loader"><div className="spinner"/><p>Scanning PCIe hierarchy, NVMe drives, GPU-Z &amp; nvidia-smi…</p></div>
      )}

      {scanState==='done' && (
        <>
          {systemInfo && <MotherboardPanel info={systemInfo}/>}
          {pciDevices.length>0 && (
            <div className={`summary-banner ${throttledCount>0?'has-issues':'all-good'}`}>
              {throttledCount>0 ? <><AlertTriangle size={18}/><span><strong>{throttledCount} bottleneck{throttledCount>1?'s':''} detected</strong> — some devices not running at full PCIe capacity.</span></> : <><CheckCircle size={18}/><span><strong>All clear!</strong> All devices running at full PCIe capacity.</span></>}
            </div>
          )}
          {showGpuZNotice && (
            <div className="gpuz-notice"><Info size={18} style={{flexShrink:0}}/>
              <div><strong>No hardware-verified GPU source</strong><p style={{marginTop:'0.2rem',fontSize:'0.85rem',opacity:0.9}}>Open GPU-Z or ensure NVIDIA drivers are installed, then click Scan Again.</p></div>
              <button onClick={()=>setShowGpuZNotice(false)} style={{background:'none',border:'none',color:'inherit',padding:'0',fontSize:'1rem',opacity:0.6,cursor:'pointer'}}>✕</button>
            </div>
          )}
          <BenchmarkPrompt onRefresh={fetchData}/>
          {systemInfo && pciDevices.length>0 && <SlotDiagram devices={pciDevices} cpu={systemInfo.CPU} moboModel={systemInfo.Motherboard.Model}/>}
          <div className="grid">{pciDevices.map(d=><DeviceCard key={d.instanceId} device={d}/>)}</div>
          <HistoryPanel history={history} onClear={()=>{ localStorage.removeItem(HISTORY_KEY); setHistory([]); }}/>
          <footer style={{marginTop:'2rem',textAlign:'center',color:'var(--text-secondary)',fontSize:'0.75rem'}}>
            {gpuVerified==='gpuz'   && <span style={{color:'var(--accent-green)'}}>⬤ GPU-Z Active</span>}
            {gpuVerified==='nvidia' && <span style={{color:'var(--accent-green)'}}>⬤ nvidia-smi Active</span>}
            {gpuVerified===null     && <span style={{color:'var(--accent-yellow)'}}>⬤ No hardware GPU source</span>}
            <span style={{marginLeft:'1rem'}}>PCIe Lane Sentinel · kaiserc/PCIeCheck</span>
          </footer>
        </>
      )}
    </div>
  );
}

export default App;
