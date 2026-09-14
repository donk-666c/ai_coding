/* 会话状态：全部存 localStorage，后端不保存任何对话内容。 */
const Store = (() => {
  const KEY = 'aichat.v1';
  const listeners = new Set();

  const defaults = () => ({
    conversations: [],
    activeId: null,
    settings: {
      model: '',
      // 女友场景的默认值：温度高一点更有人味，回复短一点更像聊天
      temperature: 0.9,
      maxTokens: 1024,
      systemPrompt: '',
      thinking: false,
    },
  });

  let state = defaults();
  let memoryOnly = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...(parsed.settings || {}) } };
      }
    } catch (err) {
      memoryOnly = true;
      console.warn('读取本地会话失败，改为仅内存模式：', err);
    }
  }

  function persist() {
    if (memoryOnly) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      memoryOnly = true;
      console.warn('写入本地会话失败，改为仅内存模式：', err);
    }
  }

  function emit() {
    persist();
    listeners.forEach((fn) => fn());
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const sorted = () => [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const active = () => state.conversations.find((c) => c.id === state.activeId) || null;

  function create(title = '新对话', persona = null) {
    const now = Date.now();
    const conv = { id: uid(), title, createdAt: now, updatedAt: now, messages: [], persona: persona || null };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    emit();
    return conv;
  }

  /** 设置（或更换）某个会话的女友人设；会话标题同步成她的名字。 */
  function setPersona(id, persona) {
    const conv = state.conversations.find((c) => c.id === id) || active();
    if (!conv) return;
    conv.persona = persona || null;
    if (persona && persona.name) conv.title = persona.name;
    conv.updatedAt = Date.now();
    emit();
  }

  function remove(id) {
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (state.activeId === id) state.activeId = sorted()[0]?.id ?? null;
    emit();
  }

  function rename(id, title) {
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) return;
    conv.title = title.trim() || '新对话';
    conv.updatedAt = Date.now();
    emit();
  }

  function select(id) {
    state.activeId = id;
    emit();
  }

  function addMessage(role, content, extra = {}) {
    let conv = active();
    if (!conv) conv = create();
    const msg = { id: uid(), role, content, ts: Date.now(), ...extra };
    conv.messages.push(msg);
    conv.updatedAt = Date.now();
    emit();
    return msg;
  }

  function updateMessage(msgId, patch) {
    const conv = active();
    if (!conv) return;
    const msg = conv.messages.find((m) => m.id === msgId);
    if (!msg) return;
    Object.assign(msg, patch);
    conv.updatedAt = Date.now();
    emit();
  }

  function dropTrailing(role) {
    const conv = active();
    if (!conv) return;
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role === role) {
      conv.messages.pop();
    }
    emit();
  }

  function clearActive() {
    const conv = active();
    if (!conv) return;
    conv.messages = [];
    conv.updatedAt = Date.now();
    emit();
  }

  function wipe() {
    state = defaults();
    emit();
  }

  function setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    emit();
  }

  return {
    load,
    subscribe(fn) { listeners.add(fn); },
    get state() { return state; },
    get settings() { return state.settings; },
    conversations: sorted,
    active,
    activeId: () => state.activeId,
    create, remove, rename, select, setPersona,
    addMessage, updateMessage, dropTrailing, clearActive, wipe, setSettings,
    isMemoryOnly: () => memoryOnly,
  };
})();
