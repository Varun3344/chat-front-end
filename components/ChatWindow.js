/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";

const formatTime = (isoString) =>
  new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function ChatWindow({
  currentUser,
  chatType = "direct",
  selectedContact,
  selectedGroup,
  messages,
  onSendMessage,
  isLoading = false,
  isSending = false,
  errorMessage = "",
  onAddMember,
  onRemoveMember,
  availableMembers = [],
  isGroupAdmin = false,
}) {
  const [draft, setDraft] = useState("");
  const [memberToAdd, setMemberToAdd] = useState("");
  const bottomRef = useRef(null);

  const target = chatType === "group" ? selectedGroup : selectedContact;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, target?.id]);

  useEffect(() => {
    setDraft("");
  }, [target?.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;
    try {
      await Promise.resolve(onSendMessage(text));
      setDraft("");
    } catch {
      // preserve draft
    }
  };

  const handleAddMember = async () => {
    if (!memberToAdd.trim() || !onAddMember) return;
    await Promise.resolve(onAddMember(memberToAdd.trim()));
    setMemberToAdd("");
  };

  const members = useMemo(() => {
    if (!selectedGroup?.members) return [];
    return selectedGroup.members;
  }, [selectedGroup?.members]);

  const addableMembers = availableMembers.filter(
    (user) =>
      user.id !== currentUser.id && !members.some((memberId) => memberId === user.id)
  );

  if (!target) {
    return (
      <section style={styles.emptyPane}>
        <h2>
          {chatType === "group" ? "Select a group" : "Select a teammate"} to open the
          thread
        </h2>
        <p>
          You are logged in as {currentUser.name}. Pick one of the teammates/groups from
          the left column to start messaging.
        </p>
      </section>
    );
  }

  return (
    <section style={styles.chatPane}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          {target.avatar ? (
            <img src={target.avatar} alt={target.name} style={styles.avatar} />
          ) : (
            <div style={{ ...styles.avatar, ...styles.initialFallback }}>
              {initials(target.name)}
            </div>
          )}
          <div>
            <h2 style={styles.headerName}>{target.name}</h2>
            <p style={styles.headerMeta}>
              {chatType === "group"
                ? `${target.members?.length ?? 0} members`
                : "Last seen 11:30 AM"}
            </p>
          </div>
        </div>
        {chatType === "group" && isGroupAdmin && (
          <div style={styles.groupActions}>
            <div style={styles.memberManager}>
              <select
                value={memberToAdd}
                onChange={(event) => setMemberToAdd(event.target.value)}
                style={styles.memberSelect}
              >
                <option value="">Add teammate…</option>
                {addableMembers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.id})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddMember}
                style={styles.memberActionButton}
                disabled={!memberToAdd}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </header>

      {chatType === "group" && (
        <section style={styles.memberList}>
          {members.length === 0 ? (
            <span style={styles.memberEmpty}>No members yet.</span>
          ) : (
            members.map((memberId) => {
              const user =
                availableMembers.find((candidate) => candidate.id === memberId) ?? null;
              return (
                <span key={memberId} style={styles.memberChip}>
                  {user?.avatar ? (
                    <img src={user.avatar} alt={user.name} style={styles.memberAvatar} />
                  ) : (
                    <span style={styles.memberInitials}>
                      {initials(user?.name ?? memberId)}
                    </span>
                  )}
                  <span>{user?.name ?? memberId}</span>
                  {isGroupAdmin && onRemoveMember && memberId !== currentUser.id && (
                    <button
                      type="button"
                      style={styles.removeButton}
                      onClick={() => onRemoveMember(memberId)}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })
          )}
        </section>
      )}

      <div style={styles.messages}>
        {isLoading && (
          <div style={styles.statusBanner}>Syncing recent messages.</div>
        )}
        {errorMessage && (
          <div style={{ ...styles.statusBanner, ...styles.errorState }}>
            {errorMessage}
          </div>
        )}
        {messages.length === 0 && !isLoading && (
          <article style={{ ...styles.message, ...styles.placeholder }}>
            Start a fresh thread with {target.name}.
          </article>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            style={{
              ...styles.message,
              ...(message.groupId && message.from !== currentUser.id
                ? styles.messageInbound
                : message.from === currentUser.id
                ? styles.messageOutbound
                : styles.messageInbound),
            }}
          >
            {chatType === "group" && message.groupId && (
              <p style={styles.senderName}>
                {message.from === currentUser.id ? "You" : message.from}
              </p>
            )}
            <p style={styles.messageBody}>{message.message}</p>
            <div style={styles.messageMeta}>
              <span style={styles.timestamp}>{formatTime(message.createdAt)}</span>
              {message.from === currentUser.id && (
                <span style={styles.deliveryState}>
                  {message.optimistic ? "sending..." : message.status ?? "sent"}
                </span>
              )}
            </div>
          </article>
        ))}
        <span ref={bottomRef} />
      </div>

      <form style={styles.composer} onSubmit={handleSubmit}>
        <label htmlFor="message-box" style={styles.srOnly}>
          Message {target.name}
        </label>
        <textarea
          id="message-box"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message ${target.name}...`}
          style={styles.textarea}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!draft.trim() || isLoading || isSending}
          style={{
            ...styles.sendButton,
            opacity:
              draft.trim() && !isLoading && !isSending ? 1 : 0.5,
            cursor:
              draft.trim() && !isLoading && !isSending
                ? "pointer"
                : "not-allowed",
          }}
        >
          {isSending ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}

const styles = {
  chatPane: {
    flex: 1,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    padding: "32px 40px",
    gap: 20,
    background: "linear-gradient(120deg, #1c2238, #13182b 70%)",
  },
  emptyPane: {
    flex: 1,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 40,
    textAlign: "center",
    color: "#f8fafc",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottom: "1px solid rgba(255,255,255,0.1)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    objectFit: "cover",
    background: "#4c1d95",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 600,
  },
  initialFallback: {
    fontSize: "1.1rem",
  },
  headerName: {
    margin: 0,
  },
  headerMeta: {
    margin: 0,
    color: "rgba(255,255,255,0.6)",
  },
  groupActions: {
    display: "flex",
    gap: 12,
  },
  memberManager: {
    display: "flex",
    gap: 8,
  },
  memberSelect: {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(15,23,42,0.9)",
    color: "#fff",
    padding: "8px 12px",
  },
  memberActionButton: {
    padding: "8px 14px",
    borderRadius: 12,
    border: "none",
    background: "#7c3aed",
    color: "#fff",
    cursor: "pointer",
  },
  memberList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  memberChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.15)",
    fontSize: "0.85rem",
  },
  memberAvatar: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    objectFit: "cover",
  },
  memberInitials: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "#475569",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
  },
  removeButton: {
    border: "none",
    background: "transparent",
    color: "#fecaca",
    cursor: "pointer",
    fontSize: "1rem",
  },
  memberEmpty: {
    color: "rgba(255,255,255,0.6)",
  },
  messages: {
    flex: 1,
    borderRadius: 24,
    border: "1px solid rgba(255,255,255,0.08)",
    padding: 24,
    overflowY: "auto",
    background: "rgba(15,23,42,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  message: {
    maxWidth: 520,
    padding: 16,
    borderRadius: 18,
    alignSelf: "flex-start",
    background: "#0f172a",
    color: "#f8fafc",
  },
  messageInbound: {
    background: "#111a2f",
  },
  messageOutbound: {
    alignSelf: "flex-end",
    background: "#5b21b6",
  },
  placeholder: {
    border: "1px dashed rgba(255,255,255,0.3)",
    alignSelf: "stretch",
    textAlign: "center",
    color: "rgba(255,255,255,0.7)",
  },
  senderName: {
    margin: "0 0 6px",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.7)",
  },
  messageBody: {
    margin: 0,
    lineHeight: 1.6,
  },
  messageMeta: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginTop: 10,
    fontSize: "0.75rem",
    opacity: 0.7,
  },
  timestamp: {
    margin: 0,
  },
  deliveryState: {
    textTransform: "lowercase",
    letterSpacing: 0.3,
    color: "#c4b5fd",
  },
  composer: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  statusBanner: {
    borderRadius: 12,
    padding: "10px 14px",
    background: "rgba(148,163,184,0.15)",
    color: "#e2e8f0",
    fontSize: "0.85rem",
  },
  errorState: {
    background: "rgba(239,68,68,0.2)",
    color: "#fecaca",
  },
  textarea: {
    flex: 1,
    resize: "none",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(15,23,42,0.9)",
    color: "#fff",
    padding: 14,
  },
  sendButton: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    border: "none",
    background: "#6d28d9",
    color: "#fff",
    fontSize: "1.2rem",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    border: 0,
  },
};
