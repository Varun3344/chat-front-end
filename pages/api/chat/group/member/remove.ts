import type { NextApiRequest, NextApiResponse } from "next";
import { removeGroupMember } from "../../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const { groupId, memberId } = (req.body ?? {}) as Partial<{
    groupId: string;
    memberId: string;
  }>;

  if (!groupId || !memberId) {
    return badRequest(res, "Fields 'groupId' and 'memberId' are required.");
  }

  try {
    const response = await removeGroupMember({
      groupId,
      memberId,
    });
    return res.status(200).json({ data: response });
  } catch (error) {
    console.error("[chat] group/member/remove failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
