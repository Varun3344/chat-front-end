import type { NextApiRequest, NextApiResponse } from "next";
import { createGroup } from "../../../../src/lib/api";

const allowedMethods = ["POST"];

const badRequest = (res: NextApiResponse, message: string, status = 400) => {
  res.status(status).json({ message });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!allowedMethods.includes(req.method ?? "")) {
    res.setHeader("Allow", allowedMethods);
    return badRequest(res, `Method ${req.method} not allowed.`, 405);
  }

  const { groupName, createdBy } = (req.body ?? {}) as Partial<{
    groupName: string;
    createdBy: string;
  }>;

  if (!groupName || !createdBy) {
    return badRequest(res, "Fields 'groupName' and 'createdBy' are required.");
  }

  try {
    const result = await createGroup({
      groupName,
      createdBy,
    });
    return res.status(200).json({ data: result });
  } catch (error) {
    console.error("[chat] group/create failure", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return badRequest(res, detail, 502);
  }
}
