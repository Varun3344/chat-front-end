import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import ChatWindow from "../components/ChatWindow";
import UserList from "../components/UserList";
import { USERS } from "../data/dummyData";
import socket, {
  getSocket,
  joinDirectRoom,
  listenForDirectMessages,
  registerUser,
  sendDirectMessage as emitDirectMessage,
} from "../utils/socket";

const GROUP_EVENTS = {
  JOIN: "join_group",
  LEAVE: "leave_group",
  SEND: "send_group_message",
  RECEIVE: "receive_group_message",
};

const everyone = USERS.map((user) => user.id);

const DEFAULT_GROUPS = [
  {
    id: "product-squad",
    name: "Product Squad",
    description: "Daily stand-up room for the product/engineering group.",
    members: ["ravi", "shwetha", "varun"],
    createdBy: "ravi",
  },
  {
    id: "gtm-task-force",
    name: "GTM Task Force",
    description: "Marketing, CS and Product triage.",
    members: ["ravi", "kumar"],
    createdBy: "kumar",
  },
  {
    id: "all-hands",
    name: "Company All Hands",
    description: "Everyone gets this broadcast - tie it to announcements.",
    members: everyone,
    createdBy: "ravi",
  },
];

const formatNameMatch = (value = "") => value.trim().toLowerCase();

const generateClientMessageId = () =>
  `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const mergeMessageHistory = (history = [], nextMessage, currentUserId) => {
  if (!nextMessage) return history;
  const buffer = Array.isArray(history) ? history : [];
  if (nextMessage.from !== currentUserId) {
    return [...buffer, nextMessage];
  }
  const matchIndex = buffer.findIndex((message) => {
    if (!message?.optimistic) return false;
    if (
      nextMessage.clientMessageId &&
      message.clientMessageId &&
      message.clientMessageId === nextMessage.clientMessageId
    ) {
      return true;
    }
    return (
      !nextMessage.clientMessageId &&
      message.from === nextMessage.from &&
      message.to === nextMessage.to &&
      message.message === nextMessage.message
    );
  });
  if (matchIndex === -1) {
    return [...buffer, nextMessage];
  }
  const nextHistory = [...buffer];
  nextHistory[matchIndex] = {
    ...buffer[matchIndex],
    ...nextMessage,
    optimistic: false,
    status: "sent",
  };
  return nextHistory;
};

const createMessageFromPayload = (payload = {}, overrides = {}) => {
  const timestamp =
    payload.createdAt ??
    payload.timestamp ??
    overrides.timestamp ??
    new Date().toISOString();
  const clientMessageId =
    payload.clientMessageId ?? overrides.clientMessageId ?? null;

  return {
    id:
      payload.id ??
      payload.messageId ??
      overrides.id ??
      clientMessageId ??
      `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    clientMessageId: clientMessageId ?? undefined,
    from: payload.from ?? overrides.from ?? "system",
    to: payload.to ?? overrides.to ?? null,
    groupId: payload.groupId ?? overrides.groupId ?? null,
    message: payload.message ?? overrides.message ?? "",
    timestamp,
    createdAt: timestamp,
    optimistic: overrides.optimistic ?? false,
    status:
      overrides.status ??
      payload.status ??
      (overrides.optimistic ? "sending" : "sent"),
  };
};

