import type { NextApiRequest, NextApiResponse } from "next";
import { sendDirectMessage, type SendDirectMessageRequest } from "../../../../src/lib/api";

const ALLOWED_METHOD = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!ALLOWED_METHOD.includes(req.method ?? "")) {
    res.setHeader("Allow", ALLOWED_METHOD);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const body = (req.body ?? {}) as Partial<SendDirectMessageRequest>;
  if (!body.from || !body.to || !body.message) {
    return badRequest(res, "Fields 'from', 'to' and 'message' are required.");
  }

  try {
    const payload = await sendDirectMessage({
      from: body.from,
      to: body.to,
      message: body.message,
      metadata: body.metadata,
    });
    return res.status(200).json({ data: payload });
  } catch (error) {
    console.error("[chat] direct/send failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
