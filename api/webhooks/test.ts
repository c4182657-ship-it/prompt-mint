import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../server/src/db/connectDb";
import WebhookSubscription from "../../server/src/models/WebhookSubscription";
import { sendTestEvent } from "../../server/src/services/webhookDispatcher";
import { withObservability } from "../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await connectDb();

    const subscription = await WebhookSubscription.findOne();
    if (!subscription) {
      res.status(404).json({ error: "No webhook subscription found" });
      return;
    }

    const result = await sendTestEvent(subscription);
    
    res.status(200).json(result);
  } catch (error) {
    console.error("Failed to send test webhook:", error);
    res.status(500).json({ error: "Failed to send test event" });
  }
}

export default withObservability(handler, "webhooks-test");
