import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../server/src/db/connectDb";
import WebhookDeadLetter from "../../server/src/models/WebhookDeadLetter";
import { withObservability } from "../../src/lib/observability/apiObservability";
import { replayDeadLetter } from "../../server/src/services/webhookDispatcher";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDb();

  if (req.method === "GET") {
    try {
      const filter = req.query.filter === "all" ? {} : { resolved: false };
      
      const deadLetters = await WebhookDeadLetter.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      res.status(200).json({ deadLetters });
    } catch (error) {
      console.error("Failed to fetch dead letters:", error);
      res.status(500).json({ error: "Failed to fetch dead letters" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default withObservability(handler, "webhooks-dead-letters");
