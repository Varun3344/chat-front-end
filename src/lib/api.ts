import { createFormData, httpRequest, type RequestOptions } from "./http";

if (typeof window !== "undefined") {
  throw new Error("Chat API helpers can only be imported on the server.");
}

type ApiEnvelope<T> = {
  data: T;
  message?: string;
  success?: boolean;
};

type MaybeEnvelope<T> = ApiEnvelope<T> | T | undefined;

export interface ChatMessage {
  id: string;
  from: string;
  to?: string;
  groupId?: string;
  message: string;
  attachments?: AttachmentDescriptor[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, any>;
}

export interface GroupSummary {
  id: string;
  name: string;
  members: string[];
  createdBy?: string;
  description?: string;
}

export interface AttachmentDescriptor {
  id?: string;
  name?: string;
  url: string;
  mimeType?: string;
  size?: number;
  previewUrl?: string;
  metadata?: Record<string, any>;
}

export interface SendDirectMessageRequest {
  from: string;
  to: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface FetchDirectMessagesRequest {
  userA: string;
  userB: string;
}

export interface DirectAttachmentRequest {
  from: string;
  to: string;
  files: File | File[] | FileList;
  message?: string;
  metadata?: Record<string, any>;
}

export interface AttachmentUploadResponse {
  attachments: AttachmentDescriptor[];
  message?: ChatMessage;
}

export interface GroupAttachmentRequest {
  groupId: string;
  from: string;
  files: File | File[] | FileList;
  message?: string;
  metadata?: Record<string, any>;
}

export interface CreateGroupRequest {
  groupName: string;
  createdBy: string;
}

export interface CreateGroupResponse {
  status: string;
  message: string;
  groupId?: string;
}

export interface GroupMemberRequest {
  groupId: string;
  memberId: string;
}

export interface GroupMemberResponse {
  status: string;
  message: string;
  groupId?: string;
  memberId?: string;
}

export interface SendGroupMessageRequest {
  groupId: string;
  from: string;
  message: string;
}

export interface DeleteGroupResponse {
  status?: string;
  message?: string;
  groupId?: string;
}

export interface FetchGroupMessagesResponse extends ChatMessage {}

const KEYS = {
  directSend: process.env.CHAT_API_KEY_DIRECT,
  directFetch: process.env.CHAT_API_KEY_DIRECT_FETCH,
  directAttachment: process.env.CHAT_API_KEY_DIRECT_ATTACHMENT,
  directDelete: process.env.CHAT_API_KEY_DIRECT_DELETE,
  groupCreate: process.env.CHAT_API_KEY_GROUP_CREATE,
  groupMember: process.env.CHAT_API_KEY_GROUP_MEMBER,
  groupSend: process.env.CHAT_API_KEY_GROUP,
  groupFetch: process.env.CHAT_API_KEY_GROUP,
  groupAttachment: process.env.CHAT_API_KEY_GROUP_ATTACHMENT,
  groupDelete: process.env.CHAT_API_KEY_GROUP_DELETE,
  admin: process.env.CHAT_API_KEY_ADMIN,
} as const;

type KeyName = keyof typeof KEYS;

const is404 = (error: unknown) =>
  error instanceof Error && /\(404\)/.test(error.message ?? "");

const getKey = (key: KeyName) => {
  const value = KEYS[key];
  if (!value) {
    throw new Error(
      `Missing API key: ${key}. Please verify the corresponding CHAT_API_KEY_* env variable in .env.local.`
    );
  }
  return value;
};

const unwrap = <T>(payload: MaybeEnvelope<T>): T => {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    payload.data !== undefined
  ) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const requestData = async <T>(path: string, options: RequestOptions) => {
  const json = await httpRequest<MaybeEnvelope<T>>(path, options);
  return unwrap<T>(json);
};

const asArray = <T>(payload: any): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === "object") {
    const candidates = [
      payload.messages,
      payload.history,
      payload.items,
      payload.results,
      payload.records,
      payload.groups,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }
  return [];
};

export const directApi = {
  sendMessage: (body: SendDirectMessageRequest) =>
    requestData<ChatMessage>("/chat/direct/send", {
      method: "POST",
      body,
      apiKey: getKey("directSend"),
    }),
  fetchMessages: async ({ userA, userB }: FetchDirectMessagesRequest) => {
    const payload = {
      userA,
      userB,
      from: userA,
      to: userB,
    };
    try {
      const response = await requestData<ChatMessage[] | { messages?: ChatMessage[] }>(
        "/chat/direct/fetch",
        {
          method: "POST",
          body: payload,
          apiKey: getKey("directFetch"),
        }
      );
      return asArray<ChatMessage>(response);
    } catch (primaryError) {
      if (!is404(primaryError)) {
        throw primaryError;
      }
    }
    try {
      const fallbackResponse = await requestData<ChatMessage[]>(
        `/chat/direct/messages/${userA}/${userB}`,
        {
          method: "GET",
          apiKey: getKey("directFetch"),
        }
      );
      return asArray<ChatMessage>(fallbackResponse);
    } catch (fallbackError) {
      if (is404(fallbackError)) {
        return [];
      }
      throw fallbackError;
    }
  },
  deleteMessage: async (messageId: string) => {
    try {
      return await requestData<{ id: string }>("/chat/direct/delete", {
        method: "POST",
        body: { messageId, id: messageId },
        apiKey: getKey("directDelete"),
      });
    } catch (primaryError) {
      if (!is404(primaryError)) {
        throw primaryError;
      }
      return requestData<{ id: string }>(`/chat/direct/delete/${messageId}`, {
        method: "DELETE",
        apiKey: getKey("directDelete"),
      });
    }
  },
  uploadAttachment: (payload: DirectAttachmentRequest) =>
    requestData<AttachmentUploadResponse>("/chat/direct/attachment", {
      method: "POST",
      body: createFormData(
        {
          from: payload.from,
          to: payload.to,
          message: payload.message,
          metadata: payload.metadata,
        },
        payload.files
      ),
      apiKey: getKey("directAttachment"),
    }),
};

export const sendDirectMessage = directApi.sendMessage;
export const fetchDirectMessages = directApi.fetchMessages;
export const deleteDirectMessage = directApi.deleteMessage;
export const uploadDirectAttachment = directApi.uploadAttachment;

export const createGroup = (body: CreateGroupRequest) =>
  requestData<CreateGroupResponse>("/chat/group/create", {
    method: "POST",
    body,
    apiKey: getKey("groupCreate"),
  });

export const addGroupMember = (body: GroupMemberRequest) =>
  requestData<GroupMemberResponse>("/chat/group/member/add", {
    method: "POST",
    body,
    apiKey: getKey("groupMember"),
  });

export const removeGroupMember = (body: GroupMemberRequest) =>
  requestData<GroupMemberResponse>("/chat/group/member/remove", {
    method: "POST",
    body,
    apiKey: getKey("groupMember"),
  });

export const sendGroupMessage = (body: SendGroupMessageRequest) =>
  requestData<ChatMessage>("/chat/group/send", {
    method: "POST",
    body,
    apiKey: getKey("groupSend"),
  });

export const fetchGroupMessages = async (groupId: string) => {
  const payload = { groupId };
  const apiKey = getKey("groupFetch");
  try {
    const response = await requestData<
      FetchGroupMessagesResponse[] | { messages?: FetchGroupMessagesResponse[] }
    >("/chat/group/fetch", {
      method: "POST",
      body: payload,
      apiKey,
    });
    return asArray<FetchGroupMessagesResponse>(response);
  } catch (primaryError) {
    if (!is404(primaryError)) {
      throw primaryError;
    }
  }
  try {
    const fallbackResponse = await requestData<FetchGroupMessagesResponse[]>(
      `/chat/group/messages/${groupId}`,
      {
        method: "GET",
        apiKey,
      }
    );
    return asArray<FetchGroupMessagesResponse>(fallbackResponse);
  } catch (fallbackError) {
    if (is404(fallbackError)) {
      return [];
    }
    throw fallbackError;
  }
};

export const listGroups = async (memberId: string) => {
  const apiKey = KEYS.admin ?? getKey("groupFetch");
  const attempts: Array<() => Promise<GroupSummary[] | { groups?: GroupSummary[] }>> = [];

  const pushAttempt = (factory: () => Promise<GroupSummary[] | { groups?: GroupSummary[] }>) =>
    attempts.push(factory);

  if (memberId) {
    pushAttempt(() =>
      requestData(`/chat/group/list/${memberId}`, {
        method: "GET",
        apiKey,
      })
    );
    pushAttempt(() =>
      requestData("/chat/group/list", {
        method: "GET",
        apiKey,
        query: { memberId },
      })
    );
    pushAttempt(() =>
      requestData("/chat/group/list", {
        method: "GET",
        apiKey,
        query: { member: memberId },
      })
    );
    pushAttempt(() =>
      requestData("/chat/group/list", {
        method: "POST",
        apiKey,
        body: { memberId },
      })
    );
    pushAttempt(() =>
      requestData("/chat/group/list", {
        method: "POST",
        apiKey,
        body: { member: memberId },
      })
    );
  }

  pushAttempt(() =>
    requestData("/chat/group/list", {
      method: "GET",
      apiKey,
    })
  );

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      const groups = asArray<GroupSummary>(response);
      if (groups.length > 0) {
        return groups;
      }
    } catch (error) {
      lastError = error;
      if (!is404(error)) {
        continue;
      }
    }
  }

  if (lastError && !is404(lastError)) {
    throw lastError;
  }
  return [];
};

export const uploadGroupAttachment = (payload: GroupAttachmentRequest) =>
  requestData<AttachmentUploadResponse>("/chat/group/attachment", {
    method: "POST",
    body: createFormData(
      {
        groupId: payload.groupId,
        from: payload.from,
        message: payload.message,
        metadata: payload.metadata,
      },
      payload.files
    ),
    apiKey: getKey("groupAttachment"),
  });

export const deleteGroup = async (groupId: string) => {
  try {
    return await requestData<DeleteGroupResponse>("/chat/group/delete", {
      method: "POST",
      body: { groupId },
      apiKey: getKey("groupDelete"),
    });
  } catch (primaryError) {
    if (is404(primaryError)) {
      return requestData<DeleteGroupResponse>(`/chat/group/delete/${groupId}`, {
        method: "DELETE",
        apiKey: getKey("groupDelete"),
      });
    }
    throw primaryError;
  }
};
