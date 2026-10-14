import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export class Store {
  constructor({ dbPath, privateDir, secret }) {
    this.privateDir = privateDir;
    this.secret = crypto.createHash('sha256').update(secret).digest();
    fs.mkdirSync(privateDir, { recursive: true });
    fs.mkdirSync(path.join(privateDir, 'uploads'), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,encrypted_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,user_id TEXT NOT NULL,original_name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,storage_name TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS legal_sources(id TEXT PRIMARY KEY,file_name TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,pages INTEGER NOT NULL,extracted_chars INTEGER NOT NULL,indexed_at TEXT NOT NULL,warning TEXT);
      CREATE TABLE IF NOT EXISTS legal_chunks(rowid INTEGER PRIMARY KEY,source_id TEXT NOT NULL,page INTEGER NOT NULL,content TEXT NOT NULL,FOREIGN KEY(source_id) REFERENCES legal_sources(id) ON DELETE CASCADE);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content,tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS qa_turns(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,encrypted_json TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,encrypted_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS conversation_turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,encrypted_json TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS chat_migrations(user_id TEXT PRIMARY KEY,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    `);
  }

  close() { this.db.close(); }
  userCount() { return this.db.prepare('SELECT COUNT(*) n FROM users').get().n; }
  userByEmail(email) { return this.db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()); }
  userById(userId) { return this.db.prepare('SELECT id,email FROM users WHERE id=?').get(userId); }
  createUser(email, password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const userId = id();
    this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(userId, email.toLowerCase(), passwordHash, salt, now());
    return this.userById(userId);
  }
  verifyPassword(user, password) {
    if (!user) return false;
    const actual = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.password_hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), userId, expires);
    return token;
  }
  userForToken(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    return this.db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(hash(token), now()) || null;
  }
  revokeSession(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }

  addQaTurn(userId, turn) {
    const entry = { id: id(), createdAt: now(), ...turn };
    this.db.prepare('INSERT INTO qa_turns VALUES(?,?,?,?)').run(entry.id, userId, this.encrypt(entry), entry.createdAt);
    return entry;
  }
  qaTurns(userId, limit = 30) {
    return this.db.prepare('SELECT encrypted_json FROM qa_turns WHERE user_id=? ORDER BY rowid DESC LIMIT ?')
      .all(userId, Math.min(Math.max(Number(limit) || 30, 1), 100)).reverse().map(row => this.decrypt(row.encrypted_json));
  }
  clearQaTurns(userId) { return this.db.prepare('DELETE FROM qa_turns WHERE user_id=?').run(userId).changes; }

  createConversation(userId, state = {}) {
    const conversationId = id(), timestamp = now();
    this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?)').run(conversationId, userId, this.encrypt({ title: 'Nueva conversación', caseId: null, paused: false, pending: null, editing: null, ...state }), timestamp, timestamp);
    return this.getConversation(userId, conversationId);
  }
  getConversation(userId, conversationId) {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(conversationId, userId);
    return row ? { id: row.id, state: this.decrypt(row.encrypted_json), createdAt: row.created_at, updatedAt: row.updated_at,
      turns: this.db.prepare('SELECT encrypted_json FROM conversation_turns WHERE conversation_id=? ORDER BY rowid').all(conversationId).map(turn => this.decrypt(turn.encrypted_json)) } : null;
  }
  listConversations(userId) {
    return this.db.prepare('SELECT id,encrypted_json,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC').all(userId)
      .map(row => ({ id: row.id, title: this.decrypt(row.encrypted_json).title, caseId: this.decrypt(row.encrypted_json).caseId, updatedAt: row.updated_at }));
  }
  updateConversation(userId, conversationId, state) {
    this.db.prepare('UPDATE conversations SET encrypted_json=?,updated_at=? WHERE id=? AND user_id=?').run(this.encrypt(state), now(), conversationId, userId);
  }
  addConversationTurn(userId, conversationId, turn) {
    if (!this.getConversation(userId, conversationId)) return null;
    const entry = { id: id(), createdAt: now(), ...turn };
    this.db.prepare('INSERT INTO conversation_turns VALUES(?,?,?,?)').run(entry.id, conversationId, this.encrypt(entry), entry.createdAt);
    return entry;
  }
  deleteConversation(userId, conversationId) {
    const conversation = this.getConversation(userId, conversationId);
    if (!conversation) return false;
    this.db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(conversationId, userId);
    if (conversation.state.caseId) this.deleteCase(userId, conversation.state.caseId);
    return true;
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.secret, iv);
    const content = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
  }
  decrypt(value) {
    const bytes = Buffer.from(value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.secret, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
  encryptBytes(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.secret, iv);
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  }
  decryptBytes(value) {
    const iv = value.subarray(0, 12), tag = value.subarray(value.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.secret, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]);
  }
  createCase(userId, data = {}) {
    const caseId = id(), timestamp = now();
    this.db.prepare('INSERT INTO cases VALUES(?,?,?,?,?)').run(caseId, userId, this.encrypt(data), timestamp, timestamp);
    return this.getCase(userId, caseId);
  }
  getCase(userId, caseId) {
    const row = this.db.prepare('SELECT id,encrypted_json,created_at,updated_at FROM cases WHERE id=? AND user_id=?').get(caseId, userId);
    return row ? { id: row.id, data: this.decrypt(row.encrypted_json), createdAt: row.created_at, updatedAt: row.updated_at, documents: this.documentsForCase(userId, caseId) } : null;
  }
  listCases(userId) {
    return this.db.prepare('SELECT id,created_at,updated_at FROM cases WHERE user_id=? ORDER BY updated_at DESC').all(userId);
  }
  updateCase(userId, caseId, data) {
    const result = this.db.prepare('UPDATE cases SET encrypted_json=?,updated_at=? WHERE id=? AND user_id=?').run(this.encrypt(data), now(), caseId, userId);
    return result.changes ? this.getCase(userId, caseId) : null;
  }
  deleteCase(userId, caseId) {
    const docs = this.documentsForCase(userId, caseId);
    const result = this.db.prepare('DELETE FROM cases WHERE id=? AND user_id=?').run(caseId, userId);
    if (result.changes) for (const doc of docs) fs.rmSync(path.join(this.privateDir, 'uploads', doc.storage_name), { force: true });
    return result.changes > 0;
  }
  addDocument(userId, caseId, { name, mime, bytes }) {
    if (!this.getCase(userId, caseId)) return null;
    const documentId = id(), storageName = `${documentId}.bin`;
    fs.writeFileSync(path.join(this.privateDir, 'uploads', storageName), this.encryptBytes(bytes), { mode: 0o600 });
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(documentId, caseId, userId, name, mime, bytes.length, hash(bytes), storageName, now());
    return this.document(userId, caseId, documentId);
  }
  documentsForCase(userId, caseId) {
    return this.db.prepare('SELECT id,original_name,mime,size,sha256,storage_name,created_at FROM documents WHERE user_id=? AND case_id=? ORDER BY created_at').all(userId, caseId);
  }
  document(userId, caseId, documentId) {
    return this.db.prepare('SELECT id,original_name,mime,size,sha256,storage_name,created_at FROM documents WHERE id=? AND user_id=? AND case_id=?').get(documentId, userId, caseId) || null;
  }
  documentBytes(doc) {
    const encrypted = fs.readFileSync(path.join(this.privateDir, 'uploads', doc.storage_name));
    return this.decryptBytes(encrypted);
  }
  deleteDocument(userId, caseId, documentId) {
    const doc = this.document(userId, caseId, documentId);
    if (!doc) return false;
    this.db.prepare('DELETE FROM documents WHERE id=? AND user_id=? AND case_id=?').run(documentId, userId, caseId);
    fs.rmSync(path.join(this.privateDir, 'uploads', doc.storage_name), { force: true });
    return true;
  }

  sourceByName(fileName) { return this.db.prepare('SELECT * FROM legal_sources WHERE file_name=?').get(fileName); }
  sourceById(sourceId) { return this.db.prepare('SELECT * FROM legal_sources WHERE id=?').get(sourceId); }
  sources() { return this.db.prepare('SELECT * FROM legal_sources ORDER BY title').all(); }
  indexStats() {
    const row = this.db.prepare('SELECT COUNT(*) source_count, SUM(CASE WHEN extracted_chars > 0 THEN 1 ELSE 0 END) searchable_count FROM legal_sources').get();
    return { sourceCount: row.source_count, searchableCount: row.searchable_count || 0, chunkCount: this.db.prepare('SELECT COUNT(*) n FROM legal_chunks').get().n };
  }
  replaceSource({ fileName, sha256, title, category, pages, chunks, warning }) {
    const previous = this.sourceByName(fileName);
    const sourceId = previous?.id || id();
    this.db.exec('BEGIN');
    try {
      if (previous) {
        const oldChunks = this.db.prepare('SELECT rowid FROM legal_chunks WHERE source_id=?').all(sourceId);
        const removeFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid=?');
        for (const row of oldChunks) removeFts.run(row.rowid);
        this.db.prepare('DELETE FROM legal_chunks WHERE source_id=?').run(sourceId);
      }
      this.db.prepare('INSERT INTO legal_sources VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_name) DO UPDATE SET sha256=excluded.sha256,title=excluded.title,category=excluded.category,pages=excluded.pages,extracted_chars=excluded.extracted_chars,indexed_at=excluded.indexed_at,warning=excluded.warning').run(sourceId, fileName, sha256, title, category, pages, chunks.reduce((n, x) => n + x.content.length, 0), now(), warning || null);
      const insertChunk = this.db.prepare('INSERT INTO legal_chunks(source_id,page,content) VALUES(?,?,?)');
      const insertFts = this.db.prepare('INSERT INTO chunks_fts(rowid,content) VALUES(?,?)');
      for (const chunk of chunks) {
        const row = insertChunk.run(sourceId, chunk.page, chunk.content);
        insertFts.run(row.lastInsertRowid, chunk.content);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  search(query, limit = 8, categories = null) {
    const stopwords = new Set(['como', 'cual', 'cuales', 'cuando', 'donde', 'para', 'puedo', 'puede', 'debo', 'debe', 'sobre', 'esta', 'este', 'esto', 'esos', 'esas', 'tengo', 'quiero', 'seria', 'seran', 'porque', 'segun', 'una', 'uno', 'unos', 'unas', 'del', 'las', 'los', 'que', 'con', 'por', 'sin']);
    const terms = [...new Set((String(query).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) || []).filter(term => !stopwords.has(term)))].slice(0, 12);
    if (!terms.length) return [];
    const expression = terms.map(x => `"${x}"`).join(' OR ');
    const filters = Array.isArray(categories) && categories.length ? ` AND s.category IN (${categories.map(() => '?').join(',')})` : '';
    return this.db.prepare(`SELECT s.id source_id,s.title,s.file_name,s.category,c.page,c.content,bm25(chunks_fts) score FROM chunks_fts JOIN legal_chunks c ON c.rowid=chunks_fts.rowid JOIN legal_sources s ON s.id=c.source_id WHERE chunks_fts MATCH ?${filters} ORDER BY score LIMIT ?`).all(expression, ...(categories || []), Math.min(Math.max(Number(limit) || 8, 1), 30));
  }
}
