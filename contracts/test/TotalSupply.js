"strict mode"


const { expect } = require("chai");
const { ethers } = require("hardhat");

const SUDT_ID = 1;
const SUDT_NAME = 'ckETH';
const SUDT_SYMBOL = 'ckETH';
const SUDT_DECIMALS = 18;
const SUDT_TOTAL_SUPPLY = 9999999999;

describe("TotalSupply", function () {
  it("Deoloy erc20 proxy -> get total supply", async () => {
    const erc20Fact = await ethers.getContractFactory("contracts/SudtERC20Proxy_UserDefinedDecimals.sol:ERC20");
    const erc20 = await erc20Fact.deploy(SUDT_NAME, SUDT_SYMBOL, SUDT_TOTAL_SUPPLY, SUDT_ID, SUDT_DECIMALS);
    console.log(`  ERC20 on address: ${erc20.address}`);
    const [sender] = await ethers.getSigners();
    const totalSupply = await erc20.callStatic.totalSupply();
    expect(totalSupply, SUDT_TOTAL_SUPPLY);

  });
});
/**
 * How to run this?
 * > npx hardhat test test/TotalSupply --network gw_devnet_v1
 */