export default function ChatPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeRoster, setActiveRoster] = useState("direct");
  const [activeContactId, setActiveContactId] = useState(null);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [directMessages, setDirectMessages] = useState({});
  const [groupMessages, setGroupMessages] = useState({});
  const [connectionState, setConnectionState] = useState("connecting");
  const [isSocketReady, setIsSocketReady] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const socketRef = useRef(socket);

  useEffect(() => {
    if (!router.isReady) return;
    const queryValue = router.query.user;
    const fallbackUserId = USERS[0]?.id ?? null;
    const resolvedUser = Array.isArray(queryValue)
      ? queryValue[0]
      : queryValue || fallbackUserId;
    setCurrentUserId(resolvedUser);
  }, [router.isReady, router.query.user]);

  const currentUser = useMemo(
    () => USERS.find((user) => user.id === currentUserId) ?? null,
    [currentUserId]
  );

  const baseContacts = useMemo(
    () => USERS.filter((user) => user.id !== currentUserId),
    [currentUserId]
  );

  useEffect(() => {
    if (!currentUserId || baseContacts.length === 0) {
      setActiveContactId(null);
      return;
    }
    setActiveContactId((previous) => {
      if (previous && baseContacts.some((contact) => contact.id === previous)) {
        return previous;
      }
      return baseContacts[0]?.id ?? null;
    });
  }, [baseContacts, currentUserId]);

  const visibleGroups = useMemo(() => {
    if (!currentUserId) return [];
    return groups.filter(
      (group) =>
        !Array.isArray(group.members) ||
        group.members.length === 0 ||
        group.members.includes(currentUserId)
    );
  }, [groups, currentUserId]);

  useEffect(() => {
    if (visibleGroups.length === 0) {
      setActiveGroupId(null);
      return;
    }
    setActiveGroupId((previous) => {
      if (previous && visibleGroups.some((group) => group.id === previous)) {
        return previous;
      }
      return visibleGroups[0]?.id ?? null;
    });
  }, [visibleGroups]);

  useEffect(() => {
    if (activeRoster === "group" && visibleGroups.length === 0) {
      setActiveRoster("direct");
    } else if (activeRoster === "direct" && baseContacts.length === 0) {
      setActiveRoster(visibleGroups.length > 0 ? "group" : "direct");
    }
  }, [activeRoster, baseContacts.length, visibleGroups.length]);

  const contactCards = useMemo(() => {
    return baseContacts.map((contact) => {
      const history = directMessages[contact.id] ?? [];
      const lastEntry = history[history.length - 1];
      return {
        ...contact,
        lastMessage: lastEntry?.message ?? contact.status ?? "",
        lastTimestamp: lastEntry?.timestamp ?? null,
      };
    });
  }, [baseContacts, directMessages]);

  const groupCards = useMemo(() => {
    return visibleGroups.map((group) => {
      const history = groupMessages[group.id] ?? [];
      const lastEntry = history[history.length - 1];
      return {
        ...group,
        lastMessage: lastEntry?.message ?? group.description ?? "",
        lastTimestamp: lastEntry?.timestamp ?? null,
      };
    });
  }, [visibleGroups, groupMessages]);

  const searchValue = formatNameMatch(searchTerm);

  const filteredContacts = useMemo(() => {
    if (!searchValue) return contactCards;
    return contactCards.filter((contact) => {
      const haystack = `${contact.name} ${contact.role ?? ""} ${contact.id}`.toLowerCase();
      return haystack.includes(searchValue);
    });
  }, [contactCards, searchValue]);

  const filteredGroups = useMemo(() => {
    if (!searchValue) return groupCards;
    return groupCards.filter((group) => {
      const haystack = `${group.name} ${group.description ?? ""}`.toLowerCase();
      return haystack.includes(searchValue);
    });
  }, [groupCards, searchValue]);

  useEffect(() => {
    const instance = socketRef.current ?? getSocket();
    if (!instance) return;

    socketRef.current = instance;

    const handleConnect = () => setConnectionState("connected");
    const handleDisconnect = () => setConnectionState("disconnected");

    instance.on("connect", handleConnect);
    instance.on("disconnect", handleDisconnect);

    if (!instance.connected) {
      instance.connect();
    } else {
      setConnectionState("connected");
    }

    setIsSocketReady(true);

    return () => {
      instance.off("connect", handleConnect);
      instance.off("disconnect", handleDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) return;
    registerUser(currentUserId);
  }, [isSocketReady, currentUserId]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) return;

    const unsubscribe = listenForDirectMessages((payload) => {
      if (!payload) return;
      if (
        payload.from !== currentUserId &&
        payload.to !== currentUserId
      ) {
        return;
      }
      const peerId =
        payload.from === currentUserId ? payload.to : payload.from;
      if (!peerId) return;
      const normalized = createMessageFromPayload(payload, {
        optimistic: false,
        status: "sent",
      });
      setDirectMessages((prev) => {
        const history = prev[peerId] ?? [];
        return {
          ...prev,
          [peerId]: mergeMessageHistory(history, normalized, currentUserId),
        };
      });
    });

    return () => {
      unsubscribe();
    };
  }, [isSocketReady, currentUserId]);

  useEffect(() => {
    if (!isSocketReady) return;
    const instance = socketRef.current;
    if (!instance) return;

    const handleGroupMessage = (payload) => {
      if (!payload?.groupId) return;
      const isMember = visibleGroups.some((group) => group.id === payload.groupId);
      if (!isMember) {
        return;
      }
      const normalized = createMessageFromPayload(payload);
      setGroupMessages((prev) => {
        const history = prev[payload.groupId] ?? [];
        return {
          ...prev,
          [payload.groupId]: [...history, normalized],
        };
      });
    };

    instance.on(GROUP_EVENTS.RECEIVE, handleGroupMessage);

    return () => {
      instance.off(GROUP_EVENTS.RECEIVE, handleGroupMessage);
    };
  }, [isSocketReady, visibleGroups]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId || !activeContactId) return;
    joinDirectRoom(currentUserId, activeContactId);
  }, [activeContactId, currentUserId, isSocketReady]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId || !activeGroupId) return;
    const instance = socketRef.current;
    if (!instance) return;

    const payload = { groupId: activeGroupId, userId: currentUserId };
    instance.emit(GROUP_EVENTS.JOIN, payload);

    return () => {
      instance.emit(GROUP_EVENTS.LEAVE, payload);
    };
  }, [activeGroupId, currentUserId, isSocketReady]);

  const handleSendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || !currentUserId || !isSocketReady) {
      return;
    }
    setErrorMessage("");
    setIsSending(true);
    try {
      if (activeRoster === "group" && activeGroupId) {
        const payload = {
          groupId: activeGroupId,
          from: currentUserId,
          message: trimmed,
        };
        setGroupMessages((prev) => {
          const history = prev[activeGroupId] ?? [];
          return {
            ...prev,
            [activeGroupId]: [
              ...history,
              createMessageFromPayload(payload, { optimistic: true }),
            ],
          };
        });
        const instance = socketRef.current;
        if (instance) {
          instance.emit(GROUP_EVENTS.SEND, payload);
        }
      } else if (activeContactId) {
        const clientMessageId = generateClientMessageId();
        const payload = {
          from: currentUserId,
          to: activeContactId,
          message: trimmed,
          clientMessageId,
        };
        setDirectMessages((prev) => {
          const history = prev[activeContactId] ?? [];
          return {
            ...prev,
            [activeContactId]: [
              ...history,
              createMessageFromPayload(payload, {
                optimistic: true,
                status: "sending",
              }),
            ],
          };
        });
        emitDirectMessage(payload);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to send the message."
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateGroup = () => {
    if (!currentUserId) return;
    if (typeof window === "undefined") return;
    const name =
      window.prompt("Name of the new group channel?", "New project room")?.trim() ??
      "";
    if (!name) return;
    const identifier = `${name.toLowerCase().replace(/[^a-z0-9]/gi, "-")}-${Date.now()
      .toString(36)
      .slice(2)}`;
    const description =
      window.prompt("Optional description for this group?", "") ?? "";
    const nextGroup = {
      id: identifier,
      name,
      description,
      members: [currentUserId],
      createdBy: currentUserId,
    };
    setGroups((previous) => [...previous, nextGroup]);
    setActiveRoster("group");
    setActiveGroupId(nextGroup.id);
  };

  const handleAddMember = async (memberId) => {
    if (!activeGroupId || !memberId) return;
    setGroups((previous) =>
      previous.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              members: Array.from(new Set([...(group.members ?? []), memberId])),
            }
          : group
      )
    );
  };

  const handleRemoveMember = async (memberId) => {
    if (!activeGroupId || !memberId) return;
    setGroups((previous) =>
      previous.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              members: (group.members ?? []).filter((id) => id !== memberId),
            }
          : group
      )
    );
  };

  const selectedContact = useMemo(
    () => contactCards.find((contact) => contact.id === activeContactId) ?? null,
    [activeContactId, contactCards]
  );

  const selectedGroup = useMemo(
    () => groupCards.find((group) => group.id === activeGroupId) ?? null,
    [activeGroupId, groupCards]
  );

  const currentMessages =
    activeRoster === "group"
      ? groupMessages[activeGroupId] ?? []
      : directMessages[activeContactId] ?? [];

  const isGroupAdmin =
    activeRoster === "group" &&
    selectedGroup &&
    (selectedGroup.createdBy
      ? selectedGroup.createdBy === currentUserId
      : selectedGroup.members?.includes(currentUserId));

  if (!router.isReady || !currentUserId) {
    return (
      <div style={styles.blankState}>
        <p>Loading chat workspace...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={styles.blankState}>
        <h2>Select an account first</h2>
        <p>
          Visit the home page and choose a teammate so we can load their inbox.
        </p>
        <button style={styles.primaryButton} onClick={() => router.push("/")}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <main style={styles.layout}>
      <UserList
        currentUser={currentUser}
        contacts={filteredContacts}
        groups={filteredGroups}
        activeRoster={activeRoster}
        activeContactId={activeContactId}
        activeGroupId={activeGroupId}
        isGroupsLoading={false}
        onRosterChange={setActiveRoster}
        onSelectContact={setActiveContactId}
        onSelectGroup={setActiveGroupId}
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        onCreateGroup={handleCreateGroup}
      />
      <section style={styles.windowWrapper}>
        <div style={styles.windowHeader}>
          <div>
            <p style={styles.windowEyebrow}>Realtime status</p>
            <h3 style={styles.windowTitle}>
              {connectionState === "connected" ? "Ready" : connectionState}
            </h3>
          </div>
          <span
            style={{
              ...styles.connectionBadge,
              background:
                connectionState === "connected" ? "#22c55e" : "#f97316",
            }}
          >
            {connectionState}
          </span>
        </div>
        <ChatWindow
          currentUser={currentUser}
          chatType={activeRoster}
          selectedContact={selectedContact}
          selectedGroup={selectedGroup}
          messages={currentMessages}
          onSendMessage={handleSendMessage}
          isLoading={false}
          isSending={isSending}
          errorMessage={errorMessage}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          availableMembers={USERS}
          isGroupAdmin={Boolean(isGroupAdmin)}
        />
      </section>
    </main>
  );
}

const styles = {
  layout: {
    minHeight: "100vh",
    display: "flex",
    background: "#020617",
    color: "#f8fafc",
  },
  windowWrapper: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "#0f172a",
  },
  windowHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: "1px solid rgba(148,163,184,0.2)",
  },
  windowEyebrow: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
  windowTitle: {
    margin: "4px 0 0",
    fontSize: "1.1rem",
  },
  connectionBadge: {
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: "0.85rem",
    textTransform: "capitalize",
  },
  blankState: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    textAlign: "center",
    background: "#0f172a",
    color: "#e2e8f0",
  },
  primaryButton: {
    borderRadius: 999,
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    padding: "12px 24px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
