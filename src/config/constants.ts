export enum SupportedChainId {
  Arbitrum = 42161,
  ArbitrumSepolia = 421614,
  Polygon = 137,
}

export const GNS_DIAMOND_ADDRESSES: { [chainId in SupportedChainId]: string } = {
  [SupportedChainId.Arbitrum]: "0xFF162c694eAA571f685030649814282eA457f169",
  [SupportedChainId.ArbitrumSepolia]: "0xd659a15812064C79E189fd950A189b15c75d3186",
  [SupportedChainId.Polygon]: "",
};

export const BACKEND_ADDRESSES: { [chainId in SupportedChainId]: string } = {
  [SupportedChainId.Arbitrum]: "https://backend-arbitrum.gains.trade",
  [SupportedChainId.ArbitrumSepolia]: "https://backend-sepolia.gains.trade",
  [SupportedChainId.Polygon]: "https://backend-polygon.gains.trade",
};

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
