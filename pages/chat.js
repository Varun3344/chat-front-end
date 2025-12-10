import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  fetchDirectMessagesViaApi,
  sendDirectMessageViaApi,
  deleteDirectMessageViaApi,
} from "src/lib/client/directMessages";
import {
  fetchGroupMessagesViaApi,
  listGroupsViaApi,
  sendGroupMessageViaApi,
  createGroupViaApi,
  addGroupMemberViaApi,
  removeGroupMemberViaApi,
} from "src/lib/client/groupMessages";
import { USERS } from "../data/dummyData";
import socket, {
  getSocket,
  joinDirectRoom,
  joinGroupRoom,
  leaveGroupRoom,
  listenForDirectMessages,
  listenForGroupMessages,
  registerUser,
  sendDirectMessage as emitDirectMessage,
  sendGroupMessage as emitGroupMessage,
} from "../utils/socket";

const everyone = USERS.map((user) => user.id);

const DEFAULT_GROUPS = [
  {
    id: "product-squad",
    name: "Product Squad",
    description: "Daily stand-up room for the product/engineering group.",
    members: ["ravi", "shwetha", "varun"],
  },
  {
    id: "gtm-task-force",
    name: "GTM Task Force",
    description: "Marketing, CS and Product triage.",
    members: ["ravi", "kumar"],
  },
  {
    id: "all-hands",
    name: "Company All Hands",
    description: "Everyone gets this broadcast – tie it to announcements.",
    members: everyone,
  },
];

const lookupName = (userId) =>
  USERS.find((user) => user.id === userId)?.name ?? userId ?? "Teammate";

const formatTime = (value) => {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

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
    optimistic: overrides.optimistic ?? false,
    status:
      overrides.status ??
      payload.status ??
      (overrides.optimistic ? "sending" : "sent"),
  };
};

const mergeFetchedMessages = (existingHistory = [], fetchedMessages = []) => {
  const normalized = (Array.isArray(fetchedMessages) ? fetchedMessages : [])
    .map((payload) =>
      createMessageFromPayload(payload, {
        optimistic: false,
        status: "sent",
      })
    )
    .sort((a, b) => {
      const left = Date.parse(a.timestamp ?? "") || 0;
      const right = Date.parse(b.timestamp ?? "") || 0;
      return left - right;
    });

  const ackedIds = new Set(
    normalized
      .map((message) => message.clientMessageId)
      .filter((value) => Boolean(value))
  );

  const optimisticRemainder = (Array.isArray(existingHistory) ? existingHistory : []).filter(
    (message) => message.optimistic && (!message.clientMessageId || !ackedIds.has(message.clientMessageId))
  );

  return [...normalized, ...optimisticRemainder];
};

