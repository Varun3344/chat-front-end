/* eslint-disable @next/next/no-img-element */
const getInitials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const formatTime = (timestamp) => {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function UserList({
  currentUser,
  contacts,
  groups,
  activeRoster,
  activeContactId,
  activeGroupId,
  isGroupsLoading = false,
  onRosterChange,
  onSelectContact,
  onSelectGroup,
  searchTerm,
  onSearch,
  onCreateGroup,
}) {
  const isGroupView = activeRoster === "group";
  const listItems = isGroupView ? groups : contacts;

  return (
    <aside style={styles.sidebar}>
      <header style={styles.header}>
        <div style={styles.profileGroup}>
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            style={styles.profilePhoto}
          />
          <div>
            <p style={styles.profileLabel}>JWT User</p>
            <h3 style={styles.profileName}>{currentUser.name}</h3>
          </div>
        </div>
        <button type="button" style={styles.dropdownButton}>
          ?
        </button>
      </header>

      <div style={styles.controls}>
        <div style={styles.rosterToggle}>
          {["direct", "group"].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onRosterChange(mode)}
              style={{
                ...styles.rosterButton,
                ...(activeRoster === mode ? styles.rosterButtonActive : {}),
              }}
            >
              {mode === "direct" ? "Direct" : "Groups"}
            </button>
          ))}
        </div>
        {isGroupView && onCreateGroup && (
          <button type="button" style={styles.groupButton} onClick={onCreateGroup}>
            + Create Group
          </button>
        )}
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>?</span>
          <input
            type="text"
            placeholder={isGroupView ? "Search groups" : "Search chats"}
            value={searchTerm}
            onChange={(event) => onSearch(event.target.value)}
            style={styles.searchInput}
          />
        </div>
      </div>

      <p style={styles.sectionHeading}>
        {isGroupView ? "Group channels" : "Chats"}
      </p>

      {isGroupView && isGroupsLoading ? (
        <p style={styles.emptyState}>Syncing the latest groups…</p>
      ) : listItems.length === 0 ? (
        <p style={styles.emptyState}>
          {isGroupView ? "No groups available." : "No teammates available."}
        </p>
      ) : (
        <ul style={styles.contactList}>
          {listItems.map((item) => {
            const isActive = isGroupView
              ? item.id === activeGroupId
              : item.id === activeContactId;
            const initials = getInitials(item.name);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() =>
                    isGroupView ? onSelectGroup(item.id) : onSelectContact(item.id)
                  }
                  style={{
                    ...styles.contactButton,
                    background: isActive ? "rgba(128,90,213,0.35)" : "#1c2541",
                    borderColor: isActive
                      ? "rgba(167,139,250,0.8)"
                      : "rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={styles.contactMeta}>
                    {item.avatar ? (
                      <img
                        src={item.avatar}
                        alt={item.name}
                        style={styles.contactPhoto}
                      />
                    ) : (
                      <div
                        style={{
                          ...styles.initials,
                          background: item.accent ?? "#475569",
                        }}
                      >
                        {initials}
                      </div>
                    )}
                    <div style={styles.contactCopy}>
                      <div style={styles.contactHeader}>
                        <span style={styles.contactName}>{item.name}</span>
                        <span style={styles.contactTime}>
                          {formatTime(item.lastTimestamp)}
                        </span>
                      </div>
                      <p style={styles.contactRole}>
                        {isGroupView
                          ? `${item.members?.length ?? 0} members`
                          : item.role}
                      </p>
                      <p style={styles.contactPreview}>{item.lastMessage}</p>
                    </div>
                  </div>
                  {item.unread > 0 && !isGroupView && (
                    <span style={styles.badge}>{item.unread}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 360,
    background: "#151c32",
    color: "#f8fafc",
    padding: "28px 24px",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  profilePhoto: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    objectFit: "cover",
  },
  profileLabel: {
    margin: 0,
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
  },
  profileName: {
    margin: 0,
    fontSize: "1.1rem",
  },
  dropdownButton: {
    background: "rgba(255,255,255,0.1)",
    border: "none",
    color: "#fff",
    width: 32,
    height: 32,
    borderRadius: 8,
    cursor: "pointer",
  },
  controls: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  rosterToggle: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    background: "rgba(15,23,42,0.6)",
    borderRadius: 14,
    padding: 4,
    gap: 6,
  },
  rosterButton: {
    borderRadius: 10,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.7)",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 600,
  },
  rosterButtonActive: {
    background: "#6d28d9",
    color: "#fff",
  },
  groupButton: {
    borderRadius: 12,
    border: "1px dashed rgba(167,139,250,0.7)",
    padding: "10px 14px",
    background: "transparent",
    color: "#c084fc",
    cursor: "pointer",
    fontWeight: 600,
  },
  searchBox: {
    position: "relative",
  },
  searchIcon: {
    position: "absolute",
    left: 14,
    top: "50%",
    transform: "translateY(-50%)",
    color: "rgba(255,255,255,0.5)",
  },
  searchInput: {
    width: "100%",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#0f172a",
    color: "#f8fafc",
    padding: "10px 14px 10px 34px",
  },
  sectionHeading: {
    margin: "8px 0 0",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  emptyState: {
    color: "rgba(255,255,255,0.6)",
    margin: 0,
    padding: "8px 0",
  },
  contactList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    flex: 1,
  },
  contactButton: {
    width: "100%",
    borderRadius: 18,
    padding: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#1c2541",
    color: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    cursor: "pointer",
  },
  contactMeta: {
    display: "flex",
    gap: 12,
    textAlign: "left",
    flex: 1,
  },
  contactPhoto: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    objectFit: "cover",
  },
  initials: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 600,
  },
  contactCopy: {
    flex: 1,
  },
  contactHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  contactName: {
    fontWeight: 600,
  },
  contactTime: {
    fontSize: "0.8rem",
    color: "rgba(255,255,255,0.6)",
  },
  contactRole: {
    margin: "2px 0",
    color: "rgba(255,255,255,0.6)",
    fontSize: "0.9rem",
  },
  contactPreview: {
    margin: 0,
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.85rem",
  },
  badge: {
    minWidth: 28,
    height: 28,
    borderRadius: "50%",
    background: "#a855f7",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "0.85rem",
  },
};
