import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

export interface EncryptedPayload {
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
  serialized: string; // "iv:tag:ciphertext"
}

export function encryptAES256GCM(plainText: string, key: Buffer): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM requires a 32-byte key. Received ${key.length} bytes.`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  const ivHex = iv.toString('hex');
  const tagHex = tag.toString('hex');
  const ciphertextHex = ciphertext.toString('hex');

  return {
    iv: ivHex,
    tag: tagHex,
    ciphertext: ciphertextHex,
    serialized: `${ivHex}:${tagHex}:${ciphertextHex}`,
  };
}

export function decryptAES256GCM(serializedOrPayload: string | { iv: string; tag: string; ciphertext: string }, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM requires a 32-byte key. Received ${key.length} bytes.`);
  }

  let ivHex: string;
  let tagHex: string;
  let ciphertextHex: string;

  if (typeof serializedOrPayload === 'string') {
    const parts = serializedOrPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format. Expected "iv:tag:ciphertext".');
    }
    [ivHex, tagHex, ciphertextHex] = parts;
  } else {
    ivHex = serializedOrPayload.iv;
    tagHex = serializedOrPayload.tag;
    ciphertextHex = serializedOrPayload.ciphertext;
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