export default function ChatPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeRoster, setActiveRoster] = useState("direct");
  const [activeContactId, setActiveContactId] = useState(null);
  const [activeGroupId, setActiveGroupId] = useState(
    DEFAULT_GROUPS[0]?.id ?? null
  );
  const [directMessages, setDirectMessages] = useState({});
  const [groupMessages, setGroupMessages] = useState({});
  const [remoteGroups, setRemoteGroups] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [connectionState, setConnectionState] = useState("connecting");
  const [isSocketReady, setIsSocketReady] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]);
  const [groupFormStatus, setGroupFormStatus] = useState(null);
  const [isSubmittingGroup, setIsSubmittingGroup] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState("");
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberActionError, setMemberActionError] = useState(null);
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [removeMemberError, setRemoveMemberError] = useState(null);
  const [messageActionTarget, setMessageActionTarget] = useState(null);
  const [messageActionError, setMessageActionError] = useState(null);
  const [isDeletingMessageId, setIsDeletingMessageId] = useState(null);

  const socketRef = useRef(socket);
  const messageActionTimerRef = useRef(null);

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

  const contacts = useMemo(
    () => USERS.filter((user) => user.id !== currentUserId),
    [currentUserId]
  );

  useEffect(() => {
    if (contacts.length === 0) {
      setActiveContactId(null);
      return;
    }
    setActiveContactId((previous) => {
      if (previous && contacts.some((contact) => contact.id === previous)) {
        return previous;
      }
      return contacts[0].id;
    });
  }, [contacts]);

  useEffect(() => {
    if (!currentUserId) {
      setRemoteGroups([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    listGroupsViaApi(currentUserId, { signal: controller.signal })
      .then((response) => {
        if (cancelled) return;
        setRemoteGroups(Array.isArray(response) ? response : []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] group list fetch failed", error);
        setRemoteGroups([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUserId]);

  const groups = useMemo(() => {
    if (!currentUserId) return [];
    const source = remoteGroups.length > 0 ? remoteGroups : DEFAULT_GROUPS;
    return source
      .filter((group) => {
        const members = Array.isArray(group.members) ? group.members : [];
        return members.length === 0 || members.includes(currentUserId);
      })
      .map((group) => ({
        ...group,
        members: Array.isArray(group.members) ? group.members : [],
        description: group.description ?? group.name ?? "Group chat",
      }));
  }, [currentUserId, remoteGroups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  useEffect(() => {
    if (groups.length === 0) {
      setActiveGroupId(null);
      return;
    }
    setActiveGroupId((previous) => {
      if (previous && groups.some((group) => group.id === previous)) {
        return previous;
      }
      return groups[0].id;
    });
  }, [groups]);

  useEffect(() => {
    if (activeRoster === "group" && groups.length === 0) {
      setActiveRoster("direct");
    } else if (activeRoster === "direct" && contacts.length === 0) {
      setActiveRoster(groups.length > 0 ? "group" : "direct");
    }
  }, [activeRoster, contacts.length, groups.length]);

  useEffect(() => {
    setPendingMemberId("");
    setMemberActionError(null);
    setRemoveMemberError(null);
    setRemovingMemberId(null);
  }, [activeGroupId]);

  useEffect(() => {
    setMessageActionTarget(null);
    setMessageActionError(null);
    setIsDeletingMessageId(null);
    if (messageActionTimerRef.current) {
      clearTimeout(messageActionTimerRef.current);
    }
  }, [activeContactId, activeRoster]);

  const resetGroupForm = () => {
    setNewGroupName("");
    setNewGroupMembers([]);
    setGroupFormStatus(null);
    setIsCreatingGroup(false);
  };

  const handleMemberSelection = (memberId) => {
    if (!memberId) return;
    setNewGroupMembers((prev) => {
      const exists = prev.includes(memberId);
      if (exists) {
        return prev.filter((id) => id !== memberId);
      }
      return [...prev, memberId];
    });
  };

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    if (!currentUserId) {
      setGroupFormStatus("Pick a user before creating a group.");
      return;
    }
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setGroupFormStatus("Group name is required.");
      return;
    }
    setIsSubmittingGroup(true);
    setGroupFormStatus(null);
    try {
      const response = await createGroupViaApi({
        groupName: trimmed,
        createdBy: currentUserId,
      });
      const groupId =
        response?.groupId ??
        response?.data?.groupId ??
        `group-${Date.now().toString(36)}`;
      const uniqueMembers = Array.from(
        new Set([currentUserId, ...newGroupMembers])
      );
      const membersToAdd = uniqueMembers.filter(
        (memberId) => memberId !== currentUserId
      );
      if (membersToAdd.length > 0) {
        await Promise.all(
          membersToAdd.map((memberId) =>
            addGroupMemberViaApi({ groupId, memberId }).catch((error) => {
              console.error("[chat] add member during create failed", error);
            })
          )
        );
      }
      const nextGroup = {
        id: groupId,
        name: trimmed,
        description: `Created by ${lookupName(currentUserId)}`,
        members: uniqueMembers,
      };
      setRemoteGroups((prev) => [...prev, nextGroup]);
      setActiveGroupId(groupId);
      setActiveRoster("group");
      setGroupMessages((prev) => ({ ...prev, [groupId]: [] }));
      resetGroupForm();
    } catch (error) {
      console.error("[chat] create group failed", error);
      setGroupFormStatus(
        error instanceof Error ? error.message : "Failed to create group."
      );
    } finally {
      setIsSubmittingGroup(false);
    }
  };

  const availableMembersToAdd = useMemo(() => {
    if (!activeGroup) return [];
    const memberSet = new Set(activeGroup.members ?? []);
    return USERS.filter(
      (user) => !memberSet.has(user.id) && user.id !== currentUserId
    );
  }, [activeGroup, currentUserId]);

  const handleAddMemberToGroup = async (event) => {
    event.preventDefault();
    if (!activeGroupId || !pendingMemberId) {
      setMemberActionError("Pick a teammate to add.");
      return;
    }
    setIsAddingMember(true);
    setMemberActionError(null);
    try {
      await addGroupMemberViaApi({
        groupId: activeGroupId,
        memberId: pendingMemberId,
      });
      setRemoteGroups((prev) =>
        prev.map((group) => {
          if (group.id !== activeGroupId) return group;
          const existingMembers = Array.isArray(group.members)
            ? group.members
            : [];
          if (existingMembers.includes(pendingMemberId)) {
            return group;
          }
          return {
            ...group,
            members: [...existingMembers, pendingMemberId],
          };
        })
      );
      setPendingMemberId("");
    } catch (error) {
      console.error("[chat] add member failed", error);
      setMemberActionError(
        error instanceof Error ? error.message : "Unable to add member."
      );
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMemberFromGroup = async (memberId) => {
    if (!activeGroupId || !memberId) return;
    setRemovingMemberId(memberId);
    setRemoveMemberError(null);
    try {
      await removeGroupMemberViaApi({
        groupId: activeGroupId,
        memberId,
      });
      setRemoteGroups((prev) =>
        prev.map((group) => {
          if (group.id !== activeGroupId) return group;
          const members = Array.isArray(group.members) ? group.members : [];
          return {
            ...group,
            members: members.filter((id) => id !== memberId),
          };
        })
      );
      if (pendingMemberId === memberId) {
        setPendingMemberId("");
      }
    } catch (error) {
      console.error("[chat] remove member failed", error);
      setRemoveMemberError(
        error instanceof Error ? error.message : "Unable to remove member."
      );
    } finally {
      setRemovingMemberId(null);
    }
  };

  const markMessageActionTarget = (message) => {
    if (activeRoster !== "direct" || !message?.id) return;
    setMessageActionTarget({
      messageId: message.id,
      clientMessageId: message.clientMessageId ?? null,
      peerId: activeContactId,
    });
    setMessageActionError(null);
  };

  const beginMessageActionCountdown = (message) => {
    if (activeRoster !== "direct" || !message?.id) return;
    if (messageActionTimerRef.current) {
      clearTimeout(messageActionTimerRef.current);
    }
    messageActionTimerRef.current = setTimeout(() => {
      markMessageActionTarget(message);
    }, 600);
  };

  const cancelMessageActionCountdown = () => {
    if (messageActionTimerRef.current) {
      clearTimeout(messageActionTimerRef.current);
    }
  };

  const handleDeleteSelectedMessage = async () => {
    if (
      !currentUserId ||
      !messageActionTarget?.messageId ||
      !messageActionTarget?.peerId
    ) {
      return;
    }
    const { messageId, clientMessageId, peerId } = messageActionTarget;
    setIsDeletingMessageId(messageId);
    setMessageActionError(null);
    try {
      await deleteDirectMessageViaApi({ messageId });
      setDirectMessages((prev) => {
        const history = prev[peerId] ?? [];
        const filtered = history.filter((message) => {
          if (message.id && message.id === messageId) {
            return false;
          }
          if (clientMessageId && message.clientMessageId === clientMessageId) {
            return false;
          }
          return true;
        });
        return {
          ...prev,
          [peerId]: filtered,
        };
      });
      setMessageActionTarget(null);
    } catch (error) {
      console.error("[chat] delete message failed", error);
      setMessageActionError(
        error instanceof Error ? error.message : "Unable to delete message."
      );
    } finally {
      setIsDeletingMessageId(null);
    }
  };

  const dismissMessageAction = () => {
    setMessageActionTarget(null);
    setMessageActionError(null);
    cancelMessageActionCountdown();
  };

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
      if (messageActionTimerRef.current) {
        clearTimeout(messageActionTimerRef.current);
      }
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
    if (!currentUserId || !activeContactId) return;
    let cancelled = false;
    const controller = new AbortController();

    fetchDirectMessagesViaApi(
      { userA: currentUserId, userB: activeContactId },
      { signal: controller.signal }
    )
      .then((messages) => {
        if (cancelled) return;
        setDirectMessages((prev) => ({
          ...prev,
          [activeContactId]: mergeFetchedMessages(prev[activeContactId], messages),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] direct history fetch failed", error);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUserId, activeContactId]);

  useEffect(() => {
    if (!isSocketReady) return;

    const unsubscribe = listenForGroupMessages((payload) => {
      if (!payload?.groupId) return;
      const isMember = groups.some((group) => group.id === payload.groupId);
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
    });

    return () => {
      unsubscribe();
    };
  }, [isSocketReady, groups]);

  useEffect(() => {
    if (!currentUserId || !activeGroupId) return;
    let cancelled = false;
    const controller = new AbortController();

    fetchGroupMessagesViaApi(activeGroupId, { signal: controller.signal })
      .then((messages) => {
        if (cancelled) return;
        setGroupMessages((prev) => ({
          ...prev,
          [activeGroupId]: mergeFetchedMessages(prev[activeGroupId], messages),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] group history fetch failed", error);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUserId, activeGroupId]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId || !activeContactId) return;
    joinDirectRoom(currentUserId, activeContactId);
  }, [activeContactId, currentUserId, isSocketReady]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId || !activeGroupId) return;

    joinGroupRoom(activeGroupId, currentUserId);

    return () => {
      leaveGroupRoom(activeGroupId, currentUserId);
    };
  }, [activeGroupId, currentUserId, isSocketReady]);

  const handleSendMessage = (event) => {
    event.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed || !currentUserId || !isSocketReady) {
      setMessageInput("");
      return;
    }
    const instance = socketRef.current;
    if (activeRoster === "group" && activeGroupId) {
      if (!instance) return;
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
      emitGroupMessage(payload);
      sendGroupMessageViaApi(payload).catch((error) => {
        console.error("[chat] group REST send failed", error);
      });
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
      sendDirectMessageViaApi({
        from: payload.from,
        to: payload.to,
        message: payload.message,
        metadata: {
          ...(payload.metadata ?? {}),
          clientMessageId,
        },
      }).catch((error) => {
        console.error("[chat] direct REST send failed", error);
      });
    }

    setMessageInput("");
  };

  const currentMessages =
    activeRoster === "group"
      ? groupMessages[activeGroupId] ?? []
      : directMessages[activeContactId] ?? [];

  const roomLabel =
    activeRoster === "group"
      ? groups.find((group) => group.id === activeGroupId)?.name ?? "No group"
      : contacts.find((contact) => contact.id === activeContactId)?.name ??
        "No contact";

  const canSendToRoom =
    activeRoster === "group" ? Boolean(activeGroupId) : Boolean(activeContactId);

  if (!router.isReady || !currentUserId) {
    return (
      <div style={styles.blankState}>
        <p>Loading chat experience...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={styles.blankState}>
        <h2>Choose an account</h2>
        <p>
          Select a teammate on the home page so we know which user should join rooms.
        </p>
        <button style={styles.primaryButton} onClick={() => router.push("/")}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.profileCard}>
          <div style={styles.avatar}>{currentUser.name[0]}</div>
          <div>
            <p style={styles.profileLabel}>Logged in as</p>
            <h3 style={styles.profileName}>{currentUser.name}</h3>
            <p style={styles.profileMeta}>{currentUser.role}</p>
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
        </div>

        <div style={styles.tabBar}>
          <button
            type="button"
            onClick={() => setActiveRoster("direct")}
            style={{
              ...styles.tabButton,
              ...(activeRoster === "direct" ? styles.tabButtonActive : {}),
            }}
          >
            Direct
          </button>
          <button
            type="button"
            onClick={() => setActiveRoster("group")}
            style={{
              ...styles.tabButton,
              ...(activeRoster === "group" ? styles.tabButtonActive : {}),
            }}
          >
            Groups
          </button>
        </div>

        <div style={styles.listHeading}>
          {activeRoster === "group" ? "Group rooms" : "Direct chats"}
        </div>

        <div style={styles.roomList}>
          {activeRoster === "group"
            ? groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setActiveGroupId(group.id);
                    setActiveRoster("group");
                  }}
                  style={{
                    ...styles.roomButton,
                    ...(group.id === activeGroupId ? styles.roomButtonActive : {}),
                  }}
                >
                  <strong>{group.name}</strong>
                  <span style={styles.roomDescription}>{group.description}</span>
                  <span style={styles.roomMeta}>
                    {group.members.length} members
                  </span>
                </button>
              ))
            : contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    setActiveRoster("direct");
                    setActiveContactId(contact.id);
                  }}
                  style={{
                    ...styles.roomButton,
                    ...(contact.id === activeContactId ? styles.roomButtonActive : {}),
                  }}
                >
                  <strong>{contact.name}</strong>
                  <span style={styles.roomDescription}>{contact.role}</span>
                </button>
              ))}

          {activeRoster === "group" && groups.length === 0 && (
            <p style={styles.helperText}>
              No groups available for this user. Add them to a group to start a room.
            </p>
          )}
          {activeRoster === "direct" && contacts.length === 0 && (
            <p style={styles.helperText}>
              No teammates to chat with. Add more contacts to see them here.
            </p>
          )}
        </div>

        {activeRoster === "group" && (
          <div style={styles.groupCreator}>
            {!isCreatingGroup ? (
              <button
                type="button"
                style={styles.groupCreatorButton}
                onClick={() => {
                  setIsCreatingGroup(true);
                  setGroupFormStatus(null);
                }}
              >
                + Create group
              </button>
            ) : (
              <form style={styles.groupForm} onSubmit={handleCreateGroup}>
                <label style={styles.groupFormLabel}>
                  Group name
                  <input
                    style={styles.groupFormInput}
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    placeholder="eg. Marketing sync"
                  />
                </label>
                <p style={styles.groupFormLabel}>Members</p>
                <div style={styles.groupMemberChecklist}>
                  {contacts.map((contact) => (
                    <label key={contact.id} style={styles.groupMemberOption}>
                      <input
                        type="checkbox"
                        checked={newGroupMembers.includes(contact.id)}
                        onChange={() => handleMemberSelection(contact.id)}
                      />
                      <span>{contact.name}</span>
                    </label>
                  ))}
                  {contacts.length === 0 && (
                    <p style={styles.helperText}>
                      No teammates available to add right now.
                    </p>
                  )}
                </div>
                {groupFormStatus && (
                  <p style={styles.formError}>{groupFormStatus}</p>
                )}
                <div style={styles.groupCreatorActions}>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={resetGroupForm}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      ...styles.primaryButton,
                      opacity: isSubmittingGroup ? 0.7 : 1,
                    }}
                    disabled={isSubmittingGroup}
                  >
                    {isSubmittingGroup ? "Creating..." : "Create group"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </aside>

      <section style={styles.chatPane}>
        <header style={styles.chatHeader}>
          <div>
            <p style={styles.chatEyebrow}>Active room</p>
            <h2 style={styles.chatTitle}>{roomLabel}</h2>
          </div>
          <button style={styles.secondaryButton} onClick={() => router.push("/")}>
            Switch user
          </button>
        </header>

        {activeRoster === "group" && activeGroup && (
          <div style={styles.groupMetaHud}>
            <div style={styles.memberListSection}>
              <p style={styles.groupEyebrow}>
                Members ({activeGroup.members.length})
              </p>
              <div style={styles.memberChipList}>
                {activeGroup.members.map((memberId) => (
                  <div key={memberId} style={styles.memberChip}>
                    <span>{lookupName(memberId)}</span>
                    {memberId !== currentUserId && (
                      <button
                        type="button"
                        style={styles.memberRemoveButton}
                        onClick={() => handleRemoveMemberFromGroup(memberId)}
                        disabled={removingMemberId === memberId}
                      >
                        {removingMemberId === memberId ? "Removing..." : "Remove"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {removeMemberError && (
                <p style={styles.formError}>{removeMemberError}</p>
              )}
            </div>
            <form style={styles.memberAddForm} onSubmit={handleAddMemberToGroup}>
              <label style={styles.groupFormLabel}>
                Add teammate
                <select
                  style={styles.groupFormInput}
                  value={pendingMemberId}
                  onChange={(event) => setPendingMemberId(event.target.value)}
                >
                  <option value="">Select teammate...</option>
                  {availableMembersToAdd.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              {memberActionError && (
                <p style={styles.formError}>{memberActionError}</p>
              )}
              <button
                type="submit"
                style={{
                  ...styles.secondaryButton,
                  opacity: !pendingMemberId || isAddingMember ? 0.6 : 1,
                }}
                disabled={!pendingMemberId || isAddingMember}
              >
                {isAddingMember ? "Adding..." : "Add member"}
              </button>
            </form>
          </div>
        )}

        <div style={styles.messagesPane}>
          {currentMessages.length === 0 ? (
            <div style={styles.blankMessages}>
              <p>No messages yet. Say hi to kick off this room.</p>
            </div>
          ) : (
            currentMessages.map((message) => {
              const isSelf = message.from === currentUserId;
              const canShowMessageActions =
                activeRoster === "direct" &&
                isSelf &&
                Boolean(message.id) &&
                !message.optimistic;
              const isActionActive =
                canShowMessageActions &&
                messageActionTarget?.messageId === message.id;
              return (
                <div
                  key={message.id}
                  style={{
                    ...styles.messageBubble,
                    alignSelf: isSelf ? "flex-end" : "flex-start",
                    background: isSelf ? "#4c1d95" : "#1e1b4b",
                  }}
                  onPointerDown={
                    canShowMessageActions
                      ? () => beginMessageActionCountdown(message)
                      : undefined
                  }
                  onPointerUp={
                    canShowMessageActions ? cancelMessageActionCountdown : undefined
                  }
                  onPointerLeave={
                    canShowMessageActions ? cancelMessageActionCountdown : undefined
                  }
                  onContextMenu={
                    canShowMessageActions
                      ? (event) => {
                          event.preventDefault();
                          markMessageActionTarget(message);
                        }
                      : undefined
                  }
                >
                  <div style={styles.messageMeta}>
                    <strong>{lookupName(message.from)}</strong>
                    <span>{formatTime(message.timestamp)}</span>
                    {isSelf && (
                      <em style={styles.deliveryState}>
                        {message.status === "sending"
                          ? "sending..."
                          : message.status ?? "sent"}
                      </em>
                    )}
                  </div>
                  <p style={styles.messageBody}>{message.message}</p>
                  {isActionActive && (
                    <div style={styles.messageActions}>
                      {messageActionError && (
                        <p style={styles.messageActionError}>{messageActionError}</p>
                      )}
                      <div style={styles.messageActionButtons}>
                        <button
                          type="button"
                          style={{
                            ...styles.messageActionButton,
                            ...styles.messageActionDanger,
                            opacity:
                              isDeletingMessageId === message.id ? 0.7 : 1,
                          }}
                          disabled={isDeletingMessageId === message.id}
                          onClick={handleDeleteSelectedMessage}
                        >
                          {isDeletingMessageId === message.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                        <button
                          type="button"
                          style={styles.messageActionButton}
                          onClick={dismissMessageAction}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <form style={styles.composer} onSubmit={handleSendMessage}>
          <textarea
            style={styles.textarea}
            placeholder={
              activeRoster === "group"
                ? "Message this group..."
                : "Message this teammate..."
            }
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            rows={2}
          />
          <button
            type="submit"
            style={{
              ...styles.primaryButton,
              opacity: messageInput.trim() && canSendToRoom ? 1 : 0.6,
            }}
            disabled={!messageInput.trim() || !canSendToRoom}
          >
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    overflow: "hidden",
    boxSizing: "border-box",
    display: "flex",
    background: "#0f172a",
    color: "#e2e8f0",
  },
  sidebar: {
    width: 320,
    borderRight: "1px solid rgba(148,163,184,0.2)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    overflowY: "auto",
    boxSizing: "border-box",
  },
  profileCard: {
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(148,163,184,0.3)",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: "#7c3aed",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "1.3rem",
  },
  profileLabel: {
    fontSize: "0.8rem",
    margin: 0,
    color: "#94a3b8",
  },
  profileName: {
    margin: "2px 0",
    fontSize: "1.15rem",
  },
  profileMeta: {
    margin: 0,
    color: "#a5b4fc",
    fontSize: "0.9rem",
  },
  connectionBadge: {
    display: "inline-flex",
    marginTop: 8,
    padding: "2px 10px",
    borderRadius: 999,
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tabBar: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  tabButton: {
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.4)",
    padding: "6px 0",
    background: "transparent",
    color: "#e2e8f0",
    cursor: "pointer",
    fontWeight: 600,
  },
  tabButtonActive: {
    borderColor: "#7c3aed",
    background: "rgba(124,58,237,0.15)",
  },
  listHeading: {
    fontSize: "0.9rem",
    color: "#a5b4fc",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  roomList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflowY: "auto",
  },
  groupCreator: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.4)",
    background: "rgba(15,23,42,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  groupCreatorButton: {
    borderRadius: 999,
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    padding: "12px 24px",
    fontWeight: 600,
    cursor: "pointer",
  },
  groupForm: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  groupFormLabel: {
    fontSize: "0.85rem",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  groupFormInput: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.4)",
    padding: "10px 12px",
    background: "rgba(15,23,42,0.8)",
    color: "#e2e8f0",
  },
  groupMemberChecklist: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 160,
    overflowY: "auto",
  },
  groupMemberOption: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: "0.9rem",
  },
  groupCreatorActions: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  formError: {
    color: "#fb7185",
    fontSize: "0.85rem",
  },
  roomButton: {
    borderRadius: 14,
    padding: 12,
    border: "1px solid rgba(148,163,184,0.4)",
    background: "transparent",
    color: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    textAlign: "left",
    cursor: "pointer",
  },
  roomButtonActive: {
    borderColor: "#c4b5fd",
    background: "rgba(79,70,229,0.2)",
  },
  roomDescription: {
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  roomMeta: {
    fontSize: "0.75rem",
    color: "#a5b4fc",
  },
  helperText: {
    marginTop: 16,
    fontSize: "0.9rem",
    color: "#94a3b8",
  },
  chatPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: 24,
    gap: 16,
    height: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
  },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupMetaHud: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "rgba(15,23,42,0.6)",
  },
  memberListSection: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  groupEyebrow: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
  memberChipList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  memberChip: {
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(124,58,237,0.2)",
    border: "1px solid rgba(124,58,237,0.4)",
    fontSize: "0.8rem",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  memberRemoveButton: {
    border: "none",
    background: "transparent",
    color: "#f87171",
    cursor: "pointer",
    fontSize: "0.75rem",
  },
  memberAddForm: {
    width: 260,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  chatEyebrow: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
  chatTitle: {
    margin: "4px 0 0",
  },
  messagesPane: {
    flex: 1,
    borderRadius: 18,
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(148,163,184,0.2)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    boxSizing: "border-box",
  },
  blankMessages: {
    margin: "auto",
    color: "#94a3b8",
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
    maxWidth: "70%",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "#f8fafc",
  },
  messageMeta: {
    fontSize: "0.8rem",
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  deliveryState: {
    fontSize: "0.75rem",
    color: "#c4b5fd",
    textTransform: "lowercase",
  },
  messageBody: {
    margin: 0,
    lineHeight: 1.4,
  },
  messageActions: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.15)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  messageActionButtons: {
    display: "flex",
    gap: 8,
  },
  messageActionButton: {
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.4)",
    background: "transparent",
    color: "#e2e8f0",
    padding: "4px 12px",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  messageActionDanger: {
    borderColor: "rgba(248,113,113,0.6)",
    color: "#fecaca",
  },
  messageActionError: {
    margin: 0,
    fontSize: "0.8rem",
    color: "#fecaca",
  },
  composer: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    position: "sticky",
    bottom: 0,
    paddingTop: 12,
    background: "#0f172a",
    boxSizing: "border-box",
    zIndex: 5,
  },
  textarea: {
    flex: 1,
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.4)",
    padding: 14,
    background: "rgba(15,23,42,0.6)",
    color: "#f8fafc",
    resize: "none",
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
  secondaryButton: {
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.5)",
    background: "transparent",
    color: "#e2e8f0",
    padding: "8px 18px",
    cursor: "pointer",
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
};
