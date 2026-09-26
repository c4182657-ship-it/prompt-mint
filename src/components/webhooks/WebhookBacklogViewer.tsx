import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DeadLetter {
  _id: string;
  subscriptionId: string;
  event: string;
  payload: any;
  attempts: number;
  lastError: string | null;
  lastStatusCode: number | null;
  resolved: boolean;
  createdAt: string;
}

export default function WebhookBacklogViewer() {
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unresolved">("unresolved");

  useEffect(() => {
    fetchDeadLetters();
  }, [filter]);

  const fetchDeadLetters = async () => {
    try {
      const response = await fetch(`/api/webhooks/dead-letters?filter=${filter}`);
      if (response.ok) {
        const data = await response.json();
        setDeadLetters(data.deadLetters || []);
      }
    } catch (error) {
      console.error("Failed to fetch dead letters:", error);
    } finally {
      setLoading(false);
    }
  };

  const retryDeadLetter = async (id: string) => {
    setRetrying(id);
    try {
      const response = await fetch(`/api/webhooks/dead-letters/${id}/retry`, {
        method: "POST",
      });
      if (response.ok) {
        await fetchDeadLetters();
      }
    } catch (error) {
      console.error("Failed to retry dead letter:", error);
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Event Backlog & Retry Queue</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Failed webhook deliveries that can be retried
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | "unresolved")}
          className="px-3 py-2 border rounded-md"
        >
          <option value="unresolved">Unresolved Only</option>
          <option value="all">All Events</option>
        </select>
      </div>

      {deadLetters.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-xl font-semibold mb-2">No Failed Deliveries</h3>
            <p className="text-muted-foreground">
              All webhook events have been successfully delivered
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deadLetters.map((letter) => (
            <Card key={letter._id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{letter.event}</CardTitle>
                      {letter.resolved ? (
                        <Badge variant="secondary">Resolved</Badge>
                      ) : (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                    </div>
                    <CardDescription className="mt-1">
                      Failed {letter.attempts} time{letter.attempts !== 1 ? "s" : ""} •{" "}
                      {new Date(letter.createdAt).toLocaleString()}
                    </CardDescription>
                  </div>
                  {!letter.resolved && (
                    <Button
                      onClick={() => retryDeadLetter(letter._id)}
                      disabled={retrying === letter._id}
                      size="sm"
                    >
                      {retrying === letter._id ? "Retrying..." : "Retry"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {letter.lastError && (
                    <div>
                      <h4 className="text-sm font-medium mb-1">Last Error</h4>
                      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                        {letter.lastError}
                      </pre>
                      {letter.lastStatusCode && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Status Code: {letter.lastStatusCode}
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <h4 className="text-sm font-medium mb-1">Event Payload</h4>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-48">
                      {JSON.stringify(letter.payload, null, 2)}
                    </pre>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Subscription ID: {letter.subscriptionId}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
