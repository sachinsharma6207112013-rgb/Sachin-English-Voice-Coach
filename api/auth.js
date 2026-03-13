import { authenticateUser, createUser, isDatabaseEnabled } from './_db.js';
import { applyCors } from './_cors.js';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SALT_BYTES = 16;
const LOCAL_AUTH_FILE = '.auth-local-users.json';

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAction(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getLocalAuthPath() {
  return path.join(process.cwd(), LOCAL_AUTH_FILE);
}

function readLocalUsers() {
  try {
    const filePath = getLocalAuthPath();
    if (!existsSync(filePath)) {
      return {};
    }

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeLocalUsers(users) {
  const filePath = getLocalAuthPath();
  writeFileSync(filePath, JSON.stringify(users), 'utf8');
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

function mapUser(record) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    createdAt: record.createdAt
  };
}

async function createUserInMemory(name, email, password) {
  const users = readLocalUsers();
  if (users[email]) {
    const duplicate = new Error('Email already exists');
    duplicate.code = 'USER_EXISTS';
    throw duplicate;
  }

  const record = {
    id: `local_${Date.now()}_${randomBytes(3).toString('hex')}`,
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  users[email] = record;
  writeLocalUsers(users);
  return mapUser(record);
}

async function authenticateUserInMemory(email, password) {
  const users = readLocalUsers();
  const record = users[email];
  if (!record) return null;

  if (!verifyPassword(password, record.passwordHash)) {
    return null;
  }

  return mapUser(record);
}

export default async function handler(req, res) {
  applyCors(req, res, { methods: ['POST', 'OPTIONS'] });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const databaseEnabled = isDatabaseEnabled();

    const body = req.body || {};
    const action = normalizeAction(body.action);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (action === 'logout') {
      return res.status(200).json({
        ok: true,
        action: 'logout'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (action === 'signup') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }

      try {
        const user = databaseEnabled
          ? await createUser(name, email, password)
          : await createUserInMemory(name, email, password);
        if (!user) {
          return res.status(400).json({ error: 'Invalid signup data' });
        }

        return res.status(200).json({
          ok: true,
          action: 'signup',
          database: databaseEnabled,
          user
        });
      } catch (err) {
        if (err?.code === 'USER_EXISTS') {
          return res.status(409).json({ error: 'Email already registered' });
        }

        throw err;
      }
    }

    if (action === 'login') {
      const user = databaseEnabled
        ? await authenticateUser(email, password)
        : await authenticateUserInMemory(email, password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      return res.status(200).json({
        ok: true,
        action: 'login',
        database: databaseEnabled,
        user
      });
    }

    return res.status(400).json({ error: 'action must be signup, login, or logout' });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message || 'Auth failed' });
  }
}
