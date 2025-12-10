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
  leaveDirectRoom,
  listenForDirectMessages,
  listenForGroupMessages,
  listenForDirectTyping,
  listenForGroupTyping,
  listenForPresenceSnapshots,
  listenForPresenceUpdates,
  listenForUnreadCounts,
  listenForGroupActivity,
  listenForDirectAttachments,
  listenForGroupAttachments,
  focusGroupRoom,
  blurGroupRoom,
  registerUser,
  sendDirectTyping as emitDirectTyping,
  sendGroupTyping as emitGroupTyping,
} from "../utils/socket";

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
    createdBy: "ravi",
  },
  {
    id: "all-hands",
    name: "Company All Hands",
    description: "Everyone gets this broadcast - tie it to announcements.",
    members: everyone,
    createdBy: "ravi",
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

const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
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
  const inferredAttachments =
    Array.isArray(payload.attachments) && payload.attachments.length > 0
      ? payload.attachments
      : payload.type === "attachment"
      ? [
          {
            name: payload.fileName ?? overrides.fileName,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            size: payload.size,
          },
        ]
      : overrides.attachments ?? [];
  const resolvedMessage =
    payload.message ??
    overrides.message ??
    (payload.type === "attachment" && payload.fileName
      ? `Shared ${payload.fileName}`
      : "");

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
    message: resolvedMessage,
    timestamp,
    optimistic: overrides.optimistic ?? false,
    status:
      overrides.status ??
      payload.status ??
      (overrides.optimistic ? "sending" : "sent"),
    type: payload.type ?? overrides.type ?? "message",
    attachments: inferredAttachments,
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
  const [isMemberManagerOpen, setIsMemberManagerOpen] = useState(false);
  const [presenceMap, setPresenceMap] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({ direct: {}, group: {} });
  const [remoteTyping, setRemoteTyping] = useState({ direct: {}, group: {} });

  const socketRef = useRef(socket);
  const messageActionTimerRef = useRef(null);
  const remoteTypingTimersRef = useRef({
    direct: new Map(),
    group: new Map(),
  });
  const localTypingRef = useRef({ direct: false, group: false });
  const localTypingTimerRef = useRef(null);
  const previousDirectPeerRef = useRef(null);

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
        createdBy:
          group.createdBy ??
          group.ownerId ??
          group.created_by ??
          (Array.isArray(group.members) ? group.members[0] : undefined) ??
          null,
      }));
  }, [currentUserId, remoteGroups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const isGroupAdmin = useMemo(() => {
    if (!currentUserId || !activeGroup) return false;
    return (activeGroup.createdBy ?? activeGroup.ownerId ?? null) === currentUserId;
  }, [activeGroup, currentUserId]);

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
    setIsMemberManagerOpen(false);
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
    if (!isGroupAdmin) {
      setMemberActionError("Only the group admin can add members.");
      return;
    }
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
    if (!isGroupAdmin) {
      setRemoveMemberError("Only the group admin can remove members.");
      return;
    }
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
    if (!isSocketReady) return;

    const handleSnapshot = (payload) => {
      if (!Array.isArray(payload)) return;
      const mapped = payload.reduce((acc, entry) => {
        if (entry?.userId) {
          acc[entry.userId] = {
            status: entry.status ?? "offline",
            lastSeen: entry.lastSeen ?? Date.now(),
          };
        }
        return acc;
      }, {});
      setPresenceMap(mapped);
    };

    const handleUpdate = (entry) => {
      if (!entry?.userId) return;
      setPresenceMap((prev) => ({
        ...prev,
        [entry.userId]: {
          ...(prev[entry.userId] || {}),
          status: entry.status ?? prev[entry.userId]?.status ?? "offline",
          lastSeen: entry.lastSeen ?? prev[entry.userId]?.lastSeen ?? Date.now(),
        },
      }));
    };

    const unsubscribeSnapshot = listenForPresenceSnapshots(handleSnapshot);
    const unsubscribeUpdate = listenForPresenceUpdates(handleUpdate);

    return () => {
      unsubscribeSnapshot();
      unsubscribeUpdate();
    };
  }, [isSocketReady]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) return;
    const unsubscribe = listenForUnreadCounts((payload) => {
      if (!payload || payload.userId !== currentUserId) {
        return;
      }
      setUnreadCounts({
        direct: payload.direct ?? {},
        group: payload.group ?? {},
      });
    });
    return () => {
      unsubscribe();
    };
  }, [isSocketReady, currentUserId]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) return;
    const unsubscribe = listenForGroupActivity((payload) => {
      if (!payload?.groupId) return;
      const memberList = Array.isArray(payload.members) ? payload.members : [];
      const isMember =
        memberList.length === 0 ||
        memberList.includes(currentUserId) ||
        payload.createdBy === currentUserId;
      if (!isMember) {
        return;
      }
      setRemoteGroups((prev) => {
        const normalized = {
          id: payload.groupId ?? payload.id,
          name: payload.name ?? payload.groupName ?? "Untitled group",
          members: memberList,
          description: payload.description ?? payload.name ?? "Group chat",
          createdBy: payload.createdBy ?? payload.ownerId ?? null,
        };
        const existingIndex = prev.findIndex(
          (group) => group.id === normalized.id
        );
        if (existingIndex === -1) {
          return [...prev, normalized];
        }
        const nextGroups = [...prev];
        nextGroups[existingIndex] = {
          ...nextGroups[existingIndex],
          ...normalized,
        };
        return nextGroups;
      });
    });
    return () => {
      unsubscribe();
    };
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
    if (!isSocketReady || !currentUserId) return;
    const unsubscribe = listenForDirectAttachments((payload) => {
      if (!payload) return;
      const peerId =
        payload.from === currentUserId ? payload.to : payload.from;
      if (!peerId || (payload.to !== currentUserId && payload.from !== currentUserId)) {
        return;
      }
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
    const unsubscribe = listenForGroupAttachments((payload) => {
      if (!payload?.groupId) return;
      const isMember = groups.some((group) => group.id === payload.groupId);
      if (!isMember) return;
      setGroupMessages((prev) => {
        const history = prev[payload.groupId] ?? [];
        return {
          ...prev,
          [payload.groupId]: [
            ...history,
            createMessageFromPayload(payload, { optimistic: false, status: "sent" }),
          ],
        };
      });
    });
    return () => {
      unsubscribe();
    };
  }, [isSocketReady, groups]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) return;

    const directUnsubscribe = listenForDirectTyping((payload) => {
      if (!payload?.from || payload.to !== currentUserId) return;
      setRemoteTyping((prev) => {
        const nextDirect = { ...prev.direct };
        if (payload.isTyping) {
          nextDirect[payload.from] = true;
        } else {
          delete nextDirect[payload.from];
        }
        return { ...prev, direct: nextDirect };
      });
      const timers = remoteTypingTimersRef.current.direct;
      const existingTimer = timers.get(payload.from);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      if (payload.isTyping) {
        const timeoutId = setTimeout(() => {
          setRemoteTyping((prev) => {
            const nextDirect = { ...prev.direct };
            delete nextDirect[payload.from];
            return { ...prev, direct: nextDirect };
          });
          timers.delete(payload.from);
        }, 4000);
        timers.set(payload.from, timeoutId);
      } else {
        timers.delete(payload.from);
      }
    });

    const groupUnsubscribe = listenForGroupTyping((payload) => {
      if (!payload?.groupId || payload.from === currentUserId) return;
      setRemoteTyping((prev) => {
        const nextGroup = { ...prev.group };
        const existing = { ...(nextGroup[payload.groupId] ?? {}) };
        if (payload.isTyping) {
          existing[payload.from] = true;
        } else {
          delete existing[payload.from];
        }
        if (Object.keys(existing).length === 0) {
          delete nextGroup[payload.groupId];
        } else {
          nextGroup[payload.groupId] = existing;
        }
        return { ...prev, group: nextGroup };
      });
      const groupTimers = remoteTypingTimersRef.current.group;
      const userTimers =
        groupTimers.get(payload.groupId) ?? new Map();
      if (!groupTimers.has(payload.groupId)) {
        groupTimers.set(payload.groupId, userTimers);
      }
      const existingTimer = userTimers.get(payload.from);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      if (payload.isTyping) {
        const timeoutId = setTimeout(() => {
          setRemoteTyping((prev) => {
            const groupState = { ...(prev.group[payload.groupId] ?? {}) };
            delete groupState[payload.from];
            return {
              ...prev,
              group: {
                ...prev.group,
                [payload.groupId]: groupState,
              },
            };
          });
          userTimers.delete(payload.from);
          if (userTimers.size === 0) {
            groupTimers.delete(payload.groupId);
          }
        }, 4000);
        userTimers.set(payload.from, timeoutId);
      } else {
        userTimers.delete(payload.from);
        if (userTimers.size === 0) {
          groupTimers.delete(payload.groupId);
        }
      }
    });

    const directTimers = remoteTypingTimersRef.current.direct;
    const groupTimers = remoteTypingTimersRef.current.group;

    return () => {
      directUnsubscribe();
      groupUnsubscribe();
      directTimers.forEach((timer) => clearTimeout(timer));
      groupTimers.forEach((map) => {
        map.forEach((timer) => clearTimeout(timer));
      });
      directTimers.clear();
      groupTimers.clear();
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
    if (!isSocketReady || !currentUserId) {
      return;
    }
    const typingRef = localTypingRef.current;
    if (activeRoster === "direct" && activeContactId) {
      joinDirectRoom(currentUserId, activeContactId);
      previousDirectPeerRef.current = activeContactId;
      return () => {
        if (currentUserId) {
          emitDirectTyping({ from: currentUserId, to: activeContactId, isTyping: false });
        }
        typingRef.direct = false;
        leaveDirectRoom(currentUserId, activeContactId);
        previousDirectPeerRef.current = null;
      };
    }
    if (previousDirectPeerRef.current) {
      leaveDirectRoom(currentUserId, previousDirectPeerRef.current);
      previousDirectPeerRef.current = null;
    }
  }, [activeRoster, activeContactId, currentUserId, isSocketReady]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId || groups.length === 0) return;
    groups.forEach((group) => {
      if (group?.id) {
        joinGroupRoom(group.id, currentUserId);
      }
    });
  }, [groups, currentUserId, isSocketReady]);

  useEffect(() => {
    if (!isSocketReady || !currentUserId) {
      return;
    }
    const typingRef = localTypingRef.current;
    if (activeRoster === "group" && activeGroupId) {
      focusGroupRoom(activeGroupId, currentUserId);
      return () => {
        if (activeGroupId) {
          emitGroupTyping({
            groupId: activeGroupId,
            from: currentUserId,
            isTyping: false,
          });
        }
        typingRef.group = false;
        blurGroupRoom(currentUserId);
      };
    }
    if (activeGroupId) {
      emitGroupTyping({
        groupId: activeGroupId,
        from: currentUserId,
        isTyping: false,
      });
    }
    typingRef.group = false;
    blurGroupRoom(currentUserId);
  }, [activeRoster, activeGroupId, currentUserId, isSocketReady]);

  useEffect(() => {
    return () => {
      if (localTypingTimerRef.current) {
        clearTimeout(localTypingTimerRef.current);
      }
    };
  }, []);

  const stopLocalTyping = (options = {}) => {
    if (localTypingTimerRef.current) {
      clearTimeout(localTypingTimerRef.current);
      localTypingTimerRef.current = null;
    }
    if (activeRoster === "direct") {
      const peerId = options.peerId || activeContactId;
      if (peerId && currentUserId) {
        emitDirectTyping({ from: currentUserId, to: peerId, isTyping: false });
      }
      localTypingRef.current.direct = false;
    } else if (activeRoster === "group") {
      const groupId = options.groupId || activeGroupId;
      if (groupId && currentUserId) {
        emitGroupTyping({ groupId, from: currentUserId, isTyping: false });
      }
      localTypingRef.current.group = false;
    }
  };

  const handleComposerChange = (event) => {
    const value = event.target.value;
    setMessageInput(value);
    if (!value.trim()) {
      stopLocalTyping();
      return;
    }
    if (activeRoster === "direct" && activeContactId && currentUserId) {
      if (!localTypingRef.current.direct) {
        emitDirectTyping({ from: currentUserId, to: activeContactId, isTyping: true });
        localTypingRef.current.direct = true;
      }
    } else if (activeRoster === "group" && activeGroupId && currentUserId) {
      if (!localTypingRef.current.group) {
        emitGroupTyping({ groupId: activeGroupId, from: currentUserId, isTyping: true });
        localTypingRef.current.group = true;
      }
    }
    if (localTypingTimerRef.current) {
      clearTimeout(localTypingTimerRef.current);
    }
    localTypingTimerRef.current = setTimeout(() => {
      stopLocalTyping();
    }, 1600);
  };

  const handleSendMessage = (event) => {
    event.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed || !currentUserId || !isSocketReady) {
      setMessageInput("");
      return;
    }
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
    stopLocalTyping();
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

  const directTypingActive =
    activeRoster === "direct" &&
    activeContactId &&
    Boolean(remoteTyping.direct[activeContactId]);

  const groupTypingNames =
    activeRoster === "group" && activeGroupId
      ? Object.keys(remoteTyping.group[activeGroupId] ?? {}).filter(
          (memberId) => memberId !== currentUserId
        )
      : [];

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
                  <div style={styles.roomHeader}>
                    <strong>{group.name}</strong>
                    {unreadCounts.group?.[group.id] > 0 && (
                      <span style={styles.unreadBadge}>
                        {unreadCounts.group[group.id]}
                      </span>
                    )}
                  </div>
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
                  <div style={styles.roomHeader}>
                    <strong>{contact.name}</strong>
                    <div style={styles.roomStatus}>
                      <span
                        style={{
                          ...styles.presenceDot,
                          background:
                            presenceMap[contact.id]?.status === "online"
                              ? "#22c55e"
                              : "#facc15",
                        }}
                        title={presenceMap[contact.id]?.status ?? "offline"}
                      />
                      <span style={styles.presenceLabel}>
                        {presenceMap[contact.id]?.status ?? "offline"}
                      </span>
                      {unreadCounts.direct?.[contact.id] > 0 && (
                        <span style={styles.unreadBadge}>
                          {unreadCounts.direct[contact.id]}
                        </span>
                      )}
                    </div>
                  </div>
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
              <div style={styles.memberListHeader}>
                <p style={styles.groupEyebrow}>
                  Members ({activeGroup.members.length})
                </p>
                {isGroupAdmin && (
                  <button
                    type="button"
                    title="Add member"
                    style={styles.memberAddToggle}
                    onClick={() =>
                      setIsMemberManagerOpen((previous) => !previous)
                    }
                  >
                    {isMemberManagerOpen ? "×" : "+"}
                  </button>
                )}
              </div>
              <div style={styles.memberChipList}>
                {activeGroup.members.map((memberId) => (
                  <div key={memberId} style={styles.memberChip}>
                    <span style={styles.memberName}>
                      <span
                        style={{
                          ...styles.presenceDot,
                          background:
                            presenceMap[memberId]?.status === "online"
                              ? "#22c55e"
                              : "#facc15",
                        }}
                      />
                      {lookupName(memberId)}
                    </span>
                    {isGroupAdmin && memberId !== currentUserId && (
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
            {isGroupAdmin && isMemberManagerOpen && (
              <form
                style={styles.memberAddForm}
                onSubmit={handleAddMemberToGroup}
              >
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
            )}
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
                  {Array.isArray(message.attachments) &&
                    message.attachments.length > 0 && (
                      <div style={styles.attachmentCard}>
                        {message.attachments.map((attachment, index) => (
                          <div key={`${attachment.name || attachment.fileName || "attachment"}-${index}`}>
                            <p style={{ margin: 0, fontWeight: 600 }}>
                              📎 {attachment.name || attachment.fileName || "Attachment"}
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "#cbd5f5" }}>
                              {attachment.mimeType || "file"} ·{" "}
                              {formatFileSize(attachment.size)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
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

        {(directTypingActive || groupTypingNames.length > 0) && (
          <div style={styles.typingIndicator}>
            {directTypingActive ? (
              <p>{`${lookupName(activeContactId)} is typing...`}</p>
            ) : (
              <p>
                {groupTypingNames.length === 1
                  ? `${lookupName(groupTypingNames[0])} is typing...`
                  : `${groupTypingNames.length} teammates are typing...`}
              </p>
            )}
          </div>
        )}

        <form style={styles.composer} onSubmit={handleSendMessage}>
          <textarea
            style={styles.textarea}
            placeholder={
              activeRoster === "group"
                ? "Message this group..."
                : "Message this teammate..."
            }
            value={messageInput}
            onChange={handleComposerChange}
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
  roomHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
  },
  roomStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  presenceDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
  },
  presenceLabel: {
    fontSize: "0.75rem",
    textTransform: "capitalize",
    color: "#cbd5f5",
  },
  unreadBadge: {
    minWidth: 20,
    padding: "2px 6px",
    borderRadius: 999,
    background: "#f97316",
    color: "#0f172a",
    fontSize: "0.75rem",
    fontWeight: 600,
    textAlign: "center",
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
  memberListHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  groupEyebrow: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
  memberAddToggle: {
    borderRadius: "50%",
    width: 28,
    height: 28,
    border: "1px solid rgba(124,58,237,0.5)",
    background: "rgba(124,58,237,0.15)",
    color: "#e2e8f0",
    cursor: "pointer",
    fontSize: "1rem",
    lineHeight: "1rem",
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
  memberName: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
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
  typingIndicator: {
    padding: "4px 12px",
    color: "#c7d2fe",
    fontSize: "0.85rem",
    minHeight: 24,
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
  attachmentCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    background: "rgba(15,23,42,0.5)",
    border: "1px solid rgba(148,163,184,0.3)",
    fontSize: "0.85rem",
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
