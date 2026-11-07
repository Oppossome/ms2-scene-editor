import crypto from "crypto";
import { BinaryBuffer } from "./common/BinaryBuffer";
export class AESCipher {
  iv: Buffer;
  blockSize: number;
  algorithm: string;
  encryptor: Buffer;
  constructor(userKey: Buffer, iv: Buffer) {
    if (![16, 24, 32].includes(userKey.length)) {
      throw new Error(
        "User key must be 16, 24, or 32 bytes for AES-128, AES-192, or AES-256"
      );
    }
    if (iv.length !== 16) {
      throw new Error("IV must be 16 bytes");
    }

    this.iv = Buffer.from(iv);
    this.blockSize = 16; // AES block size in bytes
    this.algorithm = "aes-256-ecb"; // Adjust this based on userKey length
    this.encryptor = userKey;
  }

  transformBlock(
    src: BinaryBuffer,
    offset: number,
    size: number,
    dst: BinaryBuffer,
    initialOffset: number
  ) {
    // The per-block ECB keystream with a big-endian incrementing counter is plain AES-256-CTR,
    // so let OpenSSL do it in a single pass (the block-by-block version was ~1 MB/s).
    const length = Math.min(
      size,
      dst.length - initialOffset,
      src.length - offset
    );
    if (length > 0) {
      const cipher = crypto.createCipheriv(
        "aes-256-ctr",
        this.encryptor,
        this.iv
      );
      const out = cipher.update(
        src.getBuffer().subarray(offset, offset + length)
      );
      out.copy(dst.getBuffer(), initialOffset);
    }

    return size;
  }

  encrypt(input: Buffer) {
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptor, null);
    cipher.setAutoPadding(false);

    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    return encrypted.slice(0, this.blockSize); // Return only the block size
  }

  incrementCounter() {
    for (let i = this.iv.length - 1; i >= 0; i--) {
      ++this.iv[i];
      if (this.iv[i] !== 0) {
        break;
      }
    }
  }
}
