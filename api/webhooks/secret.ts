import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../server/src/db/connectDb";
import WebhookSubscription from "../../server/src/models/WebhookSubscription";
import { withObservability } from "../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await connectDb();

    const subscription = await WebhookSubscription.findOne().select("secret");
    
    res.status(200).json({ 
      secret: subscription?.secret ? true : false 
    });
  } catch (error) {
    console.error("Failed to fetch webhook secret status:", error);
    res.status(500).json({ error: "Failed to fetch secret status" });
  }
}

export default withObservability(handler, "webhooks-secret");
