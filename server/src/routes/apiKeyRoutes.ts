import express from "express";
import {
  CreateApiKey,
  ListApiKeys,
  RevokeApiKey,
  RotateApiKey,
  UpdateApiKeyScopes,
} from "../controllers/apiKeyController";

/**
 * API key management routes (#287).
 *
 * Mount behind wallet-challenge auth in server.ts, e.g.:
 *   app.use("/api-keys", apiKeyRouter);
 */
export const apiKeyRouter = express.Router();

apiKeyRouter.route("/").get(ListApiKeys).post(CreateApiKey);
apiKeyRouter.route("/:id/rotate").post(RotateApiKey);
apiKeyRouter.route("/:id/scopes").patch(UpdateApiKeyScopes);
apiKeyRouter.route("/:id").delete(RevokeApiKey);
