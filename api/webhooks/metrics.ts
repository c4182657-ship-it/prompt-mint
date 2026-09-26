import { NextApiRequest, NextApiResponse } from "next";
import connectDb from "../../server/src/db/connectDb";
import WebhookDelivery from "../../server/src/models/WebhookDelivery";
import { withObservability } from "../../src/lib/observability/apiObservability";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await connectDb();

    const range = req.query.range || "24h";
    const now = new Date();
    let startDate = new Date();

    switch (range) {
      case "24h":
        startDate.setHours(now.getHours() - 24);
        break;
      case "7d":
        startDate.setDate(now.getDate() - 7);
        break;
      case "30d":
        startDate.setDate(now.getDate() - 30);
        break;
      default:
        startDate.setHours(now.getHours() - 24);
    }

    const deliveries = await WebhookDelivery.find({
      createdAt: { $gte: startDate },
    }).lean();

    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter((d) => d.success).length;
    const failedDeliveries = totalDeliveries - successfulDeliveries;
    const successRate = totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 0;

    const successfulWithLatency = deliveries.filter((d) => d.success && d.statusCode);
    const averageLatency = successfulWithLatency.length > 0 
      ? Math.round(successfulWithLatency.reduce((sum, d) => sum + (d.statusCode || 0), 0) / successfulWithLatency.length)
      : 0;

    const hourlyData = new Map<string, { successful: number; failed: number }>();
    deliveries.forEach((delivery) => {
      const hour = new Date(delivery.createdAt).toISOString().slice(0, 13);
      const existing = hourlyData.get(hour) || { successful: 0, failed: 0 };
      if (delivery.success) {
        existing.successful++;
      } else {
        existing.failed++;
      }
      hourlyData.set(hour, existing);
    });

    const last24Hours = Array.from(hourlyData.entries())
      .map(([hour, data]) => ({
        hour: new Date(hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        successful: data.successful,
        failed: data.failed,
        averageLatency: averageLatency,
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    const eventStats = new Map<string, { total: number; successful: number; failed: number }>();
    deliveries.forEach((delivery) => {
      const existing = eventStats.get(delivery.event) || { total: 0, successful: 0, failed: 0 };
      existing.total++;
      if (delivery.success) {
        existing.successful++;
      } else {
        existing.failed++;
      }
      eventStats.set(delivery.event, existing);
    });

    const byEvent = Array.from(eventStats.entries()).map(([event, stats]) => ({
      event,
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
    }));

    const metrics = {
      successRate,
      averageLatency,
      totalDeliveries,
      failedDeliveries,
      last24Hours,
      byEvent,
    };

    res.status(200).json(metrics);
  } catch (error) {
    console.error("Failed to fetch webhook metrics:", error);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
}

export default withObservability(handler, "webhooks-metrics");
