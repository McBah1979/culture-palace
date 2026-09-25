const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('../server');

test('admin settings require login and CSRF, then persist for visitors', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-palace-test-'));
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('test-password', Buffer.from(salt, 'hex'), 64).toString('hex');
  const server = createServer({
    CONTENT_FILE: path.join(directory, 'content.json'),
    ADMIN_LOGIN: 'dk-admin',
    ADMIN_PASSWORD: 'test-password',
    ADMIN_PASSWORD_HASH: `${salt}:${hash}`,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(`${base}${url}`, { ...options, headers: { Origin: base, 'Content-Type': 'application/json', ...options.headers } });
  const data = { texts: { 'main:1.2.3': 'Новый заголовок' }, links: {}, images: {}, colors: { '--clay': '#112233' } };
  try {
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/server.js')).status, 404);
    assert.equal((await request('/api/admin/content')).status, 401);
    assert.equal((await request('/api/admin/content', { method: 'PUT', body: JSON.stringify(data) })).status, 401);
    assert.equal((await request('/api/admin/images', { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await request('/api/admin/login', { method: 'POST', headers: { Origin: 'https://other.example' }, body: JSON.stringify({ username: 'dk-admin', password: 'test-password' }) })).status, 403);
    assert.equal((await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'dk-admin', password: 'wrong' }) })).status, 401);
    const login = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'dk-admin', password: 'test-password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const { csrf } = await login.json();
    assert.equal((await request('/api/admin/content', { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify(data) })).status, 403);
    assert.equal((await request('/api/admin/images', { method: 'POST', headers: { Cookie: cookie }, body: '{}' })).status, 403);
    const imageHeaders = { Cookie: cookie, 'X-CSRF-Token': csrf };
    const upload = (name, bytes) => request('/api/admin/images', { method: 'POST', headers: imageHeaders, body: JSON.stringify({ name, data: bytes.toString('base64') }) });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    assert.equal((await upload('bad.jpg', png)).status, 400);
    assert.equal((await upload('bad.png', Buffer.alloc(2 * 1024 * 1024 + 1, 0))).status, 400);
    const image = await upload('good.png', png);
    assert.equal(image.status, 201);
    const imagePath = (await image.json()).path;
    assert.match(imagePath, /^images\/upload-[0-9a-f-]+\.png$/);
    const fetchedImage = await request(`/${imagePath}`);
    assert.equal(fetchedImage.status, 200);
    assert.deepEqual(Buffer.from(await fetchedImage.arrayBuffer()), png);
    assert.equal((await request('/api/admin/content', { method: 'PUT', headers: { Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ ...data, links: { 'main:0': 'javascript:alert(1)' } }) })).status, 400);
    assert.equal((await request('/api/admin/content', { method: 'PUT', headers: { Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify(data) })).status, 200);
    assert.deepEqual(await (await request('/api/content')).json(), data);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'content.json'), 'utf8')), data);
    assert.equal((await request('/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf } })).status, 200);
    assert.equal((await request('/api/admin/content', { headers: { Cookie: cookie } })).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'dk-admin', password: 'wrong' }) })).status, 401);
    assert.equal((await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'dk-admin', password: 'test-password' }) })).status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
