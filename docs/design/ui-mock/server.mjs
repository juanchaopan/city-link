// 效果图用的静态服务：/web 和 /node_modules 只读地取自美术探针目录 spikeDir，/mock 取自本目录。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

export function startServer(port, spikeDir) {
  const spike = path.resolve(spikeDir);
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const local = url.pathname.startsWith('/mock/');
    const root = local ? here : spike;
    const file = path.resolve(root, decodeURIComponent(local ? url.pathname.slice(6) : url.pathname.slice(1)));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
