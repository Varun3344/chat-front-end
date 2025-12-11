const encoder = new TextEncoder();
const decoder = new TextDecoder();

const getNodeBuffer = (): any => {
  if (typeof globalThis !== "undefined" && (globalThis as any).Buffer) {
    return (globalThis as any).Buffer;
  }
  return null;
};

const bufferToBase64 = (buffer: ArrayBuffer): string => {
  if (typeof window !== "undefined" && window.btoa) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }
  const NodeBuffer = getNodeBuffer();
  if (NodeBuffer) {
    return NodeBuffer.from(buffer).toString("base64");
  }
  throw new Error("Unable to encode data to base64 in this environment.");
};

const base64ToBuffer = (value: string): ArrayBuffer => {
  if (typeof window !== "undefined" && window.atob) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  const NodeBuffer = getNodeBuffer();
  if (NodeBuffer) {
    return NodeBuffer.from(value, "base64").buffer;
  }
  throw new Error("Unable to decode base64 in this environment.");
};

const getCrypto = (): Crypto => {
  const cryptoObj = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (!cryptoObj) {
    throw new Error("Web Crypto API is not available in this environment.");
  }
  return cryptoObj as Crypto;
};

const requireSubtle = (): SubtleCrypto => {
  const cryptoObj = getCrypto();
  if (!cryptoObj.subtle) {
    throw new Error("Web Crypto API subtle crypto is not available.");
  }
  return cryptoObj.subtle;
};

export const generateIdentityKeyPair = async () => {
  const subtle = requireSubtle();
  const keyPair = await subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"]
  );

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    subtle.exportKey("jwk", keyPair.publicKey),
    subtle.exportKey("jwk", keyPair.privateKey),
  ]);

  return {
    publicKeyJwk,
    privateKeyJwk,
  };
};

export const importPublicKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  return subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
};

export const importPrivateKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  return subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    ["deriveBits"]
  );
};

export const deriveSharedSecret = async (
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<ArrayBuffer> => {
  const subtle = requireSubtle();
  return subtle.deriveBits(
    {
      name: "ECDH",
      public: theirPublicKey,
    },
    myPrivateKey,
    256
  );
};

export const deriveAESKey = async (sharedSecret: ArrayBuffer): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  return subtle.importKey(
    "raw",
    sharedSecret,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const encryptMessage = async (plaintext: string, aesKey: CryptoKey) => {
  const subtle = requireSubtle();
  const cryptoObj = getCrypto();
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    aesKey,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
  };
};

export const decryptMessage = async (
  ciphertext: string,
  iv: string,
  aesKey: CryptoKey
): Promise<string> => {
  const subtle = requireSubtle();
  const plaintextBuffer = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(base64ToBuffer(iv)),
    },
    aesKey,
    base64ToBuffer(ciphertext)
  );
  return decoder.decode(plaintextBuffer);
};

export const encodePublicKey = (jwk: JsonWebKey): string => {
  const json = JSON.stringify(jwk);
  if (typeof window !== "undefined" && window.btoa) {
    return window.btoa(json);
  }
  return Buffer.from(json, "utf-8").toString("base64");
};

export const decodePublicKey = (value: string): JsonWebKey => {
  let json: string;
  if (typeof window !== "undefined" && window.atob) {
    json = window.atob(value);
  } else {
    json = Buffer.from(value, "base64").toString("utf-8");
  }
  return JSON.parse(json) as JsonWebKey;
};
