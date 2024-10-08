import { ethers } from "ethers";
import { BorrowingFee, CollateralConfig, Fee, FeeTiers, Pair, Trade, TradingGroup } from "@gainsnetwork/sdk";
import { SupportedChainId } from "../config";

export type TradingSdkOptions = {
  chainId: SupportedChainId;
  signer?: ethers.Signer;
  rpcProviderUrl?: string;
};

export type State = {
  collaterals: CollateralConfig[];
  groups: TradingGroup[];
  pairs: Pair[];
  fees: Fee[];
  maxPairLeverages: number[];
  groupBorrowingFees: BorrowingFee.Group[][];
  pairBorrowingFees: BorrowingFee.Pair[][];
  maxGainP: number;
  feeTiers: FeeTiers;
};

export type PendingTransactionDetails = {
  count: number;
  latestNonce: number;
};

export type TradeAction =
  | "TradeOpenedMarket"
  | "TradeClosedMarket"
  | "TradeOpenedLimit"
  | "TradeClosedTP"
  | "TradeClosedSL"
  | "TradeClosedLIQ"
  | "TradeLeverageUpdate"
  | "TradePosSizeIncrease"
  | "TradePosSizeDecrease";

export type TradeHistoryEntry = {
  action: TradeAction;
  date: string;
  block: number;
  leverage: number;
  collateralAmount: number;
  collateralPriceUsd: number;
  tx: string;
  marketPrice: number | null;
  pnl: number;
  openPrice: number;
  leverageDelta: number | null;
  collateralDelta: number | null;
};

export type TradeWithHistory = Trade & { history: TradeHistoryEntry[] };

export * from "./contracts";
export * from "./tx";
