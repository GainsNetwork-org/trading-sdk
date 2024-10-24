import { BigNumberish } from "ethers";
import {
  Fee,
  OpenInterest,
  Pair,
  Trade,
  TradeContainer,
  TradeInfo,
  TradeInitialAccFees,
  TradingGroup,
  BorrowingFee,
  OiWindows,
  OiWindowsSettings,
  PairDepth,
  PairOi,
  CollateralConfig,
  getPairDescription,
  FeeTiers,
  TraderFeeTiers,
  LiquidationParams,
  getCurrentDay,
  PairFactor,
} from "@gainsnetwork/sdk";

import { ITradingStorage, IBorrowingFees, IPriceImpact, IFeeTiers, IPairsStorage } from "../types/contracts/GNSDiamond";

export const convertTradesAndLimitOrders = (
  allItems: {
    trade: ITradingStorage.TradeStruct;
    tradeInfo: ITradingStorage.TradeInfoStruct;
    initialAccFees: IBorrowingFees.BorrowingInitialAccFeesStruct;
    liquidationParams: IPairsStorage.GroupLiquidationParamsStruct;
  }[],
  collaterals: CollateralConfig[]
) =>
  allItems?.map((item) => {
    return convertTradeContainer(item, collaterals);
  });

export const convertTradeContainer = (
  tradeContainer: {
    trade: ITradingStorage.TradeStruct;
    tradeInfo: ITradingStorage.TradeInfoStruct;
    initialAccFees: IBorrowingFees.BorrowingInitialAccFeesStruct;
    liquidationParams: IPairsStorage.GroupLiquidationParamsStruct;
  },
  collaterals: CollateralConfig[]
): TradeContainer => ({
  trade: convertTrade(tradeContainer.trade, collaterals),
  tradeInfo: convertTradeInfo(tradeContainer.tradeInfo),
  initialAccFees:
    tradeContainer.initialAccFees === undefined
      ? {
          accPairFee: 0,
          accGroupFee: 0,
          block: 0,
        }
      : convertTradeInitialAccFees(tradeContainer.initialAccFees),
  liquidationParams:
    tradeContainer.liquidationParams === undefined
      ? {
          maxLiqSpreadP: 0,
          startLiqThresholdP: 0,
          endLiqThresholdP: 0,
          startLeverage: 0,
          endLeverage: 0,
        }
      : convertLiquidationParams(tradeContainer.liquidationParams),
});

export const convertLiquidationParams = (
  liquidationParams: IPairsStorage.GroupLiquidationParamsStruct
): LiquidationParams => {
  return {
    maxLiqSpreadP: Number(liquidationParams.maxLiqSpreadP) / 1e12,
    startLiqThresholdP: Number(liquidationParams.startLiqThresholdP) / 1e12,
    endLiqThresholdP: Number(liquidationParams.endLiqThresholdP) / 1e12,
    startLeverage: Number(liquidationParams.startLeverage) / 1e3,
    endLeverage: Number(liquidationParams.endLeverage) / 1e3,
  };
};

export const convertPairFactor = (pairFactor: IPriceImpact.PairFactorsStruct): PairFactor => ({
  cumulativeFactor: Number(pairFactor.cumulativeFactor) / 1e10,
  protectionCloseFactor: Number(pairFactor.protectionCloseFactor) / 1e10,
  protectionCloseFactorBlocks: Number(pairFactor.protectionCloseFactorBlocks),
  exemptOnOpen: pairFactor.exemptOnOpen,
  exemptAfterProtectionCloseFactor: pairFactor.exemptAfterProtectionCloseFactor,
});

export const convertTrade = (trade: ITradingStorage.TradeStruct, collaterals: CollateralConfig[]): Trade => {
  const { long, user } = trade;
  const collateralIndex = Number(trade.collateralIndex);
  return {
    user: user as string,
    index: Number(trade.index),
    pairIndex: Number(trade.pairIndex),
    leverage: Number(trade.leverage) / 1e3,
    long,
    isOpen: trade.isOpen,
    collateralIndex,
    tradeType: Number(trade.tradeType),
    collateralAmount: Number(trade.collateralAmount) / 10 ** Number(collaterals[collateralIndex - 1].decimals),
    openPrice: Number(trade.openPrice) / 1e10,
    sl: Number(trade.sl) / 1e10,
    tp: Number(trade.tp) / 1e10,
  };
};

export const convertTradeInfo = (tradeInfo: ITradingStorage.TradeInfoStruct): TradeInfo => ({
  createdBlock: Number(tradeInfo.createdBlock),
  tpLastUpdatedBlock: Number(tradeInfo.tpLastUpdatedBlock),
  slLastUpdatedBlock: Number(tradeInfo.slLastUpdatedBlock),
  maxSlippageP: Number(tradeInfo.maxSlippageP) / 1e3 || 1,
  lastOiUpdateTs: Number(tradeInfo.lastOiUpdateTs),
  collateralPriceUsd:
    tradeInfo.collateralPriceUsd && tradeInfo.collateralPriceUsd !== "0"
      ? Number(tradeInfo.collateralPriceUsd) / 1e8
      : 1,
  contractsVersion: Number(tradeInfo.contractsVersion),
  lastPosIncreaseBlock: Number(tradeInfo.lastPosIncreaseBlock),
});

