/* UI 逻辑：串联 Store（本地状态）、API（网络）、Markdown（渲染） */
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    sidebar: $('sidebar'), scrim: $('scrim'), menuBtn: $('menuBtn'),
    convList: $('convList'), newChatBtn: $('newChatBtn'),
    settingsBtn: $('settingsBtn'), settingsDrawer: $('settingsDrawer'), closeSettings: $('closeSettings'),
    chatTitle: $('chatTitle'), modelBadge: $('modelBadge'),
    clearBtn: $('clearBtn'), exportBtn: $('exportBtn'),
    messages: $('messages'), toBottom: $('toBottom'),
    input: $('input'), sendBtn: $('sendBtn'), stopBtn: $('stopBtn'),
    modelSelect: $('modelSelect'), tokenInfo: $('tokenInfo'),
    systemPrompt: $('systemPrompt'), temperature: $('temperature'), tempValue: $('tempValue'),
    maxTokens: $('maxTokens'), thinkingToggle: $('thinkingToggle'),
    probeBtn: $('probeBtn'), probeResult: $('probeResult'),
    endpointHint: $('endpointHint'), wipeBtn: $('wipeBtn'), toasts: $('toasts'),
  };

  const SUGGESTIONS = [
    ['解释一段代码', '把这段代码讲清楚，并指出潜在问题'],
    ['写一个函数', '用 Python 写一个带重试和退避的 HTTP 请求函数'],
    ['比较技术方案', '对比 Flask 和 FastAPI，给出选型建议表格'],
    ['排查报错', '帮我分析这个报错的原因和修复方向'],
  ];

  let config = null;
  let streaming = false;
  let controller = null;
  let liveBubble = null;
  let liveText = '';
  let liveReasoning = '';
  let thinkingLive = false;
  let renderPending = false;
  let stickToBottom = true;

  const CHEV =
    '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
  const SPARK =
    '<svg class="spark" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1"/><circle cx="12" cy="12" r="2.6"/></svg>';

  /* ---------------- 工具 ---------------- */
  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  function setConn(kind, text) {
    const box = $('connState');
    box.className = `conn ${kind}`;
    box.querySelector('span').textContent = text;
  }

  const nearBottom = () =>
    els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 90;

  function scrollToBottom(force = false) {
    if (force || stickToBottom) els.messages.scrollTop = els.messages.scrollHeight;
    els.toBottom.hidden = nearBottom();
  }

  /* ---------------- 渲染：侧边栏 ---------------- */
  function renderSidebar() {
    const list = Store.conversations();
    els.convList.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'conv-empty';
      empty.textContent = '还没有对话，点上面「新建对话」开始。';
      els.convList.appendChild(empty);
      return;
    }
    for (const conv of list) {
      const item = document.createElement('div');
      item.className = `conv-item${conv.id === Store.activeId() ? ' active' : ''}`;
      item.innerHTML =
        `<svg class="conv-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>` +
        `<span class="conv-title"></span>` +
        `<button class="conv-del" title="删除会话"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
      item.querySelector('.conv-title').textContent = conv.title;
      item.addEventListener('click', () => {
        Store.select(conv.id);
        closeMobileNav();
      });
      item.querySelector('.conv-del').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.remove(conv.id);
      });
      els.convList.appendChild(item);
    }
  }

  /* ---------------- 渲染：消息区 ---------------- */
  function welcomeEl() {
    const box = document.createElement('div');
    box.className = 'welcome';
    box.innerHTML =
      `<div class="welcome-logo">AI</div>` +
      `<h2>今天想聊点什么？</h2>` +
      `<p>由智谱 ${Markdown.escapeHtml(config?.primaryModel || 'GLM')} 驱动 · 支持流式输出与 Markdown 渲染</p>` +
      `<div class="suggestions"></div>`;
    const grid = box.querySelector('.suggestions');
    for (const [title, desc] of SUGGESTIONS) {
      const btn = document.createElement('button');
      btn.className = 'suggestion';
      btn.innerHTML = `<b></b><span></span>`;
      btn.querySelector('b').textContent = title;
      btn.querySelector('span').textContent = desc;
      btn.addEventListener('click', () => {
        els.input.value = desc;
        autoGrow();
        els.input.focus();
      });
      grid.appendChild(btn);
    }
    return box;
  }

  /** 思维链折叠面板。流式期间保持展开，正文一开始就自动收起。 */
  function thinkEl(text, { open = false, live = false } = {}) {
    const details = document.createElement('details');
    details.className = `think${live ? ' live' : ''}`;
    details.open = open;

    const summary = document.createElement('summary');
    summary.innerHTML = `${SPARK}<span class="think-label"></span><small></small>${CHEV}`;
    summary.querySelector('.think-label').textContent = live ? '正在思考…' : '思考过程';
    summary.querySelector('small').textContent = `${text.length} 字`;

    const body = document.createElement('div');
    body.className = 'think-body';
    // 思维链同样按 Markdown 渲染（经 DOMPurify 净化），否则 `**加粗**` 会以字面星号显示
    body.innerHTML = Markdown.render(text);

    details.append(summary, body);
    return details;
  }

  function messageEl(msg) {
    const row = document.createElement('div');
    row.className = `msg ${msg.role}`;
    row.dataset.id = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = msg.role === 'user' ? '我' : 'AI';

    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (msg.role === 'user') {
      // 用户输入当成纯文本，避免被当成 Markdown/HTML 解析
      bubble.classList.add('plain');
      bubble.textContent = msg.content;
    } else {
      if (msg.reasoning) bubble.appendChild(thinkEl(msg.reasoning, { open: false }));
      const md = document.createElement('div');
      md.innerHTML = Markdown.render(msg.content);
      bubble.appendChild(md);
    }
    wrap.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copyText(msg.content));
    meta.appendChild(copyBtn);

    if (msg.role === 'assistant') {
      if (msg.model) {
        const tag = document.createElement('span');
        tag.textContent =
          msg.model +
          (msg.fallback ? '（已降级）' : '') +
          (msg.usage?.total_tokens ? ` · ${msg.usage.total_tokens} tokens` : '');
        if (msg.fallback) tag.title = '主模型当时不可用，这条回复来自降级模型';
        meta.appendChild(tag);
      }
      const regen = document.createElement('button');
      regen.textContent = '重新生成';
      regen.addEventListener('click', () => regenerate(msg.id));
      meta.appendChild(regen);
    }
    wrap.appendChild(meta);

    row.append(avatar, wrap);
    return { row, bubble };
  }

  function renderMessages() {
    const conv = Store.active();
    els.messages.innerHTML = '';
    els.chatTitle.textContent = conv ? conv.title : '新对话';
    if (!conv || !conv.messages.length) {
      els.messages.appendChild(welcomeEl());
      els.tokenInfo.textContent = '';
      els.modelBadge.textContent = config?.primaryModel || '—';
      els.modelBadge.classList.remove('fallback');
      scrollToBottom(true);
      return;
    }
    for (const msg of conv.messages) {
      els.messages.appendChild(messageEl(msg).row);
    }
    const last = conv.messages[conv.messages.length - 1];
    if (last.role === 'assistant' && last.model) {
      els.modelBadge.textContent = last.model;
      els.modelBadge.classList.toggle('fallback', Boolean(last.fallback));
    }
    scrollToBottom(true);
  }

  /** 流式过程中按帧节流地重绘当前气泡 */
  function paintLive(caret = true) {
    if (!liveBubble) return;
    // 思考面板一律默认收起，由用户点击展开：自动开合会在"边想边说"时反复弹动，
    // 得不偿失。流式期间用 live 样式 + 「正在思考…」标签表达状态即可。
    const thinking = thinkingLive && !liveText;
    liveBubble.innerHTML = '';
    if (liveReasoning) {
      liveBubble.appendChild(thinkEl(liveReasoning, { open: false, live: thinking }));
    }
    if (liveText) {
      const md = document.createElement('div');
      md.innerHTML = Markdown.render(liveText);
      liveBubble.appendChild(md);
    }
    const tail = document.createElement('span');
    tail.className = 'gen-tail';
    if (liveText) {
      if (caret) tail.innerHTML = '<span class="caret"></span>';
    } else {
      tail.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }
    liveBubble.appendChild(tail);
  }

  function queuePaint(caret = true) {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      paintLive(caret);
      scrollToBottom();
    });
  }

  /* ---------------- 发送 / 流式 ---------------- */
  function buildPayload() {
    const conv = Store.active();
    if (!conv) return null;
    const messages = conv.messages
      .filter((m) => m.content && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    const s = Store.settings;
    return {
      messages,
      model: s.model || undefined,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      system: s.systemPrompt || undefined,
      thinking: s.thinking ? 'enabled' : 'disabled',
    };
  }

  async function runStream(assistantMsgId) {
    const payload = buildPayload();
    if (!payload) return;

    streaming = true;
    controller = new AbortController();
    els.sendBtn.hidden = true;
    els.stopBtn.hidden = false;

    const row = els.messages.querySelector(`.msg[data-id="${assistantMsgId}"]`);
    liveBubble = row ? row.querySelector('.bubble') : null;
    liveText = '';
    liveReasoning = '';
    thinkingLive = false;
    if (liveBubble) liveBubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

    let model = '';
    let usage = null;
    let fallback = false;
    let failed = false;

    const removeNotices = () => els.messages.querySelectorAll('.notice[data-temp="1"]').forEach((n) => n.remove());
    const addNotice = (text, isError = false) => {
      const el = document.createElement('div');
      el.className = `notice${isError ? ' error' : ''}`;
      el.dataset.temp = '1';
      el.textContent = text;
      if (row) row.parentElement.insertBefore(el, row);
      else els.messages.appendChild(el);
      scrollToBottom();
      return el;
    };

    await API.streamChat(payload, {
      signal: controller.signal,
      onMeta(event) {
        model = event.model;
        fallback = Boolean(event.fallback);
        els.modelBadge.textContent = model;
        els.modelBadge.classList.toggle('fallback', fallback);
        if (fallback) {
          addNotice(`${event.requested} 当前不可用，已自动降级到 ${model}`);
        }
      },
      onStatus(event) {
        removeNotices();
        addNotice(event.message);
      },
      onReasoning(piece) {
        liveReasoning += piece;
        // 正文一旦开始就不再重新展开思考面板：模型可能边想边说，
        // 如果这里无条件置 true，面板会在回答中途反复弹开。
        if (!liveText) thinkingLive = true;
        queuePaint();
      },
      onDelta(piece) {
        if (!liveText) thinkingLive = false; // 正文开始，思考面板自动收起
        liveText += piece;
        queuePaint();
      },
      onDone(event) {
        if (event.model) model = event.model;
        usage = event.usage || null;
        if (event.truncated && event.message) addNotice(event.message, true);
      },
      onError(event) {
        failed = true;
        addNotice(event.message || '请求失败', true);
      },
    });

    streaming = false;
    controller = null;
    els.sendBtn.hidden = false;
    els.stopBtn.hidden = true;
    removeNotices();

    if (!liveText) {
      // 一个字正文都没拿到：别留下空气泡
      let placeholder = failed ? '（本次没有得到回复，请稍后重试或切换模型）' : '（已停止生成）';
      Store.updateMessage(assistantMsgId, {
        content: placeholder,
        reasoning: liveReasoning || undefined,
        model: model || undefined,
      });
      renderMessages();
      return;
    }

    if (liveBubble) paintLive(false);
    Store.updateMessage(assistantMsgId, {
      content: liveText,
      reasoning: liveReasoning || undefined,
      model: model || undefined,
      usage: usage || undefined,
      fallback,
    });
    renderMessages(); // 显式收尾一次，保证最终 DOM 与 store 完全一致
    if (usage?.total_tokens) els.tokenInfo.textContent = `最近一次 ${usage.total_tokens} tokens`;
    liveBubble = null;
    liveText = '';
    liveReasoning = '';
    scrollToBottom();
  }

  async function send() {
    const text = els.input.value.trim();
    if (!text || streaming) return;
    if (!Store.active()) Store.create();
    Store.addMessage('user', text);
    els.input.value = '';
    autoGrow();
    renderMessages();
    scrollToBottom(true);
    stickToBottom = true;

    const assistant = Store.addMessage('assistant', '');
    renderMessages();
    reactivateTitle(text);
    await runStream(assistant.id);
  }
  async function regenerate(assistantMsgId) {
    if (streaming) {
      toast('正在生成中，请先停止', 'error');
      return;
    }
    const conv = Store.active();
    if (!conv) return;
    const index = conv.messages.findIndex((m) => m.id === assistantMsgId);
    if (index < 0) return;
    conv.messages = conv.messages.slice(0, index);
    const assistant = Store.addMessage('assistant', '');
    renderMessages();
    await runStream(assistant.id);
  }

  function stop() {
    if (controller) controller.abort();
  }

  /** 首条消息后异步起个标题（走 axios 的非流式接口） */
  async function reactivateTitle(firstText) {
    const conv = Store.active();
    if (!conv || conv.title !== '新对话') return;
    if (conv.messages.filter((m) => m.role === 'user').length !== 1) return;
    try {
      const title = await API.makeTitle(firstText);
      if (title) Store.rename(conv.id, title);
    } catch (err) {
      // 标题只是锦上添花，失败就保留默认名
      console.warn('生成标题失败：', API.describeError(err));
    }
  }

  /* ---------------- 其它交互 ---------------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制', 'ok');
    } catch {
      toast('复制失败，请手动选择文本', 'error');
    }
  }

  function exportMarkdown() {
    const conv = Store.active();
    if (!conv || !conv.messages.length) {
      toast('当前对话是空的', 'error');
      return;
    }
    const lines = [`# ${conv.title}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const m of conv.messages) {
      lines.push(`## ${m.role === 'user' ? '我' : 'AIChat'}`, '', m.content, '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 190)}px`;
  }

  function openMobileNav() { els.sidebar.classList.add('open'); els.scrim.classList.add('show'); }
  function closeMobileNav() { els.sidebar.classList.remove('open'); els.scrim.classList.remove('show'); }

  function applySettingsToForm() {
    const s = Store.settings;
    els.systemPrompt.value = s.systemPrompt || config?.defaultSystemPrompt || '';
    els.temperature.value = s.temperature;
    els.tempValue.textContent = Number(s.temperature).toFixed(1);
    els.maxTokens.value = s.maxTokens;
    els.thinkingToggle.checked = Boolean(s.thinking);
  }

  function renderModelSelect() {
    const models = config?.models || [];
    els.modelSelect.innerHTML = '';
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + (name === config.primaryModel ? '（默认）' : '');
      els.modelSelect.appendChild(opt);
    }
    els.modelSelect.value = Store.settings.model || config?.primaryModel || models[0] || '';
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    els.newChatBtn.addEventListener('click', () => { Store.create(); closeMobileNav(); els.input.focus(); });
    els.sendBtn.addEventListener('click', send);
    els.stopBtn.addEventListener('click', stop);
    els.clearBtn.addEventListener('click', () => {
      if (!Store.active()?.messages.length) return;
      if (confirm('清空当前对话的全部消息？')) Store.clearActive();
    });
    els.exportBtn.addEventListener('click', exportMarkdown);
    els.wipeBtn.addEventListener('click', () => {
      if (confirm('删除全部会话？该操作不可撤销。')) { Store.wipe(); toast('已清空全部会话', 'ok'); }
    });

    els.input.addEventListener('input', autoGrow);
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });

    els.messages.addEventListener('scroll', () => {
      stickToBottom = nearBottom();
      els.toBottom.hidden = stickToBottom;
    });
    els.toBottom.addEventListener('click', () => { stickToBottom = true; scrollToBottom(true); });

    // 代码块复制（事件委托，避免为每个块单独绑定）
    els.messages.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-code');
      if (!btn) return;
      const code = btn.closest('.code-block')?.querySelector('code');
      if (code) copyText(code.textContent);
    });

    // 标题双击重命名
    els.chatTitle.addEventListener('dblclick', () => {
      const conv = Store.active();
      if (!conv) return;
      els.chatTitle.contentEditable = 'true';
      els.chatTitle.focus();
      document.getSelection()?.selectAllChildren(els.chatTitle);
    });
    const commitTitle = () => {
      if (els.chatTitle.contentEditable !== 'true') return;
      els.chatTitle.contentEditable = 'false';
      const conv = Store.active();
      if (conv) Store.rename(conv.id, els.chatTitle.textContent || '');
    };
    els.chatTitle.addEventListener('blur', commitTitle);
    els.chatTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); els.chatTitle.blur(); }
      if (e.key === 'Escape') { els.chatTitle.textContent = Store.active()?.title || '新对话'; els.chatTitle.blur(); }
    });

    // 设置抽屉
    const openSettings = () => { applySettingsToForm(); els.settingsDrawer.classList.add('open'); };
    const closeSettings = () => els.settingsDrawer.classList.remove('open');
    els.settingsBtn.addEventListener('click', openSettings);
    els.closeSettings.addEventListener('click', closeSettings);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeSettings(); closeMobileNav(); }
    });

    els.systemPrompt.addEventListener('change', () => Store.setSettings({ systemPrompt: els.systemPrompt.value }));
    els.temperature.addEventListener('input', () => {
      els.tempValue.textContent = Number(els.temperature.value).toFixed(1);
      Store.setSettings({ temperature: Number(els.temperature.value) });
    });
    els.maxTokens.addEventListener('change', () => {
      const value = Math.min(Math.max(Number(els.maxTokens.value) || 4096, 128), 8192);
      els.maxTokens.value = value;
      Store.setSettings({ maxTokens: value });
    });
    els.thinkingToggle.addEventListener('change', () => {
      Store.setSettings({ thinking: els.thinkingToggle.checked });
      if (els.thinkingToggle.checked && Number(els.maxTokens.value) < 4096) {
        els.maxTokens.value = 4096;
        Store.setSettings({ maxTokens: 4096 });
        toast('已把最大回复长度提到 4096：思维链会占用输出预算', 'ok');
      }
    });
    els.modelSelect.addEventListener('change', () => Store.setSettings({ model: els.modelSelect.value }));

    els.probeBtn.addEventListener('click', async () => {
      els.probeBtn.disabled = true;
      els.probeResult.className = 'probe-result';
      els.probeResult.textContent = '正在连接上游…';
      try {
        const data = await API.health(true);
        const probe = data.probe || {};
        if (probe.ok) {
          els.probeResult.className = 'probe-result ok';
          els.probeResult.textContent = `连接正常，响应模型：${probe.model}`;
          setConn('ok', `在线 · ${probe.model}`);
        } else {
          els.probeResult.className = 'probe-result bad';
          els.probeResult.textContent = probe.message || '上游不可用';
          setConn('bad', '上游异常');
        }
      } catch (err) {
        els.probeResult.className = 'probe-result bad';
        els.probeResult.textContent = API.describeError(err);
        setConn('bad', '后端未连接');
      } finally {
        els.probeBtn.disabled = false;
      }
    });

    els.menuBtn.addEventListener('click', openMobileNav);
    els.scrim.addEventListener('click', closeMobileNav);
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    Store.load();
    // 流式期间不要重绘消息区：气泡 DOM 会被替换掉，liveBubble 就指向了已脱离文档的节点。
    // 侧边栏可以随时重绘（生成标题时会触发）。
    Store.subscribe(() => {
      renderSidebar();
      if (!streaming) renderMessages();
    });
    bind();
    autoGrow();

    try {
      config = await API.getConfig();
      renderModelSelect();
      applySettingsToForm();
      const lines = [];
      if (config.hasApiKey) {
        lines.push(`接口：${config.endpoint}`);
      } else {
        lines.push('后端未检测到 ZHIPU_API_KEY，请在 AIChat/.env 中配置后重启后端。');
      }
      if (config.models?.length) lines.push(`调用链：${config.models.join(' → ')}`);
      if (config.freeOnly) {
        lines.push(`🔒 免费模式已开启：只允许 ${config.allowedModels.join('、')}`);
      } else {
        lines.push('⚠️ 免费模式已关闭：可能调用到计费模型，请自行确认');
      }
      if (config.blockedConfiguredModels?.length) {
        lines.push(`已忽略配置中的付费模型：${config.blockedConfiguredModels.join('、')}`);
      }
      els.endpointHint.textContent = lines.join('\n');
      setConn(
        config.hasApiKey ? 'ok' : 'warn',
        config.hasApiKey ? (config.freeOnly ? '后端就绪 · 免费' : '后端就绪') : '缺少 API Key',
      );
    } catch (err) {
      setConn('bad', '后端未连接');
      toast(`读取配置失败：${API.describeError(err)}`, 'error');
    }

    if (!Store.active() && Store.conversations().length === 0) Store.create();
    else if (!Store.active()) Store.select(Store.conversations()[0].id);

    renderSidebar();
    renderMessages();
    els.input.focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
