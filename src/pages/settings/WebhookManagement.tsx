import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WebhookPerformanceDashboard from "@/components/webhooks/WebhookPerformanceDashboard";
import WebhookBacklogViewer from "@/components/webhooks/WebhookBacklogViewer";
import WebhookTopicSelector from "@/components/webhooks/WebhookTopicSelector";
import WebhookSecretRotation from "@/components/webhooks/WebhookSecretRotation";

export default function WebhookManagement() {
  const [activeTab, setActiveTab] = useState("performance");

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Webhook Management</h1>
        <p className="text-muted-foreground mt-2">
          Monitor webhook performance configure topics and manage secrets
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="backlog">Backlog</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <WebhookPerformanceDashboard />
        </TabsContent>

        <TabsContent value="backlog" className="space-y-4">
          <WebhookBacklogViewer />
        </TabsContent>

        <TabsContent value="topics" className="space-y-4">
          <WebhookTopicSelector />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <WebhookSecretRotation />
        </TabsContent>
      </Tabs>
    </div>
  );
}
