import type { NextApiRequest, NextApiResponse } from "next";
import { sendGroupMessage } from "../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const body = (req.body ?? {}) as Partial<{ groupId: string; from: string; message: string }>;

  if (!body.groupId || !body.from || !body.message) {
    return badRequest(res, "Fields 'groupId', 'from' and 'message' are required.");
  }

  try {
    const payload = await sendGroupMessage({
      groupId: body.groupId,
      from: body.from,
      message: body.message,
    });
    return res.status(200).json({ data: payload });
  } catch (error) {
    console.error("[chat] group/send failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
