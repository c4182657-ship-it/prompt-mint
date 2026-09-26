import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../../../server/src/db/connectDb";
import { replayDeadLetter } from "../../../../server/src/services/webhookDispatcher";
import { withObservability } from "../../../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await connectDb();
    
    const { id } = req.query;
    if (typeof id !== "string") {
      res.status(400).json({ error: "Invalid dead letter ID" });
      return;
    }

    const result = await replayDeadLetter(id);
    
    res.status(200).json(result);
  } catch (error) {
    console.error("Failed to retry dead letter:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to retry delivery" 
    });
  }
}

export default withObservability(handler, "webhooks-retry-dead-letter");
