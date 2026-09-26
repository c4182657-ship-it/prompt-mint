import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RotationStep {
  step: number;
  title: string;
  description: string;
  completed: boolean;
}

export default function WebhookSecretRotation() {
  const [currentSecret, setCurrentSecret] = useState<string>("");
  const [newSecret, setNewSecret] = useState<string>("");
  const [rotationInProgress, setRotationInProgress] = useState(false);
  const [steps, setSteps] = useState<RotationStep[]>([
    {
      step: 1,
      title: "Generate New Secret",
      description: "Create a new webhook signing secret",
      completed: false,
    },
    {
      step: 2,
      title: "Update Your Webhook Consumer",
      description: "Configure your endpoint to accept both old and new secrets",
      completed: false,
    },
    {
      step: 3,
      title: "Activate New Secret",
      description: "Switch to the new secret for all future deliveries",
      completed: false,
    },
    {
      step: 4,
      title: "Verify Deliveries",
      description: "Confirm webhooks are being received with the new secret",
      completed: false,
    },
  ]);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);

  useEffect(() => {
    fetchCurrentSecret();
  }, []);

  const fetchCurrentSecret = async () => {
    try {
      const response = await fetch("/api/webhooks/secret");
      if (response.ok) {
        const data = await response.json();
        setCurrentSecret(data.secret ? "•".repeat(32) : "");
      }
    } catch (error) {
      console.error("Failed to fetch webhook secret:", error);
    }
  };

  const generateNewSecret = async () => {
    try {
      const response = await fetch("/api/webhooks/secret/generate", {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        setNewSecret(data.secret);
        setSteps((prev) =>
          prev.map((s) => (s.step === 1 ? { ...s, completed: true } : s))
        );
      }
    } catch (error) {
      console.error("Failed to generate new secret:", error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setShowCopyConfirm(true);
    setTimeout(() => setShowCopyConfirm(false), 2000);
  };

  const confirmConsumerUpdated = () => {
    setSteps((prev) =>
      prev.map((s) => (s.step === 2 ? { ...s, completed: true } : s))
    );
  };

  const activateNewSecret = async () => {
    setRotationInProgress(true);
    try {
      const response = await fetch("/api/webhooks/secret/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: newSecret }),
      });
      if (response.ok) {
        setSteps((prev) =>
          prev.map((s) => (s.step === 3 ? { ...s, completed: true } : s))
        );
        setCurrentSecret("•".repeat(32));
      }
    } catch (error) {
      console.error("Failed to activate new secret:", error);
    } finally {
      setRotationInProgress(false);
    }
  };

  const verifyDeliveries = async () => {
    try {
      const response = await fetch("/api/webhooks/test", {
        method: "POST",
      });
      if (response.ok) {
        setSteps((prev) =>
          prev.map((s) => (s.step === 4 ? { ...s, completed: true } : s))
        );
        alert("Test webhook sent successfully. Check your endpoint.");
      }
    } catch (error) {
      console.error("Failed to send test webhook:", error);
      alert("Failed to send test webhook. Please try again.");
    }
  };

  const resetWizard = () => {
    setNewSecret("");
    setSteps((prev) => prev.map((s) => ({ ...s, completed: false })));
  };

  const allStepsCompleted = steps.every((s) => s.completed);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Secret Rotation Wizard</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Safely rotate your webhook signing secret with zero downtime
        </p>
      </div>

      <Alert>
        <AlertDescription>
          This wizard guides you through a zero-downtime secret rotation. Your webhook
          consumer must support dual-secret validation during the transition period.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Current Secret</CardTitle>
          <CardDescription>Your active webhook signing secret</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-sm p-3 bg-muted rounded">
            {currentSecret || "No secret configured"}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {steps.map((step) => (
          <Card
            key={step.step}
            className={step.completed ? "border-green-500 bg-green-50" : ""}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      step.completed
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step.completed ? "✓" : step.step}
                  </div>
                  <div>
                    <CardTitle className="text-base">{step.title}</CardTitle>
                    <CardDescription>{step.description}</CardDescription>
                  </div>
                </div>
                {!step.completed && (
                  <div>
                    {step.step === 1 && (
                      <Button onClick={generateNewSecret} disabled={!!newSecret}>
                        Generate
                      </Button>
                    )}
                    {step.step === 2 && newSecret && (
                      <Button onClick={confirmConsumerUpdated}>
                        I've Updated My Consumer
                      </Button>
                    )}
                    {step.step === 3 && steps[1].completed && (
                      <Button
                        onClick={activateNewSecret}
                        disabled={rotationInProgress}
                      >
                        {rotationInProgress ? "Activating..." : "Activate"}
                      </Button>
                    )}
                    {step.step === 4 && steps[2].completed && (
                      <Button onClick={verifyDeliveries}>Send Test Event</Button>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            {step.step === 1 && newSecret && (
              <CardContent>
                <div className="space-y-2">
                  <label className="text-sm font-medium">New Secret</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSecret}
                      readOnly
                      className="flex-1 font-mono text-sm p-2 border rounded"
                    />
                    <Button
                      onClick={() => copyToClipboard(newSecret)}
                      variant="outline"
                    >
                      {showCopyConfirm ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Save this secret securely. It will only be shown once.
                  </p>
                </div>
              </CardContent>
            )}
            {step.step === 2 && newSecret && !steps[1].completed && (
              <CardContent>
                <Alert>
                  <AlertDescription>
                    Update your webhook consumer to verify signatures using both the
                    old and new secrets. Once deployed confirm below to proceed.
                  </AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {allStepsCompleted && (
        <Card className="border-green-500 bg-green-50">
          <CardContent className="p-6 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <h3 className="text-lg font-semibold mb-2">Rotation Complete!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your webhook secret has been successfully rotated. You can now remove
              the old secret from your consumer configuration.
            </p>
            <Button onClick={resetWizard} variant="outline">
              Start New Rotation
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
