const siteEditor = (() => {
  const roots = ['header', 'main', 'footer'];
  const content = { texts: {}, links: {}, images: {}, colors: {} };
  const colors = ['--clay', '--amber', '--pine', '--pine-dark', '--cream', '--paper'];

  function key(node) {
    const indices = [];
    let current = node;
    while (current?.parentNode && !roots.includes(current.nodeName.toLowerCase())) {
      indices.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
      current = current.parentNode;
    }
    return current ? `${current.nodeName.toLowerCase()}:${indices.join('.')}` : '';
  }

  function nodeForKey(value) {
    const [root, indices] = value.split(':');
    if (!roots.includes(root) || !indices) return null;
    return indices.split('.').reduce((node, index) => node?.childNodes[Number(index)], document.querySelector(root));
  }

  function texts() {
    const result = [];
    for (const name of roots) {
      const root = document.querySelector(name);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue.trim().length < 2 || node.parentElement.closest('script, style, svg, .speech-panel, .admin-dialog')) continue;
        const section = node.parentElement.closest('section');
        result.push({ key: key(node), node, group: section?.id || section?.classList[0] || name });
      }
    }
    return result;
  }

  function attributes(selector) {
    return roots.flatMap((root) => [...document.querySelector(root).querySelectorAll(selector)].map((node) => ({ key: key(node), node })));
  }

  function apply(data) {
    if (!data || typeof data !== 'object') return;
    for (const [name, value] of Object.entries(data.texts || {})) {
      const node = nodeForKey(name);
      if (node?.nodeType === Node.TEXT_NODE && typeof value === 'string') {
        const original = node.nodeValue;
        node.nodeValue = `${original.match(/^\s*/)[0]}${value}${original.match(/\s*$/)[0]}`;
      }
    }
    for (const [name, value] of Object.entries(data.links || {})) {
      const node = nodeForKey(name);
      if (node?.tagName === 'A' && /^(https:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d -]+|#[a-zA-Z0-9_-]+)$/.test(value)) node.setAttribute('href', value);
    }
    for (const [name, value] of Object.entries(data.images || {})) {
      const node = nodeForKey(name);
      if (node?.tagName === 'IMG' && /^images\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp)$/.test(value)) node.setAttribute('src', value);
    }
    for (const name of colors) {
      if (/^#[0-9a-fA-F]{6}$/.test(data.colors?.[name] || '')) document.documentElement.style.setProperty(name, data.colors[name]);
    }
    Object.assign(content, data);
  }

  const loaded = fetch('/api/content', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then(apply).catch(() => {});
  return { texts, attributes, colors, apply, content, loaded };
})();
