/**
 * 女友人格后端验证：人格清单、人设是否真的生效、名字注入、AI 自称检测、兼容性。
 * 用法: node tests/test_persona.mjs
 */
const BASE = 'http://127.0.0.1:8000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function collectStream(res) {
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
    .filter((l) => l.startsWith('data:') && !l.includes('[DONE]'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);
  return {
    text: events.filter((e) => e.type === 'delta').map((e) => e.content).join(''),
    error: events.find((e) => e.type === 'error'),
    meta: events.find((e) => e.type === 'meta'),
  };
}

async function ask(payload) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { text: '', error: { message: `HTTP ${res.status}` }, status: res.status };
  return collectStream(res);
}

// ---------- 1. 人格清单 ----------
console.log('=== 1. /api/personas ===');
const listRes = await fetch(`${BASE}/api/personas`);
const list = await listRes.json();
check('接口返回 200', listRes.status === 200, `status=${listRes.status}`);
check('返回 6 种性格', list.personas?.length === 6, (list.personas || []).map((p) => p.name).join('、'));
check('字段完整', (list.personas || []).every((p) => p.id && p.name && p.emoji && p.tagline && p.color && p.accent && p.defaultName && p.greeting && Array.isArray(p.names)));
check('没有泄露 system prompt', (list.personas || []).every((p) => p.prompt === undefined));

// ---------- 2. 人设是否真的生效 ----------
console.log('\n=== 2. 每种性格问同一句话，看回复风格 ===');
const QUESTION = '你叫什么名字？用一句话介绍下你自己。';
const replies = {};
const SELF_CLAIM = /(AI|人工智能|语言模型|大模型|智能助手|助手|程序|机器人|模型)/i;

for (const persona of list.personas) {
  const name = persona.defaultName;
  const out = await ask({
    messages: [{ role: 'user', content: QUESTION }],
    persona: { id: persona.id, name },
    maxTokens: 200,
  });
  const text = (out.text || '').trim().replace(/\n+/g, ' ');
  replies[persona.id] = { text, name, label: persona.name };
  if (out.error) {
    check(`${persona.name}：能正常回复`, false, out.error.message.slice(0, 70));
    continue;
  }
  console.log(`\n  【${persona.name}】名字=${name}  模型=${out.meta?.model}`);
  console.log(`    ${text.slice(0, 150)}`);
}

const okReplies = Object.values(replies).filter((r) => r.text.length > 0);
check('六种性格都产出了回复', okReplies.length === 6, `${okReplies.length}/6`);

// 名字注入：回复里应出现自己设定的名字
const nameHit = Object.values(replies).filter((r) => r.text.includes(r.name)).length;
check('名字被注入人设（回复里出现设定的名字）', nameHit >= 4, `${nameHit}/6 提到自己的名字`);

// 核心断言：不能自称 AI
const aiClaims = Object.entries(replies).filter(([, r]) => SELF_CLAIM.test(r.text));
check('没有自称 AI / 助手 / 模型', aiClaims.length === 0,
      aiClaims.map(([id, r]) => `${r.label}: ${r.text.slice(0, 40)}`).join(' | ') || '六种性格都没露馅');

// 风格差异：不同性格的回复不应完全一样
const uniq = new Set(Object.values(replies).map((r) => r.text));
check('六种性格回复各不相同（人设确有区分度）', uniq.size === 6, `${uniq.size} 种不同回复`);

// 长度：人格模式默认 maxTokens 更小，回复应偏短
const avgLen = okReplies.reduce((s, r) => s + r.text.length, 0) / (okReplies.length || 1);
check('回复长度符合聊天风格（平均 < 200 字）', avgLen < 200, `平均 ${avgLen.toFixed(0)} 字`);

// ---------- 3. 兼容性：不带 persona ----------
console.log('\n=== 3. 兼容性 ===');
const plain = await ask({ messages: [{ role: 'user', content: '回复：ok' }], maxTokens: 32 });
check('不带 persona 时仍能正常对话', plain.text.trim().length > 0, plain.text.trim().slice(0, 40));

const bad = await ask({ messages: [{ role: 'user', content: '你好' }], persona: { id: '不存在的性格' }, maxTokens: 64 });
check('persona.id 非法时退回默认人格而不是报错', bad.text.trim().length > 0, bad.text.trim().slice(0, 40));

// ---------- 4. 开场白 ----------
console.log('\n=== 4. 开场白模板 ===');
check('每套人格都有开场白且含 {name} 占位',
      (list.personas || []).every((p) => p.greeting.includes('{name}')),
      (list.personas || [])[1]?.greeting);

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  failed.forEach((f) => console.log(`  ❌ ${f.name} ${f.detail}`));
  process.exit(1);
}
