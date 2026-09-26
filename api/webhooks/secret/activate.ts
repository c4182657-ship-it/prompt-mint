import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../../server/src/db/connectDb";
import WebhookSubscription from "../../../server/src/models/WebhookSubscription";
import { withObservability } from "../../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await connectDb();

    const { secret } = req.body;
    if (!secret || typeof secret !== "string") {
      res.status(400).json({ error: "Valid secret is required" });
      return;
    }

    await WebhookSubscription.updateMany({}, { secret });
    
    res.status(200).json({ message: "Secret activated successfully" });
  } catch (error) {
    console.error("Failed to activate webhook secret:", error);
    res.status(500).json({ error: "Failed to activate secret" });
  }
}

export default withObservability(handler, "webhooks-activate-secret");
