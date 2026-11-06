// A static server for the test page, with the byte ranges the chain reads tracks by. It listens on
// the local network, so a phone on the same network can open the page. Results that a page posts to
// /report are written to .build/reports.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const reports = join(root, '.build/reports');
const port = Number(process.env.PORT ?? 8123);

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.json': 'application/json',
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'POST' && url.pathname === '/report') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      mkdirSync(reports, { recursive: true });
      const report = JSON.parse(body);
      const name = /Firefox/.test(report.userAgent) ? 'firefox' : /Chrome/.test(report.userAgent) ? 'chrome' : 'safari';
      writeFileSync(join(reports, `${name}.json`), JSON.stringify(report, null, 2));
      console.log(`report from ${name}: crossings ${report.crossings}, at ${report.currentTime}`);
      response.end('ok');
    });
    return;
  }

  // The same address as on the deployed site, where the contents of public/ are at the top.
  const pathname = url.pathname.replace(/^\/media\//, '/public/media/');
  const path = normalize(join(root, decodeURIComponent(pathname)));
  const file = path.endsWith('/') ? join(path, 'index.html') : path;
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end();
    return;
  }

  const size = statSync(file).size;
  const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');

  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, 'Content-Length': size });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`http://localhost:${port}/proof/`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) console.log(`http://${net.address}:${port}/proof/`);
    }
  }
});
