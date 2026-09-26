export type UnlockFlowStatus =
  | "catalog"
  | "challenge-issued"
  | "wallet-signed"
  | "purchase-submitted"
  | "claimable"
  | "expired";

export interface UnlockFlowFixture {
  promptId: string;
  promptHash: string;
  buyerAddress: string;
  creatorAddress: string;
  priceXlm: string;
  challenge: string;
  signature: string;
  transactionHash: string;
  status: UnlockFlowStatus;
  createdAt: string;
  expiresAt: string;
}

const baseFixture: UnlockFlowFixture = {
  promptId: "prompt-42",
  promptHash: "sha256:3b1b6f4d9c7a0d49f4a457d0ec2b9f2f37b42f0d8c5e2d1f2a8e0f7b9c4d6a11",
  buyerAddress: "GBUYERACCOUNT0000000000000000000000000000000000000000000",
  creatorAddress: "GCREATORACCOUNT0000000000000000000000000000000000000000",
  priceXlm: "25.0000000",
  challenge: "prompt-mint unlock:prompt-42:1700000000",
  signature: "signed-challenge-bytes",
  transactionHash: "0f4c1f8f3bb38d02e76af3d63726e93d19f08af15ad404b5f9b0d34795c7e60d",
  status: "catalog",
  createdAt: "2026-09-24T00:00:00.000Z",
  expiresAt: "2026-09-24T00:10:00.000Z",
};

const statusOverrides: Record<UnlockFlowStatus, Partial<UnlockFlowFixture>> = {
  catalog: {
    challenge: "",
    signature: "",
    transactionHash: "",
  },
  "challenge-issued": {
    status: "challenge-issued",
    signature: "",
    transactionHash: "",
  },
  "wallet-signed": {
    status: "wallet-signed",
    transactionHash: "",
  },
  "purchase-submitted": {
    status: "purchase-submitted",
  },
  claimable: {
    status: "claimable",
  },
  expired: {
    status: "expired",
    expiresAt: "2026-09-23T23:59:59.000Z",
  },
};

export function createUnlockFlowFixture(
  overrides: Partial<UnlockFlowFixture> = {},
): UnlockFlowFixture {
  const status = overrides.status ?? baseFixture.status;
  return {
    ...baseFixture,
    ...statusOverrides[status],
    ...overrides,
  };
}

export function createUnlockFlowSequence(
  shared: Partial<UnlockFlowFixture> = {},
): UnlockFlowFixture[] {
  return [
    "catalog",
    "challenge-issued",
    "wallet-signed",
    "purchase-submitted",
    "claimable",
  ].map((status) =>
    createUnlockFlowFixture({
      ...shared,
      status: status as UnlockFlowStatus,
    }),
  );
}

export const unlockFlowFixtures = {
  catalog: createUnlockFlowFixture({ status: "catalog" }),
  challengeIssued: createUnlockFlowFixture({ status: "challenge-issued" }),
  walletSigned: createUnlockFlowFixture({ status: "wallet-signed" }),
  purchaseSubmitted: createUnlockFlowFixture({ status: "purchase-submitted" }),
  claimable: createUnlockFlowFixture({ status: "claimable" }),
  expired: createUnlockFlowFixture({ status: "expired" }),
};