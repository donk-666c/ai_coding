/**
 * 模型可用性探针：逐个探测候选模型，确认哪些能调通。
 * 用法：node tests/check_models.mjs [模型名...]
 * 不传参数时探测 config 里的降级链 + 常见候选。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = join(HERE, '..', '.env');

const env = Object.fromEntries(
  (await readFile(ENV, 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const base = (env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
const url = `${base}/chat/completions`;

const fromArgs = process.argv.slice(2);
const chain = [env.GLM_MODEL, ...(env.GLM_FALLBACK_MODELS || '').split(',')].map((s) => s && s.trim()).filter(Boolean);
const candidates = fromArgs.length
  ? fromArgs
  : [...new Set([...chain, 'glm-4-flash', 'glm-4.5-flash', 'glm-4-flashx', 'glm-4-air', 'glm-4-plus'])];

console.log(`接口：${url}`);
console.log(`当前配置的降级链：${chain.join(' → ')}\n`);

for (const model of candidates) {
  const started = Date.now();
  let verdict;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ZHIPU_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复：ok' }], max_tokens: 16 }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let note = text.slice(0, 120);
    try {
      const j = JSON.parse(text);
      note = j.choices?.[0]?.message?.content ?? j.error?.message ?? note;
    } catch {}
    const mark = res.status === 200 ? '✅ 可用' : res.status === 429 ? '⏳ 限流(模型存在)' : '❌ 不可用';
    verdict = `${mark.padEnd(16)} [${res.status}] ${String(note).replaceAll('\n', ' ').slice(0, 70)}`;
  } catch (err) {
    verdict = `❌ 请求失败      ${err.name}: ${err.message}`;
  }
  console.log(`${model.padEnd(20)} ${String(Date.now() - started).padStart(6)}ms  ${verdict}`);
}
