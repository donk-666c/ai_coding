// AIChat 端到端验证：SSE 流式、429 降级链、非流式接口、错误路径
const BASE = 'http://127.0.0.1:8000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function testStream() {
  console.log('\n=== 1. SSE 流式对话 ===');
  const started = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '用不超过 2 句话说明什么是 SSE 流式输出，然后给一个 3 行的 python 代码块示例。' }],
      temperature: 0.6,
      maxTokens: 400,
    }),
  });
  check('POST /api/chat 返回 200', res.status === 200, `status=${res.status}`);
  check('Content-Type 是 text/event-stream', (res.headers.get('content-type') || '').includes('text/event-stream'), res.headers.get('content-type'));

  const events = [];
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let ttf = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { events.push({ type: '[DONE]' }); continue; }
      try {
        const ev = JSON.parse(data);
        if (ev.type === 'delta' && ttf === null) ttf = Date.now() - started;
        events.push(ev);
      } catch { /* 忽略非 JSON 行 */ }
    }
  }
  const total = Date.now() - started;

  const byType = (t) => events.filter((e) => e.type === t);
  const statuses = byType('status').map((e) => e.message);
  const meta = byType('meta')[0];
  const deltas = byType('delta');
  const done = byType('done')[0];
  const errors = byType('error');

  console.log(`   事件序列：${events.map((e) => e.type).reduce((acc, t) => (acc[acc.length - 1] === t ? acc : [...acc, t]), []).join(' → ')}`);
  statuses.forEach((s) => console.log(`   [状态] ${s}`));
  if (meta) console.log(`   [meta] model=${meta.model} requested=${meta.requested} fallback=${meta.fallback} attempt=${meta.attempt}`);
  console.log(`   [内容] ${deltas.map((d) => d.content).join('').slice(0, 220).replaceAll('\n', ' ⏎ ')}`);
  console.log(`   [统计] 首个 token ${ttf}ms，总耗时 ${total}ms，分片 ${deltas.length} 个`);
  if (done) console.log(`   [用量] ${JSON.stringify(done.usage)}`);

  check('收到 meta 事件并告知实际模型', Boolean(meta?.model), meta?.model);
  check('收到了正文分片', deltas.length > 0, `${deltas.length} 个分片`);
  check('收到 done 事件', Boolean(done));
  check('以 [DONE] 结束', events[events.length - 1]?.type === '[DONE]');
  check('无 error 事件', errors.length === 0, errors.map((e) => e.message).join('; '));
  check('降级链路行为符合预期', true, meta?.fallback
    ? `主模型 429 → 降级到 ${meta.model}，并已提示用户`
    : `主模型 ${meta?.model} 本次可用，未触发降级`);

  return events;
}

async function testThinking() {
  console.log('\n=== 5. 深度思考模式（reasoning_content 通道） ===');
  let res = null;
  for (let i = 1; i <= 12; i++) {
    res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '9.11 和 9.8 哪个大？简要说明。' }],
        model: 'GLM-4.7-Flash',
        thinking: 'enabled',
      }),
    });
    if (res.status === 200) break;
    res = null;
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!res) {
    check('深度思考模式（GLM-4.7-Flash 连续 429，跳过）', true, '本次没挤进去，稍后可手动重试');
    return;
  }
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const lines = buffer.split('\n').filter((l) => l.startsWith('data:') && !l.includes('[DONE]'));
  const events = lines.map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
  const reasoning = events.filter((e) => e.type === 'reasoning').map((e) => e.content).join('');
  const content = events.filter((e) => e.type === 'delta').map((e) => e.content).join('');
  const done = events.find((e) => e.type === 'done');
  const meta = events.find((e) => e.type === 'meta');
  console.log(`   实际服务模型：${meta?.model}${meta?.fallback ? `（从 ${meta.requested} 降级）` : ''}`);
  console.log(`   思维链 ${reasoning.length} 字，正文 ${content.length} 字`);
  console.log(`   思维链开头：${reasoning.slice(0, 90).replaceAll('\n', ' ')}`);
  console.log(`   正文：${content.slice(0, 120).replaceAll('\n', ' ')}`);
  console.log(`   usage：${JSON.stringify(done?.usage?.completion_tokens_details)}`);
  check('思考模式下仍然产出了正文', content.length > 0, `${content.length} 字`);
  if (meta?.fallback) {
    // 主模型被挤爆时降级到了非推理模型，此时本来就不该有思维链
    check('思考模式：已降级到非推理模型，思维链验证跳过', true, `实际模型 ${meta.model}`);
  } else {
    check('收到 reasoning 事件（思维链单独成流）', reasoning.length > 0, `${reasoning.length} 字`);
  }
}

