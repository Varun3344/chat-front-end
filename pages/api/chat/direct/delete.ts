import type { NextApiRequest, NextApiResponse } from "next";
import { deleteDirectMessage } from "../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const { messageId } = (req.body ?? {}) as Partial<{ messageId: string }>;

  if (!messageId) {
    return badRequest(res, "Field 'messageId' is required.");
  }

  try {
    const response = await deleteDirectMessage(messageId);
    return res.status(200).json({ data: response ?? { id: messageId } });
  } catch (error) {
    console.error("[chat] direct/delete failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