export const convertTradeInitialAccFees = (
  initialAccFees: IBorrowingFees.BorrowingInitialAccFeesStruct
): TradeInitialAccFees => ({
  accPairFee: Number(initialAccFees.accPairFee || "0") / 1e10,
  accGroupFee: Number(initialAccFees.accGroupFee || "0") / 1e10,
  block: Number(initialAccFees.block || "0"),
});

export const convertTradingGroups = (groups: IPairsStorage.GroupStruct[]): TradingGroup[] =>
  groups?.map((group) => convertTradingGroup(group));

export const convertTradingGroup = (group: IPairsStorage.GroupStruct): TradingGroup => ({
  maxLeverage: Number(group.maxLeverage) / 1e3,
  minLeverage: Number(group.minLeverage) / 1e3,
  name: group.name,
});

export const convertTradingPairs = (pairs: IPairsStorage.PairStruct[]): Pair[] =>
  pairs?.filter((pair) => pair.from !== "").map((pair, index) => convertTradingPair(pair, index));

export const convertTradingPair = (pair: IPairsStorage.PairStruct, index: number): Pair => ({
  name: !pair ? "" : pair.from.split("_")[0] + "/" + pair.to,
  description: getPairDescription(index),
  from: pair.from,
  to: pair.to,
  pairIndex: index,
  feeIndex: Number(pair.feeIndex),
  groupIndex: Number(pair.groupIndex),
  spreadP: Number(pair.spreadP) / 1e12,
});

export const convertFees = (fees: IPairsStorage.FeeGroupStruct[]): Fee[] => fees?.map((fee) => convertFee(fee));

export const convertFee = (fee: IPairsStorage.FeeGroupStruct): Fee => ({
  totalPositionSizeFeeP: Number(fee.totalPositionSizeFeeP) / 1e12,
  totalLiqCollateralFeeP: Number(fee.totalLiqCollateralFeeP) / 1e12,
  oraclePositionSizeFeeP: Number(fee.oraclePositionSizeFeeP) / 1e12,
  minPositionSizeUsd: Number(fee.minPositionSizeUsd) / 1e3,
});

export const convertOpenInterests = (interests: IBorrowingFees.OpenInterestStruct[]): OpenInterest[] =>
  interests?.map((interest) => convertOpenInterest(interest));

export const convertOpenInterest = (interest: IBorrowingFees.OpenInterestStruct): OpenInterest => ({
  long: Number(interest.long) / 1e10,
  short: Number(interest.short) / 1e10,
  max: Number(interest.max) / 1e10,
});

export const convertPairDepths = (pairDepths: IPriceImpact.PairDepthStruct[]): PairDepth[] =>
  pairDepths?.map((pairDepth) => convertPairDepth(pairDepth));

export const convertPairDepth = (pairDepth: IPriceImpact.PairDepthStruct): PairDepth => ({
  onePercentDepthAboveUsd: Number(pairDepth.onePercentDepthAboveUsd),
  onePercentDepthBelowUsd: Number(pairDepth.onePercentDepthBelowUsd),
});

export const convertPairBorrowingFees = (pairParams: {
  pairs: (IBorrowingFees.BorrowingDataStruct & { oi: IBorrowingFees.OpenInterestStruct } & {
    groups: IBorrowingFees.BorrowingPairGroupStruct[];
  })[];
}): BorrowingFee.Pair[] => pairParams?.pairs.map((pairParam) => convertPairBorrowingFee(pairParam));

export const convertPairGroupBorrowingFee = (
  pairParam: IBorrowingFees.BorrowingPairGroupStruct
): BorrowingFee.PairGroup => ({
  groupIndex: Number(pairParam.groupIndex),
  initialAccFeeLong: Number(pairParam.initialAccFeeLong) / 1e10,
  initialAccFeeShort: Number(pairParam.initialAccFeeShort) / 1e10,
  pairAccFeeLong: Number(pairParam.pairAccFeeLong) / 1e10,
  pairAccFeeShort: Number(pairParam.pairAccFeeShort) / 1e10,
  prevGroupAccFeeLong: Number(pairParam.prevGroupAccFeeLong) / 1e10,
  prevGroupAccFeeShort: Number(pairParam.prevGroupAccFeeShort) / 1e10,
  block: Number(pairParam.block),
});

