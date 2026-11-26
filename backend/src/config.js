function requireSecret(name, minLength = 32) {
  const val = process.env[name];
  if (!val || val.trim().length < minLength) {
    throw new Error(`Security configuration error: ${name} must be set and at least ${minLength} characters.`);
  }
  if (val.includes('CHANGE_ME')) {
    throw new Error(`Security configuration error: ${name} still uses a placeholder value.`);
  }
  return val.trim();
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: Number(process.env.PORT || 8000),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION === 'true',
  databaseUrl: requireSecret('DATABASE_URL', 12),
  redisUrl: process.env.REDIS_URL || '',
  jwtSecret: requireSecret('JWT_SECRET', 32),
  passwordPepper: requireSecret('PASSWORD_PEPPER', 32),
  qrSigningKey: requireSecret('QR_SIGNING_KEY', 32),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 7,
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  adminSeed: {
    name: process.env.ADMIN_NAME || 'Admin',
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || ''
  }
};
