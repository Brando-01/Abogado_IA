import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
export const PRIVATE_DIR = path.join(PROJECT_ROOT, 'private');
export const DATA_DIR = path.resolve(PROJECT_ROOT, '../Data de Leyes');

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith('#')) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}

export function getGroqConfig(envFile = path.join(PROJECT_ROOT, '.env'), runtimeEnv = process.env) {
  const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  return {
    groqApiKey: runtimeEnv.GROQ_API_KEY || local.GROQ_API_KEY || '',
    groqModel: runtimeEnv.GROQ_MODEL || local.GROQ_MODEL || 'openai/gpt-oss-120b'
  };
}

export function getConfig() {
  const envFile = path.join(PROJECT_ROOT, '.env');
  const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  const secretPath = path.join(PRIVATE_DIR, 'server.key');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  return {
    host: process.env.HOST || local.HOST || '127.0.0.1',
    port: Number(process.env.PORT || local.PORT || 4173),
    ...getGroqConfig(envFile),
    secret: fs.readFileSync(secretPath),
    privateDir: PRIVATE_DIR,
    dataDir: DATA_DIR,
    dbPath: path.join(PRIVATE_DIR, 'abogadoia.sqlite')
  };
}

export function getVoiceConfig(envFile = path.join(PROJECT_ROOT, '.env'), runtimeEnv = process.env) {
  const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const value = (...names) => names.map(name => runtimeEnv[name] || local[name]).find(Boolean) || '';
  return {
    fishApiKey: value('FISH_AUDIO_API_KEY', 'FISH_API_KEY'),
    fishVoiceId: value('FISH_AUDIO_VOICE_ID', 'FISH_VOICE_ID', 'FISH_AUDIO_REFERENCE_ID', 'FISH_REFERENCE_ID'),
    fishModel: value('FISH_AUDIO_MODEL', 'FISH_MODEL') || 's2.1-pro-free'
  };
}
