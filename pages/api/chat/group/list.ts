import type { NextApiRequest, NextApiResponse } from "next";
import { listGroups } from "../../../../src/lib/api";

const allowedMethods = ["GET"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const memberId = Array.isArray(req.query.memberId)
    ? req.query.memberId[0]
    : req.query.memberId || "";

  if (!memberId) {
    return badRequest(res, "Query parameter 'memberId' is required.");
  }

  try {
    const groups = await listGroups(memberId);
    return res.status(200).json({ data: groups });
  } catch (error) {
    console.error("[chat] group/list failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
