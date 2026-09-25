const settingsDialog = document.querySelector('#settingsDialog');
const settingsFields = document.querySelector('#settingsFields');
const settingsStatus = document.querySelector('#settingsStatus');
let csrf = null;

async function adminRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера.');
  return data;
}

function editableField(group, label, key, value, type = 'text') {
  const wrapper = document.createElement('label');
  wrapper.className = 'setting-field';
  const heading = document.createElement('span');
  heading.textContent = label;
  const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  if (type !== 'textarea') input.type = type;
  input.name = key;
  input.dataset.group = group;
  input.value = value;
  wrapper.append(heading, input);
  if (group === 'images') {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp';
    picker.className = 'image-picker';
    picker.removeAttribute('name');
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { settingsStatus.textContent = 'Фото должно быть не больше 2 МБ.'; picker.value = ''; return; }
      picker.disabled = true;
      settingsStatus.textContent = 'Загружаем фотографию…';
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
          reader.readAsDataURL(file);
        });
        const result = await adminRequest('/api/admin/images', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
        input.value = result.path;
        settingsStatus.textContent = 'Фото загружено. Нажмите «Сохранить изменения», чтобы показать его на сайте.';
      } catch (error) { settingsStatus.textContent = error.message; }
      finally { picker.disabled = false; picker.value = ''; }
    });
    wrapper.append(picker);
  }
  return wrapper;
}

function settingsGroup(title, name, fields) {
  if (!fields.length) return;
  const section = document.createElement('details');
  section.className = 'settings-group';
  const summary = document.createElement('summary');
  summary.textContent = `${title} · ${fields.length}`;
  section.append(summary, ...fields);
  settingsFields.append(section);
}

async function openSettings() {
  await siteEditor.loaded;
  const data = await adminRequest('/api/admin/content');
  siteEditor.apply(data);
  settingsFields.replaceChildren();
  const groups = new Map();
  for (const { key, node, group } of siteEditor.texts()) {
    if (!groups.has(group)) groups.set(group, []);
    const value = data.texts[key] ?? node.nodeValue.trim();
    groups.get(group).push(editableField('texts', value.slice(0, 72), key, value, value.length > 80 ? 'textarea' : 'text'));
  }
  for (const [name, fields] of groups) settingsGroup(name, name, fields);
  settingsGroup('Ссылки', 'links', siteEditor.attributes('a[href]').map(({ key, node }) => editableField('links', node.textContent.trim().slice(0, 72) || 'Ссылка', key, data.links[key] ?? node.getAttribute('href'))));
  settingsGroup('Фото: выбрать файл или указать путь', 'images', siteEditor.attributes('img[src]').map(({ key, node }) => editableField('images', node.alt || 'Изображение', key, data.images[key] ?? node.getAttribute('src'))));
  settingsGroup('Цвета оформления', 'colors', siteEditor.colors.map((name) => editableField('colors', name, name, data.colors[name] ?? getComputedStyle(document.documentElement).getPropertyValue(name).trim(), 'color')));
  settingsStatus.textContent = '';
  document.querySelector('#adminDialog').close();
  settingsDialog.showModal();
}

document.querySelector('#adminForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#adminStatus');
  status.textContent = 'Проверяем данные…';
  try {
    const result = await adminRequest('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value })
    });
    csrf = result.csrf;
    form.reset();
    await openSettings();
  } catch (error) {
    status.textContent = error instanceof SyntaxError || error instanceof TypeError ? 'Сервер авторизации пока не подключён.' : error.message;
  } finally { form.elements.password.value = ''; }
});

document.querySelector('#adminButton').addEventListener('click', async () => {
  try {
    const status = await adminRequest('/api/admin/session');
    if (status.authenticated) {
      csrf = status.csrf;
      await openSettings();
    }
  } catch { /* The public site may still be hosted as a static service. */ }
});

document.querySelector('#settingsClose').addEventListener('click', () => settingsDialog.close());

document.querySelector('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = { texts: {}, links: {}, images: {}, colors: {} };
  for (const field of settingsFields.querySelectorAll('[data-group]')) data[field.dataset.group][field.name] = field.value.trim();
  settingsStatus.textContent = 'Сохраняем…';
  try {
    await adminRequest('/api/admin/content', { method: 'PUT', body: JSON.stringify(data) });
    siteEditor.apply(data);
    settingsStatus.textContent = 'Сохранено. Изменения появятся у посетителей в течение 30 секунд.';
  } catch (error) { settingsStatus.textContent = error.message; }
});

document.querySelector('#settingsLogout').addEventListener('click', async () => {
  try { await adminRequest('/api/admin/logout', { method: 'POST' }); } catch { /* Clear the local session view anyway. */ }
  csrf = null;
  settingsDialog.close();
});
