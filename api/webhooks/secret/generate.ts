import { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { withObservability } from "../../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const newSecret = randomBytes(32).toString("hex");
    
    res.status(200).json({ secret: newSecret });
  } catch (error) {
    console.error("Failed to generate webhook secret:", error);
    res.status(500).json({ error: "Failed to generate secret" });
  }
}

export default withObservability(handler, "webhooks-generate-secret");