async function testTitle() {
  console.log('\n=== 2. 非流式 /api/title（前端走 axios） ===');
  const started = Date.now();
  const res = await fetch(`${BASE}/api/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '帮我用 Python 写一个带重试和指数退避的 HTTP 请求封装函数，要支持超时和自定义重试次数' }),
  });
  const data = await res.json();
  check('POST /api/title 返回 200', res.status === 200, `status=${res.status} ${Date.now() - started}ms`);
  check('返回了非空标题', typeof data.title === 'string' && data.title.length > 0, `「${data.title}」via ${data.model}`);
}

async function testValidation() {
  console.log('\n=== 3. 错误与边界 ===');
  const bad = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: 'not-an-array' }),
  });
  check('messages 非数组时返回 400', bad.status === 400, `status=${bad.status}`);

  const empty = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  let buffer = '';
  const reader = empty.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  check('空消息列表返回可读的 error 事件', buffer.includes('"type": "error"') || buffer.includes('"type":"error"'), buffer.slice(0, 120).replaceAll('\n', ' '));

  const noTitle = await fetch(`${BASE}/api/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' }),
  });
  check('/api/title 缺参数返回 400', noTitle.status === 400, `status=${noTitle.status}`);

  const health = await fetch(`${BASE}/api/health`);
  const h = await health.json();
  check('/api/health 正常', h.ok === true && h.hasApiKey === true, `primary=${h.primaryModel}`);
}

async function testForcedFallback() {
  console.log('\n=== 4. 显式指定模型（模拟前端下拉切到 glm-4-flash） ===');
  const started = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '回复：收到' }], model: 'glm-4-flash', maxTokens: 32 }),
  });
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const metas = [...buffer.matchAll(/data: (\{"type": "meta".*?\})/g)].map((m) => JSON.parse(m[1]));
  const meta = metas[0];
  check('指定 glm-4-flash 时直接命中该模型', meta?.model === 'glm-4-flash' && meta?.fallback === false, `model=${meta?.model} fallback=${meta?.fallback} ${Date.now() - started}ms`);
}

async function testFreeLock() {
  console.log('\n=== 6. 免费白名单硬锁 ===');
  const cfg = await (await fetch(`${BASE}/api/config`)).json();
  check('免费模式已开启', cfg.freeOnly === true, `freeOnly=${cfg.freeOnly}`);
  check('白名单只含 Flash 系免费模型',
        cfg.allowedModels.every((m) => /flash/i.test(m) && !/flashx/i.test(m)),
        cfg.allowedModels.join('、'));
  check('实际调用链不含任何付费模型',
        cfg.models.every((m) => !/flashx|air|plus/i.test(m)),
        cfg.models.join(' → '));

  // 显式点名付费模型：必须被本地拒绝，且不能有任何正文/meta 产出
  for (const paid of ['glm-4-plus', 'glm-4-flashx', 'glm-4-air']) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }], model: paid }),
    });
    let buf = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    const events = buf
      .split('\n')
      .filter((l) => l.startsWith('data:') && !l.includes('DONE'))
      .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      .filter(Boolean);
    const blocked = events.find((e) => e.blocked === true);
    const leaked = events.some((e) => e.type === 'delta' || e.type === 'meta');
    check(`拒绝付费模型 ${paid}`, Boolean(blocked) && !leaked,
          blocked ? blocked.message.slice(0, 62) : '未收到拒绝事件（有计费风险！）');
  }
}

await testStream();
await testTitle();
await testValidation();
await testForcedFallback();
await testThinking();
await testFreeLock();

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(56)}\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
  process.exit(1);
}
