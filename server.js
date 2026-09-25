const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const defaults = { texts: {}, links: {}, images: {}, colors: {} };
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const imagePath = /^images\/[a-z0-9-]+\.(jpg|png|webp)$/;

function createServer(env = process.env) {
  const attempts = new Map();
  const sessions = new Map();
  const secret = env.SESSION_SECRET || '';
  let cachedContent = null;
  let cacheUntil = 0;

  function sign(value) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
  }

  function session(req) {
    if (!secret) return null;
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_session='))?.slice(14);
    if (!cookie) return null;
    const [payload, signature] = cookie.split('.');
    if (!payload || !signature || signature.length !== sign(payload).length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
    try {
      const data = sessions.get(payload);
      if (data?.exp > Date.now()) return { ...data, id: payload };
      sessions.delete(payload);
      return null;
    } catch { return null; }
  }

  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  function sameOrigin(req) {
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  }

  async function body(req, limit = 200000) {
    if (Number(req.headers['content-length']) > limit) throw new Error('Слишком большой запрос.');
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error('Слишком большой запрос.');
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }

  function validContent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Object.keys(value).some((key) => !Object.hasOwn(defaults, key))) return false;
    for (const group of Object.keys(defaults)) {
      const entries = value[group];
      if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 500) return false;
      for (const [key, text] of Object.entries(entries)) {
        if (!/^(main|footer|header):(?:\d+\.)*\d+$|^--[a-z-]+$/.test(key) || typeof text !== 'string' || text.length > 4000) return false;
        if (group === 'colors' && !/^#[0-9a-fA-F]{6}$/.test(text)) return false;
        if (group === 'links' && !/^(https:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d -]+|#[a-zA-Z0-9_-]+)$/.test(text)) return false;
        if (group === 'images' && !imagePath.test(text)) return false;
      }
    }
    return true;
  }

  async function githubContent() {
    const repo = env.CONTENT_GITHUB_REPO;
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/site-content.json`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'culture-palace-admin', ...(env.CONTENT_GITHUB_TOKEN ? { Authorization: `Bearer ${env.CONTENT_GITHUB_TOKEN}` } : {}) }
    });
    if (response.status === 404) return { data: defaults, sha: null };
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const result = await response.json();
    return { data: JSON.parse(Buffer.from(result.content.replace(/\s/g, ''), 'base64').toString('utf8')), sha: result.sha };
  }

  async function githubImage(file) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(env.CONTENT_GITHUB_REPO || '')) throw new Error('Репозиторий изображений не настроен.');
    const response = await fetch(`https://api.github.com/repos/${env.CONTENT_GITHUB_REPO}/contents/${file}`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'culture-palace-admin', ...(env.CONTENT_GITHUB_TOKEN ? { Authorization: `Bearer ${env.CONTENT_GITHUB_TOKEN}` } : {}) }
    });
    if (!response.ok) return null;
    const item = await response.json();
    return Buffer.from(item.content.replace(/\s/g, ''), 'base64');
  }

  async function uploadImage(value) {
    const invalid = (message) => { const error = new Error(message); error.status = 400; throw error; };
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.data !== 'string') invalid('Неверный формат изображения.');
    const extension = path.extname(value.name).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) invalid('Выберите JPG, PNG или WebP.');
    const bytes = Buffer.from(value.data, 'base64');
    if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) invalid('Размер фото должен быть не более 2 МБ.');
    const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!((jpg && ['.jpg', '.jpeg'].includes(extension)) || (png && extension === '.png') || (webp && extension === '.webp'))) invalid('Расширение и содержимое файла не совпадают.');
    const file = `images/upload-${crypto.randomUUID()}.${extension === '.jpeg' ? 'jpg' : extension.slice(1)}`;
    if (env.CONTENT_FILE) {
      await fs.mkdir(path.join(path.dirname(env.CONTENT_FILE), 'images'), { recursive: true });
      await fs.writeFile(path.join(path.dirname(env.CONTENT_FILE), file), bytes, { flag: 'wx' });
    } else {
      if (!env.CONTENT_GITHUB_REPO || !env.CONTENT_GITHUB_TOKEN) throw new Error('Для загрузки настройте CONTENT_GITHUB_TOKEN в Render.');
      const response = await fetch(`https://api.github.com/repos/${env.CONTENT_GITHUB_REPO}/contents/${file}`, {
        method: 'PUT',
        headers: { 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'culture-palace-admin', Authorization: `Bearer ${env.CONTENT_GITHUB_TOKEN}` },
        body: JSON.stringify({ message: `Add photo ${file} from admin panel`, content: bytes.toString('base64'), branch: 'main' })
      });
      if (!response.ok) throw new Error(`GitHub не загрузил фото (${response.status}).`);
    }
    return file;
  }

  async function readContent() {
    if (cachedContent && Date.now() < cacheUntil) return cachedContent;
    let data;
    if (env.CONTENT_FILE) {
      try { data = JSON.parse(await fs.readFile(env.CONTENT_FILE, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else if (env.CONTENT_GITHUB_REPO) {
      ({ data } = await githubContent());
    } else {
      data = JSON.parse(await fs.readFile(path.join(root, 'site-content.json'), 'utf8'));
    }
    cachedContent = validContent(data || defaults) ? data || defaults : defaults;
    cacheUntil = Date.now() + 30000;
    return cachedContent;
  }

  async function saveContent(data) {
    if (env.CONTENT_FILE) {
      await fs.writeFile(env.CONTENT_FILE, `${JSON.stringify(data, null, 2)}\n`, { flag: 'w' });
    } else {
      if (!env.CONTENT_GITHUB_REPO || !env.CONTENT_GITHUB_TOKEN) throw new Error('Хранилище не подключено. Настройте GitHub-токен в Render.');
      const current = await githubContent();
      const response = await fetch(`https://api.github.com/repos/${env.CONTENT_GITHUB_REPO}/contents/site-content.json`, {
        method: 'PUT',
        headers: { 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'culture-palace-admin', Authorization: `Bearer ${env.CONTENT_GITHUB_TOKEN}` },
        body: JSON.stringify({ message: 'Update site content from admin panel', content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`).toString('base64'), branch: 'main', ...(current.sha ? { sha: current.sha } : {}) })
      });
      if (!response.ok) throw new Error(`GitHub не сохранил изменения (${response.status}).`);
    }
    cachedContent = data;
    cacheUntil = Date.now() + 30000;
  }

  function passwordMatches(password) {
    if (typeof password !== 'string' || password.length > 256) return false;
    if (env.ADMIN_PASSWORD) {
      const supplied = Buffer.from(password);
      const expected = Buffer.from(env.ADMIN_PASSWORD);
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    }
    if (!env.ADMIN_PASSWORD_HASH) return false;
    const [salt, hash] = env.ADMIN_PASSWORD_HASH.split(':');
    if (!/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(hash || '')) return false;
    const derived = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
    return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'));
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return json(res, 400, { error: 'Неверный адрес.' }); }
    try {
      if (pathname === '/api/content' && req.method === 'GET') return json(res, 200, await readContent());
      if (pathname === '/api/admin/session' && req.method === 'GET') {
        const current = session(req);
        return json(res, 200, current ? { authenticated: true, csrf: current.csrf } : { authenticated: false });
      }
      if (pathname === '/api/admin/login' && req.method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'Недопустимый источник запроса.' });
        if (!secret || (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH)) return json(res, 503, { error: 'Авторизация не настроена на сервере.' });
        const address = req.socket.remoteAddress;
        const record = attempts.get(address) || { count: 0, until: 0 };
        if (record.until > Date.now()) return json(res, 429, { error: 'Слишком много попыток. Повторите позднее.' });
        const credentials = await body(req);
        if (credentials.username !== (env.ADMIN_LOGIN || env.ADMIN_USERNAME || 'dk-admin') || !passwordMatches(credentials.password)) {
          record.count++;
          if (record.count >= 5) { record.until = Date.now() + 15 * 60 * 1000; record.count = 0; }
          attempts.set(address, record);
          return json(res, 401, { error: 'Неверный логин или пароль.' });
        }
        attempts.delete(address);
        const csrf = crypto.randomBytes(24).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000, csrf })).toString('base64url');
        sessions.set(payload, { exp: Date.now() + 8 * 60 * 60 * 1000, csrf });
        const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `admin_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${secure}`);
        return json(res, 200, { authenticated: true, csrf });
      }
      if (pathname.startsWith('/api/admin/') && req.method !== 'GET') {
        const current = session(req);
        if (!current) return json(res, 401, { error: 'Необходимо войти.' });
        if (!sameOrigin(req) || req.headers['x-csrf-token'] !== current.csrf) return json(res, 403, { error: 'Недопустимый запрос.' });
        if (pathname === '/api/admin/content' && req.method === 'PUT') {
          const data = await body(req);
          if (!validContent(data)) return json(res, 400, { error: 'Некорректные настройки.' });
          await saveContent(data);
          return json(res, 200, { saved: true });
        }
        if (pathname === '/api/admin/images' && req.method === 'POST') {
          const data = await body(req, 3 * 1024 * 1024);
          return json(res, 201, { path: await uploadImage(data) });
        }
        if (pathname === '/api/admin/logout' && req.method === 'POST') {
          sessions.delete(current.id);
          res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0');
          return json(res, 200, { authenticated: false });
        }
      }
      if (pathname === '/api/admin/content' && req.method === 'GET') {
        if (!session(req)) return json(res, 401, { error: 'Необходимо войти.' });
        return json(res, 200, await readContent());
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'Не найдено.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Недопустимый метод.' });
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!/^(index\.html|styles\.css|script\.js|content\.js|admin\.js)$/.test(file) && !imagePath.test(file)) return json(res, 404, { error: 'Не найдено.' });
      let bytes;
      try { bytes = await fs.readFile(path.join(root, file)); } catch {
        if (!imagePath.test(file) || !file.startsWith('images/upload-')) return json(res, 404, { error: 'Не найдено.' });
        if (env.CONTENT_FILE) {
          try { bytes = await fs.readFile(path.join(path.dirname(env.CONTENT_FILE), file)); } catch { return json(res, 404, { error: 'Не найдено.' }); }
        } else {
          bytes = await githubImage(file);
          if (!bytes) return json(res, 404, { error: 'Не найдено.' });
        }
      }
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)], 'Cache-Control': 'public, max-age=300' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!error.status && !(error instanceof SyntaxError)) console.error(error);
      json(res, error instanceof SyntaxError ? 400 : error.status || 503, { error: error instanceof SyntaxError ? 'Некорректный JSON.' : error.status ? error.message : 'Сервис временно недоступен.' });
    }
  });
}

if (require.main === module) createServer().listen(Number(process.env.PORT) || 3000, '0.0.0.0');
module.exports = { createServer };
