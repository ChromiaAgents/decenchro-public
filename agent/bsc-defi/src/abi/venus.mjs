// Venus: comptroller (Unitroller proxy), vTokens, the vBNB payable variants,
// and the price oracle. Venus is a Compound fork — several mutating vToken
// calls RETURN an error code instead of reverting, so simulations assert the
// returned code is 0 (see tx.mjs expectZeroResult).
import { parseAbi } from 'viem';

export const comptrollerAbi = parseAbi([
  'function getAllMarkets() view returns (address[])',
  // NB: the first return is Compound's error code — named errCode here because
  // "error" is a protected keyword for the human-readable ABI parser.
  'function getAccountLiquidity(address account) view returns (uint256 errCode, uint256 liquidity, uint256 shortfall)',
  'function markets(address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus)',
  'function enterMarkets(address[] vTokens) returns (uint256[])',
  'function getAssetsIn(address account) view returns (address[])',
  'function oracle() view returns (address)',
]);

export const vTokenAbi = parseAbi([
  'function mint(uint256 mintAmount) returns (uint256)',
  'function redeem(uint256 redeemTokens) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
  'function borrowBalanceCurrent(address account) returns (uint256)',
  'function borrowBalanceStored(address account) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function balanceOfUnderlying(address account) returns (uint256)',
  'function exchangeRateStored() view returns (uint256)',
  'function supplyRatePerBlock() view returns (uint256)',
  'function borrowRatePerBlock() view returns (uint256)',
  'function underlying() view returns (address)',
  'function repayBorrow(uint256 repayAmount) returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

// vBNB takes/returns native BNB: mint and repayBorrow are payable, no
// underlying().
export const vBnbAbi = parseAbi([
  'function mint() payable',
  'function repayBorrow() payable',
  'function redeem(uint256 redeemTokens) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
]);

// Returns price scaled by 1e(36 - underlyingDecimals): raw * price / 1e36 = USD.
export const venusOracleAbi = parseAbi([
  'function getUnderlyingPrice(address vToken) view returns (uint256)',
]);
