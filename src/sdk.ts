import { getProvider } from "./utils/getProvider";
import { GNS_DIAMOND_ADDRESSES, MULTICALL3_ADDRESS, SupportedChainId } from "./config/constants";
import { multiCall } from "./utils/multicallHelper";
import {
  getCurrentDay,
  pairs as pairsSdk,
  Trade,
  TradeContainer,
  TradeHistoryRecord,
  TraderFeeTiers,
  TradeType,
} from "@gainsnetwork/sdk";
import { GNSDiamond, GNSDiamond__factory, Multicall3__factory } from "./types/contracts";
import { BigNumberish, Contract, ethers } from "ethers";
import { State, TradeAction, TradeWithHistory, TradingSdkOptions } from "./types";
import ERC20_ABI from "./abi/ERC20.json";
import { ModifyPositionTxType, ModifyPositionTxArgs, OpenTradeTxArgs, CloseTradeMarketTxArgs } from "./types/tx";
import {
  buildCancelOpenOrderTx,
  buildCancelOrderAfterTimeoutTx,
  buildCloseTradeMarketTx,
  buildOpenTradeTx,
  buildUpdateLeverageTx,
  buildUpdateMaxClosingSlippagePTx,
  buildUpdateOpenOrderTx,
  buildUpdatePositionSizeTx,
  buildUpdateSlTx,
  buildUpdateTpTx,
} from "./libs/tx";
import {
  convertCollateralConfig,
  convertFees,
  convertFeeTiers,
  convertGroupBorrowingFee,
  convertPairBorrowingFee,
  convertTrade,
  convertTradeContainer,
  convertTraderFeeTiers,
  convertTradingGroups,
  convertTradingPairs,
} from "./utils/dataConverter";
import { IBorrowingFees, IFeeTiers, IPairsStorage, ITradingStorage } from "./types/contracts/GNSDiamond";
import { Backend } from "./services/backend";

export class TradingSDK {
  private chainId: SupportedChainId;
  private signer?: ethers.Signer;
  private runner: ethers.JsonRpcProvider | ethers.Signer;
  private gnsDiamond: GNSDiamond;
  private multicall3: Contract;
  private backend: Backend;
  private state: State = {} as State;
  public lastRefreshedTs: number = Date.now();
  public initialized: boolean = false;

  constructor({ chainId, signer, rpcProviderUrl }: TradingSdkOptions) {
    this.chainId = chainId;
    this.signer = signer;
    this.runner = this.signer ?? getProvider(chainId, rpcProviderUrl);

    this.gnsDiamond = GNSDiamond__factory.connect(GNS_DIAMOND_ADDRESSES[chainId], this.runner);
    this.multicall3 = new ethers.Contract(MULTICALL3_ADDRESS, Multicall3__factory.abi, this.runner);
    this.backend = new Backend(chainId);
  }

  public async initialize() {
    await this.refreshState();
    this.initialized = true;
  }

