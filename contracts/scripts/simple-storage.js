// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const SimpleStorage = await hre.ethers.getContractFactory("contracts/SimpleStorage.sol:SimpleStorage");
  const ssContract = await SimpleStorage.deploy();
  await ssContract.deployed();
  console.log("SimpleStorage deployed to:", ssContract.address);

  let storeData = await ssContract.get();
  
  console.log("storeData:", storeData);

  await ssContract.set(10000);
  console.log("storeData:", await ssContract.get());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);π
  });

// How to run this?
// > npx hardhat run scripts/simple-storage.js --network gw_testnet_v1
// > npx hardhat run scripts/simple-storage.js --network gw_devnet_v1