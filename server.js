
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;
app.use(cors());
app.use(express.json());

function runPS(scriptFile, res) {
    const psPath = path.join(__dirname, scriptFile);
    const cmd = `powershell -ExecutionPolicy Bypass -File "${psPath}"`;
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) return res.status(500).json({ error: 'Script failed', details: error.message });
        try {
            // Find the FIRST JSON opener (whichever comes first: { or [)
            const braceIdx   = stdout.indexOf('{');
            const bracketIdx = stdout.indexOf('[');
            let start, end;
            if (braceIdx === -1 && bracketIdx === -1) {
                return res.status(500).json({ error: 'No JSON in output', raw: stdout });
            } else if (braceIdx !== -1 && (bracketIdx === -1 || braceIdx < bracketIdx)) {
                start = braceIdx;
                end = stdout.lastIndexOf('}') + 1;
            } else {
                start = bracketIdx;
                end = stdout.lastIndexOf(']') + 1;
            }
            res.json(JSON.parse(stdout.substring(start, end)));
        } catch (e) {
            res.status(500).json({ error: 'Parse failed', raw: stdout.slice(0, 500) });
        }
    });
}

// PnP-based endpoint (all PCIe devices, bridge-level)
app.get('/api/pci', (req, res) => runPS('get-pci-data.ps1', res));

// GPU-Z shared memory endpoint (actual bifurcation-aware PCIe width)
app.get('/api/gpuz', (req, res) => runPS('get-gpuz-data.ps1', res));

// System info: motherboard, CPU, NVMe drive names
app.get('/api/system', (req, res) => runPS('get-system-info.ps1', res));

// nvidia-smi: bifurcation-aware PCIe data for NVIDIA GPUs (no GPU-Z needed)
app.get('/api/nvidia', (req, res) => runPS('get-nvidia-data.ps1', res));

// Launch FurMark or HeavyLoad to stress GPU into full PCIe width
app.post('/api/launch-benchmark', (req, res) => runPS('launch-benchmark.ps1', res));


app.listen(port, () => console.log(`Backend API running at http://localhost:${port}`));
