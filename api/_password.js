const { randomBytes, scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);
const PREFIX = 'scrypt';
const KEY_LENGTH = 64;

function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}$`);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(String(password), salt, KEY_LENGTH);
  return `${PREFIX}$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, storedValue) {
  if (!isPasswordHash(storedValue)) {
    return { valid: String(password) === String(storedValue), needsUpgrade: true };
  }

  const [, salt, expectedHex] = storedValue.split('$');
  if (!salt || !expectedHex) return { valid: false, needsUpgrade: false };

  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await scryptAsync(String(password), salt, expected.length);
    return {
      valid: expected.length > 0 && timingSafeEqual(expected, actual),
      needsUpgrade: false,
    };
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}

module.exports = { hashPassword, verifyPassword, isPasswordHash };
