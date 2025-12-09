export const USERS = [
  {
    id: "ravi",
    name: "Ravi Narayan",
    role: "Product Strategist",
    status: "Available • London",
    accent: "#2563eb",
    avatar: "https://i.pravatar.cc/150?img=11",
    unread: 2,
  },
  {
    id: "shwetha",
    name: "Shwetha Rao",
    role: "Engineering Lead",
    status: "Heads down • SRE war room",
    accent: "#16a34a",
    avatar: "https://i.pravatar.cc/150?img=32",
    unread: 0,
  },
  {
    id: "varun",
    name: "Varun Kapoor",
    role: "Design Systems",
    status: "Focus mode • Figma",
    accent: "#ea580c",
    avatar: "https://i.pravatar.cc/150?img=25",
    unread: 5,
  },
  {
    id: "kumar",
    name: "Kumar Singh",
    role: "Customer Success",
    status: "On-call • Support queue",
    accent: "#7c3aed",
    avatar: "https://i.pravatar.cc/150?img=7",
    unread: 1,
  },
];

const minute = 1000 * 60;
const baseTime = Date.parse("2025-05-12T09:00:00Z");

const createMessage = (authorId, text, offsetMinutes) => ({
  authorId,
  text,
  timestamp: new Date(baseTime + offsetMinutes * minute).toISOString(),
});

const pairKey = (a, b) => [a, b].sort().join("_");

const CONVERSATIONS = {
  [pairKey("ravi", "shwetha")]: [
    createMessage("shwetha", "Morning Ravi! Finance unlocked the budget line.", 0),
    createMessage("ravi", "Amazing, I'll slot it into the launch board.", 6),
    createMessage("shwetha", "Ping me once the draft comms are ready.", 18),
  ],
  [pairKey("ravi", "varun")]: [
    createMessage("varun", "Need final copy for the billing screen tooltips.", 14),
    createMessage("ravi", "Give me 20 minutes, I'll post them here.", 25),
  ],
  [pairKey("ravi", "kumar")]: [
    createMessage("kumar", "CS team is seeing a spike in workspace invites.", 35),
    createMessage("ravi", "Route them our latest onboarding doc please.", 39),
  ],
  [pairKey("shwetha", "varun")]: [
    createMessage("varun", "The design token export job is failing nightly.", 41),
    createMessage("shwetha", "Thanks, SRE will triage after the deploy freeze.", 46),
  ],
  [pairKey("shwetha", "kumar")]: [
    createMessage("kumar", "Customers asking for API error samples.", 55),
    createMessage("shwetha", "I'll paste logs from the latest sandbox run.", 63),
  ],
  [pairKey("varun", "kumar")]: [
    createMessage("kumar", "Can you update the help center diagrams?", 70),
    createMessage("varun", "Yep, exporting a fresh set right now.", 77),
  ],
};

const lookupName = (userId) =>
  USERS.find((user) => user.id === userId)?.name ?? "Teammate";

export const seedThreadsFor = (currentUserId) => {
  const threads = {};

  USERS.forEach((contact) => {
    if (contact.id === currentUserId) return;

    const key = pairKey(currentUserId, contact.id);
    const transcript = CONVERSATIONS[key] ?? [];

    threads[contact.id] = transcript.map((message, index) => ({
      id: `${key}-${index + 1}`,
      senderId: message.authorId,
      senderName: lookupName(message.authorId),
      text: message.text,
      timestamp: message.timestamp,
      direction: message.authorId === currentUserId ? "outbound" : "inbound",
    }));
  });

  return threads;
};
