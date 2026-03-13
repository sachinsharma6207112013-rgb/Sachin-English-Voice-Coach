import pg from 'pg';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const { Pool } = pg;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SALT_BYTES = 16;

let pool;
let schemaReady = false;

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!hasDatabase()) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  return pool;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashPassword(password) {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString('hex');
  const hash = scryptSync(password, salt, PASSWORD_HASH_BYTES).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  if (typeof storedValue !== 'string' || !storedValue.includes(':')) {
    return false;
  }

  const [salt, storedHashHex] = storedValue.split(':');
  if (!salt || !storedHashHex) return false;

  const passwordHash = scryptSync(password, salt, PASSWORD_HASH_BYTES);
  const storedHash = Buffer.from(storedHashHex, 'hex');
  if (passwordHash.length !== storedHash.length) return false;

  return timingSafeEqual(passwordHash, storedHash);
}

async function ensureSchema() {
  if (!hasDatabase() || schemaReady) return;

  const sql = `
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_id
      ON chat_messages (session_id, id);

    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_app_users_email
      ON app_users (email);
  `;

  await getPool().query(sql);
  schemaReady = true;
}

export function isDatabaseEnabled() {
  return hasDatabase();
}

export async function loadMessages(sessionId, limit = 100) {
  if (!hasDatabase() || !sessionId) return [];

  await ensureSchema();

  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { rows } = await getPool().query(
    `SELECT role, content, created_at
       FROM chat_messages
      WHERE session_id = $1
      ORDER BY id ASC
      LIMIT $2`,
    [sessionId, safeLimit]
  );

  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  }));
}

export async function saveMessage(sessionId, role, content) {
  if (!hasDatabase() || !sessionId || !role || !content) return false;

  await ensureSchema();

  await getPool().query(
    `INSERT INTO chat_messages (session_id, role, content)
     VALUES ($1, $2, $3)`,
    [sessionId, role, content]
  );

  return true;
}

export async function createUser(name, email, password) {
  if (!hasDatabase()) return null;

  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanName || !cleanEmail || cleanPassword.length < 6) {
    return null;
  }

  await ensureSchema();

  try {
    const passwordHash = hashPassword(cleanPassword);

    const { rows } = await getPool().query(
      `INSERT INTO app_users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [cleanName, cleanEmail, passwordHash]
    );

    const user = rows[0];
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.created_at
    };
  } catch (err) {
    if (err?.code === '23505') {
      const duplicate = new Error('Email already exists');
      duplicate.code = 'USER_EXISTS';
      throw duplicate;
    }

    throw err;
  }
}

export async function authenticateUser(email, password) {
  if (!hasDatabase()) return null;

  const cleanEmail = normalizeEmail(email);
  const cleanPassword = typeof password === 'string' ? password : '';
  if (!cleanEmail || !cleanPassword) return null;

  await ensureSchema();

  const { rows } = await getPool().query(
    `SELECT id, name, email, password_hash, created_at
       FROM app_users
      WHERE email = $1
      LIMIT 1`,
    [cleanEmail]
  );

  if (!rows.length) return null;

  const user = rows[0];
  if (!verifyPassword(cleanPassword, user.password_hash)) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at
  };
}
