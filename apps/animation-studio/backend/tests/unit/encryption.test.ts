import { encrypt, decrypt } from '../../src/services/encryptionService';

describe('Encryption Service', () => {
  const testValues = [
    'sk-runway-test-12345',
    'pk_test_stripe_key_abcdef',
    'a-very-long-api-key-with-special-chars-$%^&*()!@#',
    '中文Unicode字符测试',
    '   spaces   at   ends   ',
    'x', // single char
  ];

  test('encrypts and decrypts round-trip correctly', () => {
    for (const value of testValues) {
      const encrypted = encrypt(value);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(value);
    }
  });

  test('encrypted output is different from input', () => {
    const plaintext = 'my-secret-api-key';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(typeof encrypted).toBe('string');
  });

  test('each encryption uses a different IV (ciphertext differs)', () => {
    const plaintext = 'same-input';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    // Same plaintext should produce different ciphertext (random IV)
    expect(c1).not.toBe(c2);
    // But both must decrypt to same value
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  test('tampered ciphertext throws on decrypt', () => {
    const encrypted = encrypt('my-api-key');
    const tampered = encrypted.slice(0, -4) + 'xxxx';
    expect(() => decrypt(tampered)).toThrow();
  });

  test('empty string encrypts and decrypts', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });
});
