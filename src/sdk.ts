import { getProvider } from "./utils/provider";
import { GNS_DIAMOND_ADDRESSES, MULTICALL3_ADDRESS, SupportedChainId } from "./config/constants";
import { multiCall } from "./utils/multicallHelper";
import { getCurrentDay, pairs as pairsSdk, TradeContainer } from "@gainsnetwork/sdk";
import { GNSDiamond, GNSDiamond__factory, Multicall3__factory } from "./types/contracts";
import { Contract, ethers } from "ethers";
import { State } from "./types";
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
  convertTradeContainer,
  convertTradingGroups,
  convertTradingPairs,
} from "./utils/dataConverter";
import { IBorrowingFees, IFeeTiers, IPairsStorage } from "./types/contracts/GNSDiamond";

export class SDK {
  private chainId: SupportedChainId;
  private signer?: ethers.Signer;
  private gnsDiamond: GNSDiamond;
  private multicall3: Contract;
  private state: State = {} as State;
  public lastRefreshedTs: number = Date.now();
  public initialized: boolean = false;

  constructor(chainId: SupportedChainId, signer?: ethers.Signer) {
    this.chainId = chainId;
    this.signer = signer;

    const runner = this.signer ?? getProvider(chainId);

    this.gnsDiamond = GNSDiamond__factory.connect(GNS_DIAMOND_ADDRESSES[chainId], runner);
    this.multicall3 = new ethers.Contract(MULTICALL3_ADDRESS, Multicall3__factory.abi, runner);
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

    // pairs
    const pairCount = false ? 5 : Object.keys(pairsSdk).length; // @kuko todo: remove 5 to get all markets

    const pairCalls = Array.from({ length: pairCount }, (_, index) => ({
      functionName: "pairs",
      args: [index],
    }));

    const pairResults: [IPairsStorage.PairStruct][] = await multiCall(this.multicall3, this.gnsDiamond, pairCalls);

    const pairs = convertTradingPairs(pairResults.map((pair) => pair[0]));

    // groups
    const groupCalls = Array.from({ length: Number(groupsCount) }, (_, index) => ({
      functionName: "groups",
      args: [index],
    }));

    const groupsResults = await multiCall(this.multicall3, this.gnsDiamond, groupCalls);

    const groups = convertTradingGroups(groupsResults.map((group) => group[0]));

    // fees
    const feesCalls = Array.from({ length: Number(feesCount) }, (_, index) => ({
      functionName: "fees",
      args: [index],
    }));

    const feesResults = await multiCall(this.multicall3, this.gnsDiamond, feesCalls);
    const fees = convertFees(feesResults.map((fee) => fee[0]));

    // feeTiers
    const feeTiersCalls = Array.from({ length: Number(feeTiersCount) }, (_, index) => ({
      functionName: "getFeeTier",
      args: [index],
    }));

    const feeTiersResults = await multiCall(this.multicall3, this.gnsDiamond, feeTiersCalls);

    const feeMultipliersCalls = Array.from({ length: Number(groupsCount) }, (_, index) => ({
      functionName: "getGroupVolumeMultiplier",
      args: [index],
    }));

    const feeMultipliersResults = await multiCall(this.multicall3, this.gnsDiamond, feeMultipliersCalls);

    const feeTiers = convertFeeTiers({
      tiers: feeTiersResults.map((feeTier) => feeTier[0]),
      multipliers: feeMultipliersResults.map((feeMultiplier) => feeMultiplier[0]),
    });

    // pair borrowing fees
    const pairBorrowingFeesCalls = collaterals.map(({ collateral }, index) => {
      return {
        functionName: "getAllBorrowingPairs",
        args: [index + 1],
      };
    });

    const pairBorrowingFees = await multiCall(this.multicall3, this.gnsDiamond, pairBorrowingFeesCalls);
    const pairBorrowingFeesConverted = collaterals.map(({ collateral }, index) => {
      const borrowingDataArr: IBorrowingFees.BorrowingDataStruct[] = pairBorrowingFees[index][0];
      const borrowingOiArr: IBorrowingFees.OpenInterestStruct[] = pairBorrowingFees[index][1];
      const borrowingPairGroups: [IBorrowingFees.BorrowingPairGroupStruct[]] = pairBorrowingFees[index][2];
      return borrowingDataArr.map((borrowingData, pairIndex) => {
        const pairGroups = borrowingPairGroups[pairIndex];
        return convertPairBorrowingFee({
          accFeeLong: borrowingData.accFeeLong,
          accFeeShort: borrowingData.accFeeShort,
          accLastUpdatedBlock: borrowingData.accLastUpdatedBlock,
          feeExponent: borrowingData.feeExponent,
          feePerBlock: borrowingData.feePerBlock,
          oi: {
            long: borrowingOiArr[pairIndex].long,
            short: borrowingOiArr[pairIndex].short,
            max: borrowingOiArr[pairIndex].max,
          },
          groups: pairGroups?.length ? pairGroups : [],
        });
      });
    });

    // group borrowing fees
    const groupBorrowingFeesCalls = collaterals.map(({ collateral }, index) => {
      const pairBorrowingResult = pairBorrowingFees[index];
      const borrowingFeesGroupIds = [
        ...new Set<bigint>(
          pairBorrowingResult[2].map((pair: IPairsStorage.PairStruct[]) => pair.map((pair) => pair.groupIndex)).flat()
        ),
      ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return {
        functionName: "getBorrowingGroups",
        args: [
          index + 1,
          Array.from(Array(Number(borrowingFeesGroupIds[borrowingFeesGroupIds.length - 1]) + 1).keys()),
        ],
      };
    });

    const groupBorrowingFees = await multiCall(this.multicall3, this.gnsDiamond, groupBorrowingFeesCalls);
    const groupBorrowingFeesConverted = collaterals.map(({ collateral }, index) => {
      const borrowingDataArr: IBorrowingFees.BorrowingDataStruct[] = groupBorrowingFees[index][0];
      const borrowingOiArr: IBorrowingFees.OpenInterestStruct[] = groupBorrowingFees[index][1];
      return borrowingDataArr.map((borrowingData, groupIndex) => {
        return convertGroupBorrowingFee({
          accFeeLong: borrowingData.accFeeLong,
          accFeeShort: borrowingData.accFeeShort,
          accLastUpdatedBlock: borrowingData.accLastUpdatedBlock,
          feeExponent: borrowingData.feeExponent,
          feePerBlock: borrowingData.feePerBlock,
          oi: {
            long: borrowingOiArr[groupIndex].long,
            short: borrowingOiArr[groupIndex].short,
            max: borrowingOiArr[groupIndex].max,
          },
        });
      });
    });

    // collateral configs
    const tokenDecimals = await Promise.all([
      ...collaterals.map(({ collateral }) => {
        const token = new Contract(collateral, ERC20_ABI, getProvider(this.chainId));
        return token.decimals() as Promise<bigint>;
      }),
    ]);
    const collateralsWithDecimals = collaterals.map(({ collateral, precision, precisionDelta, isActive }, index) => {
      return {
        collateral,
        decimals: tokenDecimals[index],
        isActive,
        precision,
        precisionDelta,
      };
    });
    const collateralConfigs = collateralsWithDecimals.map(convertCollateralConfig);

    this.lastRefreshedTs = Date.now();
    this.state = {
      collaterals: collateralConfigs,
      groups,
      pairs,
      fees,
      maxPairLeverages: maxPairLeverages.map((maxLev) => Number(maxLev)),
      groupBorrowingFees: groupBorrowingFeesConverted,
      pairBorrowingFees: pairBorrowingFeesConverted,
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
    const initialAccFees = initialAccFeesResults.map((initialAccFeesResult) => {
      const initialAccFee = initialAccFeesResult[0];
      return {
        accPairFee: initialAccFee.accPairFee,
        accGroupFee: initialAccFee.accGroupFee,
        block: initialAccFee.block,
      };
    });

    return trades.map((trade, index) => {
      const tradeInfo = tradeInfos[index];
      const liqParams = liquidationParams[index];
      const initialAccFee = initialAccFees[index];
      return convertTradeContainer({
        trade,
        tradeInfo,
        liquidationParams: liqParams,
        initialAccFees: initialAccFee,
      }, collaterals);
    });
  }

  public async getTraderFeeTiers(account: string): Promise<any> {
    const currentDay = getCurrentDay();
    const expiringDay = currentDay - 30;
    const [
      { lastDayUpdated: lastDayUpdatedRaw, trailingPoints: trailingPointsRaw },
      { feeMultiplierCache: currentFeeMultiplierCacheRaw, points: currentPointsRaw },
      { feeMultiplierCache: expiringFeeMultiplierCacheRaw, points: expiringPointsRaw },
      { status: traderEnrollmentStatus },
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
    ).map((result) => result[0]);

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

    if (traderInfo.lastDayUpdated > BigInt(0)) {
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
      args: [account, traderInfo.lastDayUpdated],
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
    return {
      traderInfo: {
        lastDayUpdated: traderInfo.lastDayUpdated,
        trailingPoints: traderInfo.trailingPoints,
      },
      traderEnrollment: { status: traderEnrollmentStatus },
      lastDayUpdatedPoints: lastDayUpdatedInfo.points,
      inboundPoints: currentTraderDailyInfo.points,
      outboundPoints: expiringTraderDailyInfo.points,
      expiredPoints: expiredDaysInfo.map((dayInfo) => dayInfo.points),
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
