#!/usr/bin/env node
/**
 * 깃허브에 올라간 data/ 의 암호 파일에서 원본(private/content.json, private/media/*)을 되살립니다.
 * 원본을 잃어버렸을 때 쓰세요.
 *
 *   node tools/decrypt.mjs 2024.03.12
 *
 * private/content.json 이 이미 있으면 덮어쓰지 않고 멈춥니다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = path.join(ROOT, 'private');
const fail = msg => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const normalize = s => { let d = String(s ?? '').replace(/\D/g, ''); if (d.length === 6) d = '20' + d; return d; };
const EXT = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav' };

async function main() {
  const pw = normalize(process.argv[2]);
  if (pw.length !== 8) fail('입장 날짜를 같이 적어 주세요. 예) node tools/decrypt.mjs 2024.03.12');
  if (existsSync(path.join(PRIVATE, 'content.json'))) fail('private/content.json 이 이미 있어요. 덮어쓰지 않으려고 멈췄어요.');

  const gate = JSON.parse(await readFile(path.join(ROOT, 'data', 'gate.json'), 'utf8'));
  const base = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(gate.salt, 'base64'), iterations: gate.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const open = async file => {
    const u = new Uint8Array(await readFile(path.join(ROOT, file)));
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
  };

  let content;
  try { content = JSON.parse(new TextDecoder().decode(await open('data/content.bin'))); }
  catch { fail('날짜가 틀렸거나 파일이 손상됐어요.'); }

  let n = 0;
  async function walk(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.src === 'string' && v.src.startsWith('data/m/')) {
      const rel = v.name || `media/recovered-${++n}${EXT[v.type] || '.bin'}`;
      await mkdir(path.dirname(path.join(PRIVATE, rel)), { recursive: true });
      await writeFile(path.join(PRIVATE, rel), await open(v.src));
      console.log(`  복구  private/${rel}`);
      return rel;
    }
    if (Array.isArray(v)) { const a = []; for (const x of v) a.push(await walk(x)); return a; }
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x); return o; }
    return v;
  }
  const restored = await walk(content);
  const out = { password: `${pw.slice(0, 4)}.${pw.slice(4, 6)}.${pw.slice(6)}`, hint: gate.hint || '', ...restored };
  await mkdir(PRIVATE, { recursive: true });
  await writeFile(path.join(PRIVATE, 'content.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n✓ private/content.json 복구 완료\n');
}

main().catch(e => fail(e.stack || String(e)));
