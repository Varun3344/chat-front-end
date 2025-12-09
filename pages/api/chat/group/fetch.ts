import type { NextApiRequest, NextApiResponse } from "next";
import { fetchGroupMessages } from "../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const body = (req.body ?? {}) as Partial<{ groupId: string }>;

  if (!body.groupId) {
    return badRequest(res, "Field 'groupId' is required.");
  }

  try {
    const messages = await fetchGroupMessages(body.groupId);
    return res.status(200).json({ data: messages });
  } catch (error) {
    console.error("[chat] group/fetch failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
