// Netlify Function: runs the same Express app as `npm start` and forwards each request to it.
const http = require('http');
const app = require('../../src/server');

let ready;
function start() {
  if (!ready) ready = new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s.address().port)); });
  return ready;
}

exports.handler = async (event) => {
  const port = await start();
  // Netlify may give us the original path (/api/x) or the function path (/.netlify/functions/api/x)
  let path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  if (!path.startsWith('/api')) path = '/api' + (path === '/' ? '' : path);
  const qs = event.rawQuery ? '?' + event.rawQuery
    : event.queryStringParameters && Object.keys(event.queryStringParameters).length ? '?' + new URLSearchParams(event.queryStringParameters) : '';
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : null;
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) if (!['host', 'content-length', 'connection'].includes(k.toLowerCase())) headers[k] = v;
  if (body) headers['content-length'] = body.length;

  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: event.httpMethod, path: path + qs, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: { 'content-type': res.headers['content-type'] || 'application/json', 'cache-control': 'no-store' },
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', (e) => resolve({ statusCode: 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Function error: ' + e.message }) }));
    if (body) req.write(body);
    req.end();
  });
};
