import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../web/', import.meta.url));
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  };
  createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('허용되지 않는 요청입니다.');
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let path = resolve(root, `.${pathname}`);
      const child = relative(root, path);
      if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
        res.writeHead(403).end('접근할 수 없습니다.');
        return;
      }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      if (!(await stat(path)).isFile()) throw new Error('파일이 아닙니다.');
      res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('파일을 찾을 수 없습니다.');
    }
  }).listen(5173, 'localhost', () => console.log('보험 레이더: http://localhost:5173'));
}