export const convertPairBorrowingFee = (
  pairParams: IBorrowingFees.BorrowingDataStruct & { oi: IBorrowingFees.OpenInterestStruct } & {
    groups: IBorrowingFees.BorrowingPairGroupStruct[];
  }
): BorrowingFee.Pair => ({
  groups: pairParams.groups.map((pairParam) => convertPairGroupBorrowingFee(pairParam)),
  feePerBlock: Number(pairParams.feePerBlock) / 1e10,
  accFeeLong: Number(pairParams.accFeeLong) / 1e10,
  accFeeShort: Number(pairParams.accFeeShort) / 1e10,
  accLastUpdatedBlock: Number(pairParams.accLastUpdatedBlock),
  oi: {
    max: Number(pairParams.oi.max) / 1e10 || 0,
    long: Number(pairParams.oi.long) / 1e10 || 0,
    short: Number(pairParams.oi.short) / 1e10 || 0,
  },
  feeExponent: Number(pairParams.feeExponent) || 0,
});

export const convertGroupBorrowingFees = (pairParams: {
  groups: (IBorrowingFees.BorrowingDataStruct & { oi: IBorrowingFees.OpenInterestStruct })[];
}): BorrowingFee.Group[] => pairParams?.groups.map((pairParam) => convertGroupBorrowingFee(pairParam));

export const convertGroupBorrowingFee = (
  pairParams: IBorrowingFees.BorrowingDataStruct & { oi: IBorrowingFees.OpenInterestStruct }
): BorrowingFee.Group => ({
  oi: {
    long: Number(pairParams.oi.long) / 1e10,
    short: Number(pairParams.oi.short) / 1e10,
    max: Number(pairParams.oi.max) / 1e10 || 0,
  },
  feePerBlock: Number(pairParams.feePerBlock) / 1e10,
  accFeeLong: Number(pairParams.accFeeLong) / 1e10,
  accFeeShort: Number(pairParams.accFeeShort) / 1e10,
  accLastUpdatedBlock: Number(pairParams.accLastUpdatedBlock),
  feeExponent: Number(pairParams.feeExponent) || 0,
});

export const convertPairOi = (collateral: IPriceImpact.PairOiStruct): PairOi => ({
  oiLongUsd: Number(collateral.oiLongUsd) / 1e18,
  oiShortUsd: Number(collateral.oiShortUsd) / 1e18,
});

export const convertOiWindows = (oiWindows: { [key: string]: IPriceImpact.PairOiStruct }[]): OiWindows[] => {
  return oiWindows?.map((pairWindows) =>
    Object.fromEntries(Object.entries(pairWindows).map(([key, oiWindow]) => [key, convertPairOi(oiWindow)]))
  );
};

export const convertOiWindowsSettings = (
  oiWindowsSettings: IPriceImpact.OiWindowsSettingsStruct
): OiWindowsSettings => ({
  startTs: Number(oiWindowsSettings.startTs),
  windowsDuration: Number(oiWindowsSettings.windowsDuration),
  windowsCount: Number(oiWindowsSettings.windowsCount),
});

export const convertCollateralConfig = (
  collateral: Omit<ITradingStorage.CollateralStruct, "__placeholder"> & { decimals: BigNumberish; symbol: string }
): CollateralConfig => ({
  collateral: collateral.collateral as string,
  isActive: collateral.isActive,
  precision: Number(collateral.precision),
  precisionDelta: Number(collateral.precisionDelta),
  decimals: Number(collateral.decimals),
  symbol: collateral.symbol,
});

export const convertFeeTiers = (feeTiers: {
  tiers: IFeeTiers.FeeTierStruct[];
  multipliers: BigNumberish[];
}): FeeTiers => ({
  tiers: feeTiers?.tiers.map((tier) => ({
    feeMultiplier: Number(tier.feeMultiplier) / 1e3,
    pointsThreshold: Number(tier.pointsThreshold),
  })),
  multipliers: feeTiers?.multipliers.map((mult) => Number(mult) / 1e3),
  currentDay: getCurrentDay(),
});

export const convertTraderFeeTiers = (traderFeeTiers: {
  traderEnrollment: IFeeTiers.TraderEnrollmentStruct;
  traderInfo: IFeeTiers.TraderInfoStruct;
  lastDayUpdatedPoints: IFeeTiers.TraderDailyInfoStruct;
  inboundPoints: BigNumberish;
  outboundPoints: BigNumberish;
  expiredPoints: BigNumberish[];
}): TraderFeeTiers => ({
  traderEnrollment: {
    status: Number(traderFeeTiers.traderEnrollment.status),
  },
  traderInfo: {
    lastDayUpdated: Number(traderFeeTiers.traderInfo.lastDayUpdated),
    trailingPoints: Number(traderFeeTiers.traderInfo.trailingPoints) / 1e18,
  },
  inboundPoints: Number(traderFeeTiers.inboundPoints) / 1e18,
  outboundPoints: Number(traderFeeTiers.outboundPoints) / 1e18,
  lastDayUpdatedPoints: Number(traderFeeTiers.lastDayUpdatedPoints) / 1e18,
  expiredPoints: traderFeeTiers.expiredPoints.map((point) => Number(point) / 1e18),
  unclaimedPoints: Number(traderFeeTiers.inboundPoints) / 1e18,
});