  public async refreshState() {
    const [collaterals, maxPairLeverages, groupsCount, feesCount, feeTiersCount] = await Promise.all([
      this.gnsDiamond.getCollaterals(),
      this.gnsDiamond.getAllPairsRestrictedMaxLeverage(),
      this.gnsDiamond.groupsCount(),
      this.gnsDiamond.feesCount(),
      this.gnsDiamond.getFeeTiersCount(),
    ]);

    const pairCount = Object.keys(pairsSdk).length;

    const pairCalls = Array.from({ length: pairCount }, (_, index) => ({
      functionName: "pairs",
      args: [index],
    }));

    const groupCalls = Array.from({ length: Number(groupsCount) }, (_, index) => ({
      functionName: "groups",
      args: [index],
    }));

    const feesCalls = Array.from({ length: Number(feesCount) }, (_, index) => ({
      functionName: "fees",
      args: [index],
    }));

    const feeTiersCalls = Array.from({ length: Number(feeTiersCount) }, (_, index) => ({
      functionName: "getFeeTier",
      args: [index],
    }));

    const feeMultipliersCalls = Array.from({ length: Number(groupsCount) }, (_, index) => ({
      functionName: "getGroupVolumeMultiplier",
      args: [index],
    }));

    const pairBorrowingFeesCalls = collaterals.map(({ collateral }, index) => {
      return {
        functionName: "getAllBorrowingPairs",
        args: [index + 1],
      };
    });

    const [pairResults, groupsResults, feesResults, feeTiersResults, feeMultipliersResults, pairBorrowingFeesResults] =
      (await Promise.all([
        multiCall(this.multicall3, this.gnsDiamond, pairCalls),
        multiCall(this.multicall3, this.gnsDiamond, groupCalls),
        multiCall(this.multicall3, this.gnsDiamond, feesCalls),
        multiCall(this.multicall3, this.gnsDiamond, feeTiersCalls),
        multiCall(this.multicall3, this.gnsDiamond, feeMultipliersCalls),
        multiCall(this.multicall3, this.gnsDiamond, pairBorrowingFeesCalls),
      ])) as [
        [IPairsStorage.PairStruct][],
        [IPairsStorage.GroupStruct][],
        [IPairsStorage.FeeGroupStruct][],
        [IFeeTiers.FeeTierStruct][],
        BigNumberish[],
        [
          IBorrowingFees.BorrowingDataStruct[],
          IBorrowingFees.OpenInterestStruct[],
          [IBorrowingFees.BorrowingPairGroupStruct[]]
        ][]
      ];

    const pairs = convertTradingPairs(pairResults.map((pair) => pair[0]));
    const groups = convertTradingGroups(groupsResults.map((group) => group[0]));
    const fees = convertFees(feesResults.map((fee) => fee[0]));
    const feeTiers = convertFeeTiers({
      tiers: feeTiersResults.map((feeTier) => feeTier[0]),
      multipliers: feeMultipliersResults.map((feeMultiplier) => feeMultiplier[0]),
    });

    const pairBorrowingFees = collaterals.map(({ collateral }, index) => {
      const borrowingDataArr = pairBorrowingFeesResults[index][0];
      const borrowingOiArr = pairBorrowingFeesResults[index][1];
      const borrowingPairGroups = pairBorrowingFeesResults[index][2];
      return borrowingDataArr.map((borrowingData, pairIndex) => {
        const pairGroups = borrowingPairGroups[pairIndex];
        return convertPairBorrowingFee({
          accFeeLong: borrowingData.accFeeLong,
          accFeeShort: borrowingData.accFeeShort,
          accLastUpdatedBlock: borrowingData.accLastUpdatedBlock,
          feeExponent: borrowingData.feeExponent,
          feePerBlock: borrowingData.feePerBlock,
          oi: borrowingOiArr[pairIndex],
          groups: pairGroups?.length ? pairGroups : [],
        });
      });
    });

    // group borrowing fees
    const groupBorrowingFeesCalls = collaterals.map(({ collateral }, index) => {
      const pairBorrowingResult = pairBorrowingFeesResults[index];
      const borrowingFeesGroupIds = [
        ...new Set<BigNumberish>(pairBorrowingResult[2].map((pair) => pair.map((pair) => pair.groupIndex)).flat()),
      ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return {
        functionName: "getBorrowingGroups",
        args: [
          index + 1,
          Array.from(Array(Number(borrowingFeesGroupIds[borrowingFeesGroupIds.length - 1]) + 1).keys()),
        ],
      };
    });

    const groupBorrowingFeesResults = await multiCall(this.multicall3, this.gnsDiamond, groupBorrowingFeesCalls);
    const groupBorrowingFees = collaterals.map(({ collateral }, index) => {
      const borrowingDataArr: IBorrowingFees.BorrowingDataStruct[] = groupBorrowingFeesResults[index][0];
      const borrowingOiArr: IBorrowingFees.OpenInterestStruct[] = groupBorrowingFeesResults[index][1];
      return borrowingDataArr.map((borrowingData, groupIndex) => {
        return convertGroupBorrowingFee({
          accFeeLong: borrowingData.accFeeLong,
          accFeeShort: borrowingData.accFeeShort,
          accLastUpdatedBlock: borrowingData.accLastUpdatedBlock,
          feeExponent: borrowingData.feeExponent,
          feePerBlock: borrowingData.feePerBlock,
          oi: borrowingOiArr[groupIndex],
        });
      });
    });

    // collateral configs
    const tokenData = await Promise.all(
      collaterals.map(({ collateral }) => {
        const token = new Contract(collateral, ERC20_ABI, this.runner);
        return Promise.all([token.decimals() as Promise<bigint>, token.symbol() as Promise<string>]);
      })
    );

    const collateralsWithDecimalsAndSymbols = collaterals.map(
      ({ collateral, precision, precisionDelta, isActive }, index) => {
        const [decimals, symbol] = tokenData[index];
        return {
          collateral,
          decimals,
          symbol,
          isActive,
          precision,
          precisionDelta,
        };
      }
    );
    const collateralConfigs = collateralsWithDecimalsAndSymbols.map(convertCollateralConfig);

    this.lastRefreshedTs = Date.now();
    this.state = {
      collaterals: collateralConfigs,
      groups,
      pairs,
      fees,
      maxPairLeverages: maxPairLeverages.map((maxLev) => Number(maxLev) / 1e3),
      groupBorrowingFees,
      pairBorrowingFees,
      maxGainP: 900,
      feeTiers,
    };
  }

  public async getState(): Promise<State> {
    return this.state;
  }

  public async getUserTrades(account: string): Promise<TradeContainer[]> {
    const { collaterals } = this.state;
    const [trades, tradeInfos, liquidationParams] = await Promise.all([
      this.gnsDiamond.getTrades(account),
      this.gnsDiamond.getTradeInfos(account),
      this.gnsDiamond.getTradesLiquidationParams(account),
    ]);

    const initialAccFeesCalls = trades
      .map((trade) => ({
        collateralIndex: trade.collateralIndex,
        user: trade.user,
        index: trade.index,
      }))
      .map(({ collateralIndex, user, index }) => {
        return {
          functionName: "getBorrowingInitialAccFees",
          args: [collateralIndex, user, index],
        };
      });
    const initialAccFeesResults = await multiCall(this.multicall3, this.gnsDiamond, initialAccFeesCalls);
    const initialAccFees: IBorrowingFees.BorrowingInitialAccFeesStruct[] = initialAccFeesResults.map(
      (result) => result[0]
    );

    return trades.map((trade, index) => {
      const tradeInfo = tradeInfos[index];
      const liqParams = liquidationParams[index];
      const initialAccFee = initialAccFees[index];
      return convertTradeContainer(
        {
          trade,
          tradeInfo,
          liquidationParams: liqParams,
          initialAccFees: initialAccFee,
        },
        collaterals
      );
    });
  }

  public async getTraderFeeTiers(account: string): Promise<TraderFeeTiers> {
    const currentDay = getCurrentDay();
    const expiringDay = currentDay - 30;
    const [
      { lastDayUpdated: lastDayUpdatedRaw, trailingPoints: trailingPointsRaw },
      { feeMultiplierCache: currentFeeMultiplierCacheRaw, points: currentPointsRaw },
      { feeMultiplierCache: expiringFeeMultiplierCacheRaw, points: expiringPointsRaw },
      traderEnrollment,
    ] = (
      await multiCall(this.multicall3, this.gnsDiamond, [
        {
          functionName: "getFeeTiersTraderInfo",
          args: [account],
        },
        {
          functionName: "getFeeTiersTraderDailyInfo",
          args: [account, currentDay],
        },
        {
          functionName: "getFeeTiersTraderDailyInfo",
          args: [account, expiringDay],
        },
        {
          functionName: "getTraderFeeTiersEnrollment",
          args: [account],
        },
      ])
    ).map((result) => result[0]) as [
      IFeeTiers.TraderInfoStruct,
      IFeeTiers.TraderDailyInfoStructOutput,
      IFeeTiers.TraderDailyInfoStructOutput,
      IFeeTiers.TraderEnrollmentStructOutput
    ];

    const traderInfo = {
      lastDayUpdated: lastDayUpdatedRaw,
      trailingPoints: trailingPointsRaw,
    };

    const currentTraderDailyInfo = {
      feeMultiplierCache: currentFeeMultiplierCacheRaw,
      points: currentPointsRaw,
    };

    const expiringTraderDailyInfo = {
      feeMultiplierCache: expiringFeeMultiplierCacheRaw,
      points: expiringPointsRaw,
    };

    const calls: { functionName: string; args: (string | number)[] }[] = [];

    if (Number(traderInfo.lastDayUpdated) > Number(0)) {
      const earliestExpiredDay = Math.max(Number(traderInfo.lastDayUpdated) - 30, expiringDay - 30);

      for (let day = expiringDay - 1; day >= earliestExpiredDay; day--) {
        calls.push({
          functionName: "getFeeTiersTraderDailyInfo",
          args: [account, day],
        });
      }
    }
    calls.push({
      functionName: "getFeeTiersTraderDailyInfo",
      args: [account, Number(traderInfo.lastDayUpdated)],
    });

    const daysInfoResults = await multiCall(this.multicall3, this.gnsDiamond, calls);
    const daysInfo = daysInfoResults.map((dayInfoResult) => {
      const dayInfo = dayInfoResult[0];
      return {
        points: dayInfo.points,
        feeMultiplierCache: dayInfo.feeMultiplierCache,
      };
    });
    const expiredDaysInfo = daysInfo.slice(0, -1);
    const lastDayUpdatedInfo = daysInfo[daysInfo.length - 1];

    return convertTraderFeeTiers({
      traderInfo,
      traderEnrollment,
      lastDayUpdatedPoints: lastDayUpdatedInfo.points,
      inboundPoints: currentTraderDailyInfo.points,
      outboundPoints: expiringTraderDailyInfo.points,
      expiredPoints: expiredDaysInfo.map((dayInfo) => dayInfo.points),
    });
  }

  public async getTraderHistory(account: string): Promise<{ trades: TradeWithHistory[]; orders: TradeWithHistory[] }> {
    const addHistoryEntries = (trade: Trade, traderBackendData: TradeHistoryRecord[]): TradeWithHistory => {
      return {
        ...trade,
        history: traderBackendData
          .filter((it) => it.tradeIndex === trade.index)
          .map((t) => {
            return {
              action: t.action as TradeAction,
              date: t.date,
              block: t.block,
              leverage: t.leverage,
              collateralAmount: t.size,
              collateralPriceUsd: t.collateralPriceUsd,
              tx: t.tx,
              marketPrice: t.marketPrice,
              pnl: t.pnl_net,
              openPrice: t.price,
              leverageDelta: t.leverageDelta,
              collateralDelta: t.collateralDelta,
            };
          })
          .reverse(),
      };
    };
    const { collaterals } = this.state;
    const accountCounters = await this.gnsDiamond.getCounters(account, 0);
    const userTradesBackend = await this.backend.getTraderHistory(account);

    const userTradesAndOrdersCalls = Array.from({ length: Number(accountCounters.currentIndex) }, (_, index) => ({
      functionName: "getTrade",
      args: [account, index],
    }));
    const userTradesAndOrdersResults: [ITradingStorage.TradeStructOutput][] = await multiCall(
      this.multicall3,
      this.gnsDiamond,
      userTradesAndOrdersCalls
    );
    const userTradesAndOrders = userTradesAndOrdersResults
      .map((trade) => convertTrade(trade[0], collaterals))
      .map((trade) => addHistoryEntries(trade, userTradesBackend));
    const userTrades = userTradesAndOrders.filter((trade) => trade.tradeType === TradeType.TRADE);
    const userOrders = userTradesAndOrders.filter(
      (trade) => trade.tradeType === TradeType.LIMIT || trade.tradeType === TradeType.STOP
    );

    return {
      trades: userTrades,
      orders: userOrders,
    };
  }

  get build() {
    return {
      modifyPosition: async (args: ModifyPositionTxArgs) => {
        if (
          args.type === ModifyPositionTxType.INCREASE_POSITION_SIZE ||
          args.type === ModifyPositionTxType.DECREASE_POSITION_SIZE
        ) {
          return buildUpdatePositionSizeTx(this.gnsDiamond, args);
        }

        if (args.type === ModifyPositionTxType.UPDATE_SL) {
          return buildUpdateSlTx(this.gnsDiamond, args);
        }

        if (args.type === ModifyPositionTxType.UPDATE_TP) {
          return buildUpdateTpTx(this.gnsDiamond, args);
        }

        if (args.type === ModifyPositionTxType.UPDATE_LEVERAGE) {
          return buildUpdateLeverageTx(this.gnsDiamond, args);
        }

        if (args.type === ModifyPositionTxType.UPDATE_OPEN_ORDER) {
          return buildUpdateOpenOrderTx(this.gnsDiamond, args);
        }

        if (args.type === ModifyPositionTxType.UPDATE_MAX_CLOSING_SLIPPAGE_P) {
          return buildUpdateMaxClosingSlippagePTx(this.gnsDiamond, args);
        }
      },
      openTrade: async (args: OpenTradeTxArgs) => {
        return buildOpenTradeTx(this.gnsDiamond, args);
      },
      closeTradeMarket: async (args: CloseTradeMarketTxArgs) => {
        return buildCloseTradeMarketTx(this.gnsDiamond, args);
      },
      cancelOpenOrder: async (index: number) => {
        return buildCancelOpenOrderTx(this.gnsDiamond, index);
      },
      cancelOrderAfterTimeout: async (index: number) => {
        return buildCancelOrderAfterTimeoutTx(this.gnsDiamond, index);
      },
    };
  }

  get write() {
    if (!this.signer) {
      throw new Error("Signer requried for write methods");
    }

    return {
      modifyPosition: async (args: ModifyPositionTxArgs) => {
        const tx = await this.build.modifyPosition(args);
        const hash = await this.signer?.sendTransaction({ ...tx, chainId: this.chainId });

        return hash;
      },
      openTrade: async (args: OpenTradeTxArgs) => {
        const tx = await this.build.openTrade(args);
        const hash = await this.signer?.sendTransaction({ ...tx, chainId: this.chainId });

        return hash;
      },
      closeTradeMarket: async (args: CloseTradeMarketTxArgs) => {
        const tx = await this.build.closeTradeMarket(args);
        const hash = await this.signer?.sendTransaction({ ...tx, chainId: this.chainId });

        return hash;
      },
      cancelOpenOrder: async (index: number) => {
        const tx = await this.build.cancelOpenOrder(index);
        const hash = await this.signer?.sendTransaction({ ...tx, chainId: this.chainId });

        return hash;
      },
      cancelOrderAfterTimeout: async (index: number) => {
        const tx = await this.build.cancelOrderAfterTimeout(index);
        const hash = await this.signer?.sendTransaction({ ...tx, chainId: this.chainId });

        return hash;
      },
      multicall: async (args: string[]) => {
        const { hash } = await this.gnsDiamond.multicall(args);

        return hash;
      },
      delegatedTradingAction: async (trader: string, calldata: string) => {
        const { hash } = await this.gnsDiamond.delegatedTradingAction(trader, calldata);

        return hash;
      },
    };
  }
}
