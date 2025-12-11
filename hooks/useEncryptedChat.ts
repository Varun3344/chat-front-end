import { useCallback, useEffect, useRef, useState } from "react";
import { httpRequest } from "src/lib/http";
import {
  decodePublicKey,
  decryptMessage,
  deriveAESKey,
  deriveSharedSecret,
  encodePublicKey,
  encryptMessage,
  generateIdentityKeyPair,
  importPrivateKey,
  importPublicKey,
} from "src/utils/e2ee";
import { getSocket } from "../utils/socket";

interface EncryptedEnvelope {
  conversationId: string;
  from: string;
  to: string;
  ciphertext: string;
  iv: string;
  createdAt?: string;
}

export interface DecryptedMessage extends EncryptedEnvelope {
  plaintext: string;
  direction: "inbound" | "outbound";
}

interface IdentityState {
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

interface UseEncryptedChatOptions {
  currentUserId: string;
}

interface SendParams {
  conversationId: string;
  to: string;
  plaintext: string;
}

export interface UseEncryptedChatResult {
  isReady: boolean;
  messages: DecryptedMessage[];
  sendEncryptedMessage: (options: SendParams) => Promise<void>;
  getConversationKey: (peerId: string) => Promise<CryptoKey>;
  identity: IdentityState | null;
}

const PRIVATE_KEY_STORAGE_KEY = "e2ee:identity-private";
const PUBLIC_KEY_STORAGE_KEY = "e2ee:identity-public";

const getStorageKey = (base: string, userId: string) => `${base}:${userId}`;

export const useEncryptedChat = ({ currentUserId }: UseEncryptedChatOptions): UseEncryptedChatResult => {
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [isReady, setReady] = useState(false);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const socketRef = useRef(getSocket());
  const keyCacheRef = useRef<Map<string, CryptoKey>>(new Map());

  const publishPublicKey = useCallback(
    async (publicKeyJwk: JsonWebKey) => {
      if (!currentUserId) return;
      const encoded = encodePublicKey(publicKeyJwk);
      await httpRequest(`/keys/${currentUserId}`, {
        method: "PUT",
        body: { publicKey: encoded },
      });
    },
    [currentUserId]
  );

  const bootstrapIdentity = useCallback(async () => {
    if (!currentUserId) return;
    if (typeof window === "undefined") return;

    try {
      const privateStorageKey = getStorageKey(PRIVATE_KEY_STORAGE_KEY, currentUserId);
      const publicStorageKey = getStorageKey(PUBLIC_KEY_STORAGE_KEY, currentUserId);

      const storedPrivate = window.localStorage.getItem(privateStorageKey);
      const storedPublic = window.localStorage.getItem(publicStorageKey);

      if (storedPrivate && storedPublic) {
        const privateKeyJwk = JSON.parse(storedPrivate) as JsonWebKey;
        const publicKeyJwk = JSON.parse(storedPublic) as JsonWebKey;
        const privateKey = await importPrivateKey(privateKeyJwk);
        setIdentity({ privateKey, publicKeyJwk });
        setReady(true);
        return;
      }

      const { privateKeyJwk, publicKeyJwk } = await generateIdentityKeyPair();
      const privateKey = await importPrivateKey(privateKeyJwk);
      window.localStorage.setItem(privateStorageKey, JSON.stringify(privateKeyJwk));
      window.localStorage.setItem(publicStorageKey, JSON.stringify(publicKeyJwk));
      await publishPublicKey(publicKeyJwk);
      setIdentity({ privateKey, publicKeyJwk });
      setReady(true);
    } catch (error) {
      console.error("[e2ee] Failed to bootstrap identity", error);
    }
  }, [currentUserId, publishPublicKey]);

  useEffect(() => {
    bootstrapIdentity();
  }, [bootstrapIdentity]);

  const ensureConversationKey = useCallback(
    async (peerId: string): Promise<CryptoKey> => {
      if (keyCacheRef.current.has(peerId)) {
        return keyCacheRef.current.get(peerId)!;
      }
      if (!identity?.privateKey) {
        throw new Error("Identity key not initialized.");
      }

      const response = await httpRequest<{ publicKey: string }>(`/keys/${peerId}`);
      if (!response?.publicKey) {
        throw new Error("Public key missing for peer");
      }

      const peerJwk = decodePublicKey(response.publicKey);
      const peerPublicKey = await importPublicKey(peerJwk);
      const sharedSecret = await deriveSharedSecret(identity.privateKey, peerPublicKey);
      const aesKey = await deriveAESKey(sharedSecret);
      keyCacheRef.current.set(peerId, aesKey);
      return aesKey;
    },
    [identity]
  );

  const sendEncryptedMessage = useCallback(
    async ({ conversationId, plaintext, to }: SendParams) => {
      if (!conversationId) {
        throw new Error("conversationId is required");
      }
      const socket = socketRef.current ?? getSocket();
      if (!socket) {
        throw new Error("Socket connection not available");
      }
      const aesKey = await ensureConversationKey(to);
      const { ciphertext, iv } = await encryptMessage(plaintext, aesKey);
      const envelope: EncryptedEnvelope = {
        conversationId,
        from: currentUserId,
        to,
        ciphertext,
        iv,
      };
      socket.emit("sendMessage", envelope);
      setMessages((prev) => [
        ...prev,
        {
          ...envelope,
          direction: "outbound",
          plaintext,
        },
      ]);
    },
    [currentUserId, ensureConversationKey]
  );

  useEffect(() => {
    const socket = socketRef.current ?? getSocket();
    if (!socket) return;

    const handleNewMessage = async (payload: EncryptedEnvelope) => {
      try {
        const peerId = payload.from === currentUserId ? payload.to : payload.from;
        const aesKey = await ensureConversationKey(peerId);
        const plaintext = await decryptMessage(payload.ciphertext, payload.iv, aesKey);
        setMessages((prev) => [
          ...prev,
          {
            ...payload,
            plaintext,
            direction: payload.from === currentUserId ? "outbound" : "inbound",
          },
        ]);
      } catch (error) {
        console.error("[e2ee] Unable to decrypt message", error);
      }
    };

    socket.on("newMessage", handleNewMessage);
    return () => {
      socket.off("newMessage", handleNewMessage);
    };
  }, [currentUserId, ensureConversationKey]);

  return {
    isReady,
    messages,
    sendEncryptedMessage,
    getConversationKey: ensureConversationKey,
    identity,
  };
};

export default useEncryptedChat;
