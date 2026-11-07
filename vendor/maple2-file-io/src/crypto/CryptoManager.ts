import zlib from "zlib";
import fs from "fs";

import { Encryption } from "./common/Encryption";
import { PackVersion } from "./common/PackVersion";
import { CipherKeys } from "./keys/CipherKey";
import { IPackStream } from "./stream/IPackStream";
import { IPackFileHeader } from "./stream/IPackFileHeader";
import { BinaryBuffer } from "./common/BinaryBuffer";
import { AESCipher } from "./AESCipher";

export class CryptoManager {
  static decryptFileString(stream: IPackStream, buffer: BinaryBuffer) {
    if (!stream.compressedHeaderSize || !stream.encodedHeaderSize) {
      throw new Error(
        "ERROR decrypting file list: the size of the list is invalid."
      );
    }

    const src = BinaryBuffer.fromBuffer(
      buffer.readBytes(Number(stream.encodedHeaderSize))
    );
    return this.decrypt(
      stream.version ?? PackVersion.MS2F,
      Number(stream.encodedHeaderSize),
      Number(stream.compressedHeaderSize),
      new Encryption(Encryption.Aes | Encryption.Zlib),
      src
    );
  }

  static decryptFileTable(stream: IPackStream, buffer: BinaryBuffer) {
    if (
      !stream.compressedDataSize ||
      !stream.encodedDataSize ||
      !stream.dataSize
    ) {
      throw new Error(
        "ERROR decrypting file table: the size of the table is invalid."
      );
    }

    const src = BinaryBuffer.fromBuffer(
      buffer.readBytes(Number(stream.encodedDataSize))
    );
    return this.decrypt(
      stream.version ?? PackVersion.MS2F,
      Number(stream.encodedDataSize),
      Number(stream.compressedDataSize),
      new Encryption(Encryption.Aes | Encryption.Zlib),
      src
    );
  }

  static decryptData(pHeader: IPackFileHeader, fd: number) {
    if (
      !pHeader.compressedFileSize ||
      !pHeader.encodedFileSize ||
      !pHeader.fileSize
    ) {
      throw new Error(
        "ERROR decrypting data file segment: the size of the block is invalid."
      );
    }

    const start = Number(pHeader.offset ?? 0n);

    const src = Buffer.alloc(pHeader.encodedFileSize);
    fs.readSync(fd, src, 0, pHeader.encodedFileSize, start);

    return this.decrypt(
      pHeader.version ?? PackVersion.MS2F,
      pHeader.encodedFileSize,
      Number(pHeader.compressedFileSize),
      pHeader.bufferFlag ?? new Encryption(0),
      BinaryBuffer.fromBuffer(src)
    );
  }

  static decrypt(
    version: PackVersion,
    size: number,
    sizeCompressed: number,
    flag: Encryption,
    src: BinaryBuffer
  ): BinaryBuffer {
    if (flag.hasFlag(Encryption.Aes) && !flag.hasFlag(Encryption.Xor)) {
      // Get the AES Key/IV for transformation
      const [key, iv] = CipherKeys.getKeyAndIV(version, sizeCompressed);
      // Decode the base64 encoded string
      const srcString = src.getBuffer().toString("utf8");
      src = BinaryBuffer.fromBuffer(Buffer.from(srcString, "base64"));

      const cipher = new AESCipher(key.getBuffer(), iv.getBuffer());
      cipher.transformBlock(src, 0, size, src, 0);
    } else if (flag.hasFlag(Encryption.Xor)) {
      src = this.encryptXor(version, src, size, sizeCompressed);
    }

    if (flag.hasFlag(Encryption.Zlib)) {
      return BinaryBuffer.fromBuffer(zlib.unzipSync(src.getBuffer()));
    }

    return src;
  }

  static encrypt(
    version: PackVersion,
    src: BinaryBuffer,
    flag: Encryption
  ): [BinaryBuffer, number, number, number] {
    const size = src.length;
    let encrypted: BinaryBuffer;
    if (flag.hasFlag(Encryption.Zlib)) {
      encrypted = BinaryBuffer.fromBuffer(zlib.deflateSync(src.getBuffer()));
    } else {
      encrypted = BinaryBuffer.fromBuffer(Buffer.from(src.getBuffer()));
    }

    let sizeCompressed = encrypted.length;

    if (flag.hasFlag(Encryption.Aes) && !flag.hasFlag(Encryption.Xor)) {
      // Get the AES Key/IV for transformation
      const [key, iv] = CipherKeys.getKeyAndIV(version, sizeCompressed);

      const cipher = new AESCipher(key.getBuffer(), iv.getBuffer());
      cipher.transformBlock(encrypted, 0, size, encrypted, 0);

      // Encode the encrypted data into a base64 encoded string
      const stringBase64 = encrypted.getBuffer().toString("base64");
      encrypted = BinaryBuffer.fromBuffer(Buffer.from(stringBase64));
    } else if (flag.hasFlag(Encryption.Xor)) {
      // Perform XOR block encryption
      encrypted = this.encryptXor(version, encrypted, size, sizeCompressed);
    }

    return [encrypted, size, sizeCompressed, encrypted.length];
  }

  static encryptXor(
    version: PackVersion,
    src: BinaryBuffer,
    size: number,
    sizeCompressed: number
  ): BinaryBuffer {
    // The payload is XORed with the 2048-byte key table repeated from the start of the entry.
    const key = CipherKeys.getXorKey(version).getBuffer();
    const data = src.getBuffer();
    const length = Math.min(size, data.length);
    for (let i = 0; i < length; i++) {
      data[i] ^= key[i & 0x7ff];
    }

    return src;
  }
}
