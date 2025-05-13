import {
  ModifyPositionTxType,
  OpenTradeTxArgs,
  UpdateLeverageTxArgs,
  UpdatePositionSizeTxArgs,
  UpdateSlTxArgs,
  UpdateTpTxArgs,
  CloseTradeMarketTxArgs,
  UpdateOpenOrderTxArgs,
  updateMaxClosingSlippagePTxArgs,
  BuildTransactionOutput,
  MulticallTxArgs,
  DelegatedTradingActionTxArgs,
} from "../types/tx";
import { GNSDiamond } from "../types/contracts";

export async function buildUpdatePositionSizeTx(
  gnsDiamond: GNSDiamond,
  args: UpdatePositionSizeTxArgs
): Promise<BuildTransactionOutput> {
  const { index, collateralDelta } = args;
  const leveragedDelta = Math.floor(args.leverageDelta * 1e3);
  const expectedPrice = BigInt(Math.floor(args.expectedPrice * 1e10));
  const maxSlippageP = BigInt(Math.floor(args.maxSlippageP * 1e3));
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  if (args.type === ModifyPositionTxType.INCREASE_POSITION_SIZE) {
    const data = gnsDiamond.interface.encodeFunctionData("increasePositionSize", [
      index,
      collateralDelta,
      leveragedDelta,
      expectedPrice,
      maxSlippageP,
    ]);

    return { data, to: gnsDiamondAddress };
  }

  if (args.updateMaxClosingSlippageP) {
    const data = gnsDiamond.interface.encodeFunctionData("multicall", [
      [
        gnsDiamond.interface.encodeFunctionData("updateMaxClosingSlippageP", [index, maxSlippageP]),
        gnsDiamond.interface.encodeFunctionData("decreasePositionSize", [
          index,
          collateralDelta,
          leveragedDelta,
          expectedPrice,
        ]),
      ],
    ]);
    return { data, to: gnsDiamondAddress };
  }

  const data = gnsDiamond.interface.encodeFunctionData("decreasePositionSize", [
    index,
    collateralDelta,
    leveragedDelta,
    expectedPrice,
  ]);
  return { data, to: gnsDiamondAddress };
}

export async function buildUpdateSlTx(gnsDiamond: GNSDiamond, args: UpdateSlTxArgs): Promise<BuildTransactionOutput> {
  const { index } = args;
  const stopLossPrice = BigInt(Math.floor(args.stopLossPrice * 1e10));
  const maxSlippageP = args.maxSlippageP !== undefined ? BigInt(Math.floor(args.maxSlippageP * 1e3)) : undefined;
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  if (maxSlippageP !== undefined) {
    const data = gnsDiamond.interface.encodeFunctionData("multicall", [
      [
        gnsDiamond.interface.encodeFunctionData("updateMaxClosingSlippageP", [index, maxSlippageP]),
        gnsDiamond.interface.encodeFunctionData("updateSl", [index, stopLossPrice]),
      ],
    ]);
    return { data, to: gnsDiamondAddress };
  }

  const data = gnsDiamond.interface.encodeFunctionData("updateSl", [index, stopLossPrice]);
  return { data, to: gnsDiamondAddress };
}

export async function buildUpdateTpTx(gnsDiamond: GNSDiamond, args: UpdateTpTxArgs): Promise<BuildTransactionOutput> {
  const { index } = args;
  const takeProfitPrice = BigInt(Math.floor(args.takeProfitPrice * 1e10));
  const maxSlippageP = args.maxSlippageP !== undefined ? BigInt(Math.floor(args.maxSlippageP * 1e3)) : undefined;
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  if (maxSlippageP !== undefined) {
    const data = gnsDiamond.interface.encodeFunctionData("multicall", [
      [
        gnsDiamond.interface.encodeFunctionData("updateMaxClosingSlippageP", [index, maxSlippageP]),
        gnsDiamond.interface.encodeFunctionData("updateTp", [index, takeProfitPrice]),
      ],
    ]);
    return { data, to: gnsDiamondAddress };
  }

  const data = gnsDiamond.interface.encodeFunctionData("updateTp", [index, takeProfitPrice]);
  return { data, to: gnsDiamondAddress };
}

export async function buildUpdateLeverageTx(
  gnsDiamond: GNSDiamond,
  args: UpdateLeverageTxArgs
): Promise<BuildTransactionOutput> {
  const { index } = args;
  const leverage = Math.floor(args.leverage * 1e3);
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("updateLeverage", [index, leverage]);
  return { data, to: gnsDiamondAddress };
}

