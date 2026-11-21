#!/usr/bin/env node
/**
 * private/content.json 과 private/media/* 를 암호화해서 data/ 에 씁니다.
 *
 *   node tools/encrypt.mjs
 *
 * - 비밀번호(= content.json 의 "password", 처음 만난 날)를 모르면 아무것도 볼 수 없습니다.
 * - content.json 안에서 "media/" 로 시작하는 값은 모두 파일로 보고 함께 암호화합니다.
 * - 비밀번호가 그대로면 바뀌지 않은 사진·영상은 다시 만들지 않습니다 (깃 저장소 용량 절약).
 * - private/ 폴더는 .gitignore 에 들어 있어서 깃허브에 올라가지 않습니다.
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = path.join(ROOT, 'private');
const DATA = path.join(ROOT, 'data');
const MEDIA_OUT = path.join(DATA, 'm');
const ITERATIONS = 250_000;
const WARN_MB = 40;
const MAX_MB = 95; // 깃허브는 파일 하나에 100MB 까지

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

const fail = msg => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const normalize = s => { let d = String(s ?? '').replace(/\D/g, ''); if (d.length === 6) d = '20' + d; return d; };
const sha256 = data => createHash('sha256').update(data).digest('hex');

async function deriveKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, bytes) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function unseal(key, bytes) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

async function main() {
  let content;
  try {
    content = JSON.parse(await readFile(path.join(PRIVATE, 'content.json'), 'utf8'));
  } catch (e) {
    fail(`private/content.json 을 읽지 못했어요 (${e.message})`);
  }
  const password = normalize(content.password);
  if (password.length !== 8) fail('"password" 는 날짜 8자리여야 해요. 예) "2024.03.12"');

  // 비밀번호가 같으면 이전 salt 를 그대로 써서, 바뀌지 않은 파일은 다시 암호화하지 않는다
  let salt = null;
  try {
    const gate = JSON.parse(await readFile(path.join(DATA, 'gate.json'), 'utf8'));
    if (gate.iter === ITERATIONS) {
      const oldSalt = new Uint8Array(Buffer.from(gate.salt, 'base64'));
      const oldKey = await deriveKey(password, oldSalt, ITERATIONS);
      await unseal(oldKey, new Uint8Array(await readFile(path.join(DATA, 'content.bin'))));
      salt = oldSalt;
    }
  } catch { /* 처음 만들거나, 비밀번호가 바뀐 경우 */ }
  const freshSalt = !salt;
  if (!salt) salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const saltHex = Buffer.from(salt).toString('hex');

  await mkdir(MEDIA_OUT, { recursive: true });
  const used = new Set();
  const report = [];

  async function encryptMedia(rel) {
    const ext = path.extname(rel).toLowerCase();
    const type = TYPES[ext];
    if (!type) fail(`지원하지 않는 파일 형식이에요: ${rel}`);
    let buf;
    try { buf = await readFile(path.join(PRIVATE, rel)); } catch { fail(`파일이 없어요: private/${rel}`); }
    const mb = buf.length / 1048576;
    if (mb > MAX_MB) fail(`${rel} 이(가) ${mb.toFixed(1)}MB 예요. 깃허브에 올리려면 ${MAX_MB}MB 아래로 줄여야 해요.`);
    const name = `${sha256(saltHex + sha256(buf)).slice(0, 20)}.bin`;
    used.add(name);
    const out = path.join(MEDIA_OUT, name);
    let status = '그대로';
    if (!existsSync(out)) { await writeFile(out, await seal(key, buf)); status = '새로 암호화'; }
    report.push(`  ${status.padEnd(6)}  ${rel}  (${mb.toFixed(2)}MB)${mb > WARN_MB ? '  ← 커서 휴대폰에서 느릴 수 있어요' : ''}`);
    if (ext === '.mov') report.push('          ↳ .mov 는 안드로이드에서 안 나올 수 있어요. .mp4 로 바꾸는 걸 추천해요.');
    return { src: `data/m/${name}`, type, name: rel }; // 원래 파일 이름은 암호화된 content 안에만 남는다
  }

  async function walk(v) {
    if (typeof v === 'string' && v.startsWith('media/')) return encryptMedia(v);
    if (Array.isArray(v)) { const a = []; for (const x of v) a.push(await walk(x)); return a; }
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await walk(x); return o; }
    return v;
  }

  const { password: _password, hint = '', question = '', ...rest } = content;
  const sealedContent = await walk(rest);
  // 입장권 화면에서 미리 받아 둘 파일 (배경 음악). 이름은 해시라 내용은 알 수 없다
  const warm = [sealedContent.music, sealedContent.musicQuiet].filter(Boolean).map(m => m.src);
  await writeFile(path.join(DATA, 'content.bin'), await seal(key, new TextEncoder().encode(JSON.stringify(sealedContent))));
  await writeFile(path.join(DATA, 'gate.json'), `${JSON.stringify({ v: 1, salt: Buffer.from(salt).toString('base64'), iter: ITERATIONS, question, hint, warm }, null, 2)}\n`);

  let removed = 0;
  for (const f of await readdir(MEDIA_OUT)) {
    if (f.endsWith('.bin') && !used.has(f)) { await unlink(path.join(MEDIA_OUT, f)); removed++; }
  }

  console.log(`\n✓ 암호화 완료${freshSalt ? ' (새 열쇠로 전부 다시 만들었어요)' : ''}`);
  console.log(report.join('\n'));
  if (removed) console.log(`  안 쓰는 파일 ${removed}개 정리`);
  console.log(`\n  입장 날짜: ${password.slice(0, 4)}.${password.slice(4, 6)}.${password.slice(6)}`);
  console.log('  이제 data/ 폴더와 함께 깃허브에 올리면 돼요.\n');
}

main().catch(e => fail(e.stack || String(e)));
