import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
};

export const GENESIS_HASH = '0'.repeat(64);

let dummyHashPromise = null;

function pepperPassword(plainPassword) {
  return crypto
    .createHmac('sha256', config.passwordPepper)
    .update(plainPassword, 'utf8')
    .digest('hex');
}

export async function hashPassword(plainPassword) {
  return argon2.hash(pepperPassword(plainPassword), ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash, plainPassword) {
  try {
    return await argon2.verify(storedHash, pepperPassword(plainPassword));
  } catch {
    return false;
  }
}

export function needsPasswordRehash(storedHash) {
  try {
    return argon2.needsRehash(storedHash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

export async function verifyDummyPassword(plainPassword) {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('dummy-timing-equalization-secret-2026!');
  }
  const dummyHash = await dummyHashPromise;
  await verifyPassword(dummyHash, plainPassword);
}

export function generateRandomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function computeAuditHash({
  prevHash,
  itemId,
  userId,
  actionType,
  quantityChange,
  previousQuantity,
  newQuantity,
  notes,
  timestampIso
}) {
  const payload = [
    prevHash,
    String(itemId),
    userId == null ? 'system' : String(userId),
    actionType,
    String(quantityChange),
    String(previousQuantity),
    String(newQuantity),
    notes || '',
    timestampIso
  ].join('|');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function signQrPayload(itemId, name) {
  const canonical = `${itemId}|${name}|inventory_item`;
  const sig = crypto
    .createHmac('sha256', config.qrSigningKey)
    .update(canonical, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return JSON.stringify({ id: itemId, name, type: 'inventory_item', sig });
}

export function verifyQrPayload(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, reason: 'Invalid JSON payload' };
  }
  if (!parsed || typeof parsed.id !== 'number' || typeof parsed.name !== 'string' || typeof parsed.sig !== 'string') {
    return { valid: false, reason: 'Missing required QR fields' };
  }
  const canonical = `${parsed.id}|${parsed.name}|inventory_item`;
  const expectedSig = crypto
    .createHmac('sha256', config.qrSigningKey)
    .update(canonical, 'utf8')
    .digest('hex')
    .slice(0, 32);
  if (!safeEqualHex(parsed.sig, expectedSig)) {
    return { valid: false, reason: 'QR HMAC signature mismatch' };
  }
  return { valid: true, id: parsed.id, name: parsed.name };
}

export function issueAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role, name: user.name },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.accessTokenTtlSeconds }
  );
}

export function setAuthCookies(res, accessToken, refreshToken) {
  const baseOpts = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/'
  };
  res.cookie('access_token', accessToken, {
    ...baseOpts,
    maxAge: config.accessTokenTtlSeconds * 1000
  });
  res.cookie('refresh_token', refreshToken, {
    ...baseOpts,
    path: '/api/auth',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
  });
}

export function ensureCsrfCookie(req, res) {
  let token = req.cookies?.csrf_token;
  if (!token || token.length < 32) {
    token = generateRandomToken(32);
    res.cookie('csrf_token', token, {
      httpOnly: false,
      secure: config.cookieSecure,
      sameSite: 'strict',
      path: '/',
      maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    });
  }
  return token;
}

export function clearAuthCookies(res) {
  const opts = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' };
  res.clearCookie('access_token', opts);
  res.clearCookie('refresh_token', { ...opts, path: '/api/auth' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.user = {
      id: Number(decoded.sub),
      email: decoded.email,
      role: decoded.role,
      name: decoded.name
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

export function requireCsrf(req, res, next) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (safeMethods.has(req.method)) return next();

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqualHex(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
}
