import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface EventType {
  name: string;
  description: string;
  examplePayload: any;
}

const AVAILABLE_EVENTS: EventType[] = [
  {
    name: "PromptPurchased",
    description: "Triggered when a user purchases a prompt",
    examplePayload: {
      promptId: "prompt_abc123",
      buyerWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      price: "100.00",
      currency: "USDC",
      timestamp: "2024-03-15T10:30:00Z"
    }
  },
  {
    name: "PromptListed",
    description: "Triggered when a creator lists a new prompt for sale",
    examplePayload: {
      promptId: "prompt_xyz789",
      creatorWallet: "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
      title: "Advanced AI Prompt",
      price: "50.00",
      currency: "USDC",
      timestamp: "2024-03-15T09:15:00Z"
    }
  },
  {
    name: "PromptUpdated",
    description: "Triggered when prompt metadata is updated",
    examplePayload: {
      promptId: "prompt_def456",
      creatorWallet: "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
      changes: ["title", "description", "price"],
      timestamp: "2024-03-15T11:45:00Z"
    }
  },
  {
    name: "ReviewSubmitted",
    description: "Triggered when a buyer submits a review",
    examplePayload: {
      promptId: "prompt_abc123",
      reviewerWallet: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      rating: 5,
      comment: "Excellent prompt",
      timestamp: "2024-03-15T12:00:00Z"
    }
  }
];

export default function WebhookTopicSelector() {
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [previewEvent, setPreviewEvent] = useState<EventType | null>(null);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    fetchCurrentSubscription();
  }, []);

  const fetchCurrentSubscription = async () => {
    try {
      const response = await fetch("/api/webhooks");
      if (response.ok) {
        const data = await response.json();
        if (data.webhook) {
          setSelectedEvents(data.webhook.events || []);
          setWebhookUrl(data.webhook.url || "");
        }
      }
    } catch (error) {
      console.error("Failed to fetch webhook subscription:", error);
    }
  };

  const toggleEvent = (eventName: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventName)
        ? prev.filter((e) => e !== eventName)
        : [...prev, eventName]
    );
  };

  const saveSubscription = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          events: selectedEvents,
        }),
      });
      if (response.ok) {
        alert("Webhook subscription updated successfully");
      }
    } catch (error) {
      console.error("Failed to save webhook subscription:", error);
      alert("Failed to update webhook subscription");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Event Topic Selector</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which events trigger webhook deliveries
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>The endpoint that will receive webhook events</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-domain.com/webhooks"
            className="w-full px-3 py-2 border rounded-md"
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Available Events</CardTitle>
            <CardDescription>
              Select the events you want to receive ({selectedEvents.length} selected)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {AVAILABLE_EVENTS.map((event) => (
              <div
                key={event.name}
                className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer"
                onClick={() => toggleEvent(event.name)}
              >
                <Checkbox
                  checked={selectedEvents.includes(event.name)}
                  onCheckedChange={() => toggleEvent(event.name)}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{event.name}</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewEvent(event);
                      }}
                    >
                      Preview
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {event.description}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payload Preview</CardTitle>
            <CardDescription>
              {previewEvent
                ? `Example payload for ${previewEvent.name}`
                : "Select an event to preview its payload"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewEvent ? (
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium mb-2">Webhook Envelope</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{JSON.stringify(
  {
    version: 1,
    schemaVersion: "2025-01-01",
    event: previewEvent.name,
    deliveryId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: new Date().toISOString(),
    data: previewEvent.examplePayload
  },
  null,
  2
)}
                  </pre>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">HTTP Headers</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`X-PromptHash-Signature: sha256=...
X-PromptHash-Delivery: 550e8400-e29b-41d4-a716-446655440000
X-PromptHash-Event: ${previewEvent.name}
X-PromptHash-Version: 1
X-PromptHash-Schema-Version: 2025-01-01
X-PromptHash-Timestamp: ${new Date().toISOString()}
Content-Type: application/json`}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Click Preview on any event to see its payload structure
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={saveSubscription}
          disabled={saving || selectedEvents.length === 0 || !webhookUrl}
          size="lg"
        >
          {saving ? "Saving..." : "Save Subscription"}
        </Button>
      </div>
    </div>
  );
}
