import { describe, it, expect } from 'vitest';
import { parseEncryptionKey, loadConfig } from '../src/config/env.js';
import { encryptAES256GCM, decryptAES256GCM } from '../src/crypto/aes.js';
import { createTenantRepository } from '../src/db/tenant.js';

describe('Config and Crypto Non-Negotiables', () => {
  describe('Configuration 32-byte Key Enforcement', () => {
    it('refuses to start when ENCRYPTION_KEY is missing', () => {
      expect(() => {
        parseEncryptionKey(undefined);
      }).toThrow(/ENCRYPTION_KEY is required/i);
    });

    it('refuses to start when ENCRYPTION_KEY is shorter than 32 bytes', () => {
      expect(() => {
        parseEncryptionKey('too_short_key_123');
      }).toThrow(/must be exactly 32 bytes/i);
    });

    it('refuses to start when ENCRYPTION_KEY is longer than 32 bytes and not valid 64-char hex', () => {
      expect(() => {
        parseEncryptionKey('a'.repeat(40));
      }).toThrow(/must be exactly 32 bytes/i);
    });

    it('accepts a valid 64-character hex string (32 bytes)', () => {
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const buf = parseEncryptionKey(hexKey);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(32);
    });

    it('accepts a valid 32-character UTF-8 string (32 bytes)', () => {
      const rawKey = '12345678901234567890123456789012'; // 32 chars
      const buf = parseEncryptionKey(rawKey);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(32);
    });
  });

  describe('AES-256-GCM Encryption of Tokens', () => {
    const validKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

    it('encrypts and successfully decrypts access tokens', () => {
      const secretToken = 'shpat_secret_access_token_987654321';
      const encrypted = encryptAES256GCM(secretToken, validKey);

      expect(encrypted.serialized).toContain(':');
      const parts = encrypted.serialized.split(':');
      expect(parts.length).toBe(3); // iv, tag, ciphertext

      const decrypted = decryptAES256GCM(encrypted.serialized, validKey);
      expect(decrypted).toBe(secretToken);
    });

    it('throws when ciphertext or auth tag is tampered with', () => {
      const secretToken = 'shpat_secret_access_token_987654321';
      const encrypted = encryptAES256GCM(secretToken, validKey);

      // Tamper with ciphertext by altering last byte
      const parts = encrypted.serialized.split(':');
      const tamperedCiphertext = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
      const tamperedSerialized = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      expect(() => {
        decryptAES256GCM(tamperedSerialized, validKey);
      }).toThrow();
    });

    it('throws when key length is invalid', () => {
      const invalidKey = Buffer.from('short_key');
      expect(() => {
        encryptAES256GCM('token', invalidKey);
      }).toThrow(/requires a 32-byte key/i);
    });
  });

  describe('Tenant ID Enforcement on Database Queries', () => {
    it('refuses to create tenant repository with empty or blank tenant_id', () => {
      expect(() => {
        createTenantRepository({} as any, '');
      }).toThrow(/Tenant enforcement violation/i);

      expect(() => {
        createTenantRepository({} as any, '   ');
      }).toThrow(/Tenant enforcement violation/i);

      expect(() => {
        createTenantRepository({} as any, null as any);
      }).toThrow(/Tenant enforcement violation/i);
    });
  });
});
