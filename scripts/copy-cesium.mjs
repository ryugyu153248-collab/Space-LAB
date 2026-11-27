// Copies CesiumJS static assets (workers, widgets CSS, imagery) to public/cesium.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/cesium/Build/Cesium';
const dst = 'public/cesium';
if (!existsSync(src)) { console.error('cesium not installed'); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const d of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true });
console.log('Cesium assets copied to', dst);
