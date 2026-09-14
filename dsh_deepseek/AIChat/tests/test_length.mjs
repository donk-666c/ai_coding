/**
 * 验证「回复长度有长有短」：同一个性格、三类不同性质的问题，
 * 回复长度应当明显不同（真人不会每条都一样长）。
 */
const BASE = 'http://127.0.0.1:8000';
const PERSONA = { id: 'gentle', name: '小柔' };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function ask(text) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
      persona: PERSONA,
      maxTokens: 1024,
    }),
  });
  let buf = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  const events = buf.split('\n').filter((l) => l.startsWith('data:') && !l.includes('[DONE]'))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
  return {
    text: events.filter((e) => e.type === 'delta').map((e) => e.content).join('').trim(),
    error: events.find((e) => e.type === 'error'),
    model: events.find((e) => e.type === 'meta')?.model,
  };
}

const CASES = [
  { label: '随口闲聊（期望短）', text: '在干嘛' },
  {
    label: '倾诉难过（期望长）',
    text: '我今天特别难受。开会的时候被领导当众骂了，说我做的方案一文不值，同事都在旁边看着。回来路上我一直在想，是不是真的不适合干这行。',
  },
  { label: '让她讲自己的事（期望较长）', text: '跟我讲讲你今天都遇到什么了' },
];

console.log(`性格：${PERSONA.name}（温柔）  模型链默认\n`);
const lens = [];

for (const c of CASES) {
  const r = await ask(c.text);
  const len = (r.text || '').replace(/\s/g, '').length;
  lens.push(len);
  console.log(`【${c.label}】${len} 字  (模型 ${r.model || '?'})`);
  console.log(`   ${(r.text || r.error?.message || '').replace(/\n+/g, ' ').slice(0, 190)}`);
  console.log('');
}

const valid = lens.every((n) => n > 0);
check('三类问题都得到了回复', valid, lens.join(' / ') + ' 字');

if (valid) {
  const spread = Math.max(...lens) - Math.min(...lens);
  const ratio = (Math.max(...lens) / Math.max(1, Math.min(...lens))).toFixed(2);
  check('回复长度有明显长短差异（不再死板）', spread >= 30,
    `最短 ${Math.min(...lens)} / 最长 ${Math.max(...lens)} 字，相差 ${spread} 字，比值 ${ratio}`);
  check('闲聊回复足够短（< 60 字）', lens[0] < 60, `${lens[0]} 字`);
  check('倾诉回复明显更长（比闲聊多 30 字以上）', lens[1] - lens[0] >= 30,
    `倾诉 ${lens[1]} vs 闲聊 ${lens[0]}`);
}

const failed = results.filter((r) => !r.ok);
console.log('='.repeat(60));
console.log(`通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) failed.forEach((f) => console.log(`  ❌ ${f.name} ${f.detail}`));
process.exit(failed.length ? 1 : 0);
