import {
  addGroupMember,
  createGroup,
  deleteDirectMessage,
  deleteGroup,
  directApi,
  fetchDirectMessages,
  fetchGroupMessages,
  listGroups,
  removeGroupMember,
  sendDirectMessage,
  sendGroupMessage,
  uploadDirectAttachment,
  uploadGroupAttachment,
  type AttachmentDescriptor,
  type ChatMessage,
  type GroupSummary,
} from "./api";

export const chatApi = {
  direct: directApi,
  createGroup,
  addGroupMember,
  removeGroupMember,
  sendGroupMessage,
  fetchGroupMessages,
  listGroups,
  uploadGroupAttachment,
  deleteGroup,
};

export {
  sendDirectMessage,
  fetchDirectMessages,
  deleteDirectMessage,
  uploadDirectAttachment,
  createGroup,
  addGroupMember,
  removeGroupMember,
  sendGroupMessage,
  fetchGroupMessages,
  listGroups,
  uploadGroupAttachment,
  deleteGroup,
};

export type { AttachmentDescriptor, ChatMessage, GroupSummary };
