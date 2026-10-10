// Render a local HTML file to PNG (used for asset contact sheets).
// Usage: node tools/sheet.mjs <file.html> <out.png> [width]
import { chromium } from 'playwright-core';
const [file, out, width = '1420'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const p = await b.newPage({ viewport: { width: Number(width), height: 400 } });
await p.goto('file:///' + file.replace(/\\/g, '/'));
await p.waitForTimeout(600);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log('saved', out);
