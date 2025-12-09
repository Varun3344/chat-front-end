import { useRouter } from "next/router";
import { USERS } from "../data/dummyData";

const getInitials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default function Home() {
  const router = useRouter();

  const handleSelect = (userId) => {
    router.push({
      pathname: "/chat",
      query: { user: userId },
    });
  };

  return (
    <main style={styles.wrapper}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Multi-account preview</p>
        <h1 style={styles.title}>Choose a teammate to jump into chat.</h1>
        <p style={styles.subtitle}>
          Tap any of the four accounts below to simulate logging in. Inside the chat you
          can message the remaining teammates just like WhatsApp or Microsoft Teams.
        </p>
      </section>

      <section style={styles.grid}>
        {USERS.map((user) => (
          <button
            key={user.id}
            onClick={() => handleSelect(user.id)}
            style={styles.card}
            type="button"
          >
            <div style={{ ...styles.avatar, background: user.accent }}>
              {getInitials(user.name)}
            </div>
            <div>
              <p style={styles.cardLabel}>Log in as</p>
              <h3 style={styles.cardName}>{user.name}</h3>
              <p style={styles.cardRole}>{user.role}</p>
              <span style={styles.cardStatus}>{user.status}</span>
            </div>
          </button>
        ))}
      </section>
    </main>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    padding: "72px 24px",
    maxWidth: 960,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 40,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    textAlign: "left",
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 12,
    color: "#64748b",
    margin: 0,
  },
  title: {
    margin: 0,
    fontSize: "2.75rem",
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    maxWidth: 640,
    color: "#475569",
    fontSize: "1.1rem",
    lineHeight: 1.6,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
  },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: 20,
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "left",
    cursor: "pointer",
    transition: "transform 160ms ease, border 160ms ease",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    color: "#fff",
    fontSize: "1.1rem",
  },
  cardLabel: {
    margin: 0,
    fontSize: "0.9rem",
    color: "#94a3b8",
  },
  cardName: {
    margin: "2px 0",
  },
  cardRole: {
    margin: 0,
    color: "#475569",
  },
  cardStatus: {
    display: "inline-block",
    marginTop: 8,
    fontSize: "0.9rem",
    color: "#0f172a",
  },
};
