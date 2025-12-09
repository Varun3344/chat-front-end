import type { NextApiRequest, NextApiResponse } from "next";
import { fetchDirectMessages } from "../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const body = (req.body ?? {}) as Partial<{ userA: string; userB: string }>;

  if (!body.userA || !body.userB) {
    return badRequest(res, "Fields 'userA' and 'userB' are required.");
  }

  try {
    const messages = await fetchDirectMessages({
      userA: body.userA,
      userB: body.userB,
    });
    return res.status(200).json({ data: messages });
  } catch (error) {
    console.error("[chat] direct/fetch failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
