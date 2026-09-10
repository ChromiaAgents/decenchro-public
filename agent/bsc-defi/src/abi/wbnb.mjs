// WBNB wrap/unwrap. Balance/approve come from erc20Abi.
import { parseAbi } from 'viem';

export const wbnbAbi = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256 wad)',
]);
