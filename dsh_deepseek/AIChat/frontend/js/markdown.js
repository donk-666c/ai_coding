/* Markdown 渲染：marked 解析 → DOMPurify 净化 → highlight.js 高亮
   代码块额外包一层带「语言标签 + 复制按钮」的外壳。 */
const Markdown = (() => {
  const escapeHtml = (text) =>
    String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const renderer = new marked.Renderer();

  // marked 的 code 渲染器在不同大版本里签名不同，这里两种都兼容
  renderer.code = function (codeOrToken, maybeLang) {
    const isToken = typeof codeOrToken === 'object' && codeOrToken !== null;
    const text = String(isToken ? codeOrToken.text : codeOrToken ?? '');
    const lang = String((isToken ? codeOrToken.lang : maybeLang) || '').trim().split(/\s+/)[0];

    let body;
    let label = lang || 'text';
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      try {
        body = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      } catch {
        body = escapeHtml(text);
      }
    } else {
      body = escapeHtml(text);
      if (!lang) label = 'code';
    }

    return (
      `<div class="code-block">` +
      `<div class="code-head"><span>${escapeHtml(label)}</span>` +
      `<button type="button" class="copy-code">复制</button></div>` +
      `<pre><code class="hljs">${body}</code></pre>` +
      `</div>`
    );
  };

  marked.setOptions({ gfm: true, breaks: true, renderer });

  /** 把 Markdown 文本转成可安全插入 DOM 的 HTML。 */
  function render(text) {
    if (!text) return '';
    let html;
    try {
      html = marked.parse(String(text));
    } catch (err) {
      return `<p>${escapeHtml(text)}</p>`;
    }
    if (window.DOMPurify) {
      html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
    }
    return html;
  }

  return { render, escapeHtml };
})();