export async function buildUpdateOpenOrderTx(
  gnsDiamond: GNSDiamond,
  args: UpdateOpenOrderTxArgs
): Promise<BuildTransactionOutput> {
  const { index } = args;
  const triggerPrice = BigInt(Math.floor(args.triggerPrice * 1e10));
  const takeProfitPrice = BigInt(Math.floor(args.takeProfitPrice * 1e10));
  const stopLossPrice = BigInt(Math.floor(args.stopLossPrice * 1e10));
  const maxSlippageP = BigInt(Math.floor(args.maxSlippageP * 1e3));
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("updateOpenOrder", [
    index,
    triggerPrice,
    takeProfitPrice,
    stopLossPrice,
    maxSlippageP,
  ]);
  return { data, to: gnsDiamondAddress };
}

export async function buildUpdateMaxClosingSlippagePTx(
  gnsDiamond: GNSDiamond,
  args: updateMaxClosingSlippagePTxArgs
): Promise<BuildTransactionOutput> {
  const { index } = args;
  const maxSlippageP = BigInt(Math.floor(args.maxSlippageP * 1e3));
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("updateMaxClosingSlippageP", [index, maxSlippageP]);
  return { data, to: gnsDiamondAddress };
}

export async function buildOpenTradeTx(gnsDiamond: GNSDiamond, args: OpenTradeTxArgs): Promise<BuildTransactionOutput> {
  const tradeData = {
    user: args.user,
    pairIndex: args.pairIndex,
    index: 0,
    collateralAmount: args.collateralAmount,
    openPrice: Math.round(args.openPrice * 1e10).toString(),
    long: args.long,
    leverage: Math.floor(args.leverage * 1e3),
    tp: Math.floor(args.tp * 1e10).toString(),
    sl: Math.floor(args.sl * 1e10).toString(),
    isOpen: true,
    collateralIndex: args.collateralIndex,
    tradeType: args.tradeType,
    isCounterTrade: false,
    positionSizeToken: "0",
    __placeholder: "0",
  };
  const maxSlippage = Math.floor(args.maxSlippage * 1e3);
  const gnsDiamondAddress = await gnsDiamond.getAddress();
  const ref = args.ref ?? "0x0000000000000000000000000000000000000000";

  const data = gnsDiamond.interface.encodeFunctionData("openTrade", [tradeData, maxSlippage, ref]);
  return { data, to: gnsDiamondAddress };
}

export async function buildCloseTradeMarketTx(
  gnsDiamond: GNSDiamond,
  args: CloseTradeMarketTxArgs
): Promise<BuildTransactionOutput> {
  const { index } = args;
  const expectedPrice = BigInt(Math.floor(args.expectedPrice * 1e10));
  const maxSlippageP = args.maxSlippageP !== undefined ? BigInt(Math.floor(args.maxSlippageP * 1e3)) : undefined;
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  if (maxSlippageP !== undefined) {
    const data = gnsDiamond.interface.encodeFunctionData("multicall", [
      [
        gnsDiamond.interface.encodeFunctionData("updateMaxClosingSlippageP", [index, maxSlippageP]),
        gnsDiamond.interface.encodeFunctionData("closeTradeMarket", [index, expectedPrice]),
      ],
    ]);
    return { data, to: gnsDiamondAddress };
  }

  const data = gnsDiamond.interface.encodeFunctionData("closeTradeMarket", [index, expectedPrice]);
  return { data, to: gnsDiamondAddress };
}

export async function buildCancelOpenOrderTx(gnsDiamond: GNSDiamond, index: number): Promise<BuildTransactionOutput> {
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("cancelOpenOrder", [index]);
  return { data, to: gnsDiamondAddress };
}

export async function buildCancelOrderAfterTimeoutTx(
  gnsDiamond: GNSDiamond,
  index: number
): Promise<BuildTransactionOutput> {
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("cancelOrderAfterTimeout", [index]);
  return { data, to: gnsDiamondAddress };
}

export async function buildDelegatedTradingAction(
  gnsDiamond: GNSDiamond,
  args: DelegatedTradingActionTxArgs
): Promise<BuildTransactionOutput> {
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("delegatedTradingAction", [args.trader, args.data]);
  return { data, to: gnsDiamondAddress };
}

export async function buildMulticallTx(
  gnsDiamond: GNSDiamond,
  calls: MulticallTxArgs
): Promise<BuildTransactionOutput> {
  const gnsDiamondAddress = await gnsDiamond.getAddress();

  const data = gnsDiamond.interface.encodeFunctionData("multicall", [
    calls.map((call) => (typeof call === "string" ? call : call.data)),
  ]);
  return { data, to: gnsDiamondAddress };
}
