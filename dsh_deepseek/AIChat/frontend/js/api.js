/* 网络层
   - 普通接口一律走 axios（配置、健康检查、生成标题）
   - 只有流式对话用 fetch + ReadableStream：浏览器里 axios 底层是 XHR，
     拿不到增量响应体，做不了真流式。 */
const API = (() => {
  const http = axios.create({
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  /** 统一的错误信息提取 */
  function describeError(err) {
    if (err?.response) {
      const data = err.response.data;
      const msg = (data && (data.error || data.message)) || err.response.statusText;
      return `后端返回 ${err.response.status}：${msg}`;
    }
    if (err?.code === 'ECONNABORTED') return '请求超时，请检查后端是否在运行。';
    return err?.message || '网络请求失败';
  }

  async function getConfig() {
    const { data } = await http.get('/api/config');
    return data;
  }


  async function health(probe = false) {
    const { data } = await http.get('/api/health', { params: probe ? { probe: 1 } : {} });
    return data;
  }

  async function makeTitle(text) {
    const { data } = await http.post('/api/title', { text });
    return data.title || '';
  }

  /**
   * 流式对话。
   * @returns {Promise<{aborted:boolean}>}
   */
  async function streamChat(payload, handlers = {}) {
    const { onMeta, onStatus, onReasoning, onDelta, onDone, onError, signal } = handlers;
    let response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return { aborted: true };
      onError?.({ message: `无法连接后端：${err.message}` });
      return { aborted: false };
    }

    if (!response.ok) {
      let message = `后端返回 ${response.status}`;
      try {
        const data = await response.json();
        message = data.error || data.message || message;
      } catch { /* 非 JSON 响应，用状态码兜底 */ }
      onError?.({ status: response.status, message });
      return { aborted: false };
    }
    if (!response.body) {
      onError?.({ message: '当前浏览器不支持流式读取响应体。' });
      return { aborted: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const handleChunk = (raw) => {
      const line = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!line) return false;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return true;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return false;
      }
      switch (event.type) {
        case 'meta': onMeta?.(event); break;
        case 'status': onStatus?.(event); break;
        case 'reasoning': onReasoning?.(event.content ?? ''); break;
        case 'delta': onDelta?.(event.content ?? ''); break;
        case 'done': onDone?.(event); break;
        case 'error': onError?.(event); break;
      }
      return false;
    };

    try {
      let sawDone = false;
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (handleChunk(chunk)) {
            sawDone = true;
            break;
          }
        }
      }
      if (!sawDone && buffer.trim()) handleChunk(buffer);
      // 服务端发完 [DONE] 就关流，这里再读一次让它自然结束；
      // 若直接 cancel 会在 DevTools 里留下一条 net::ERR_ABORTED（其实是正常收尾）
      if (sawDone) {
        try { await reader.read(); } catch { /* 已经结束 */ }
      }
      return { aborted: false };
    } catch (err) {
      if (err?.name === 'AbortError') return { aborted: true };
      onError?.({ message: `读取流式响应失败：${err.message}` });
      return { aborted: false };
    }
  }

  return { getConfig, health, makeTitle, streamChat, describeError };
})();
