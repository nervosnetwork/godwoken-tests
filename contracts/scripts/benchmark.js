"strict mode";

const util = require('util');
const fs = require('fs').promises;
const { ethers } = require("hardhat");

const SUDT_ID = 1; // Replace this with SUDT ID received from depositing SUDT to Layer 2. This should be a number.
const SUDT_NAME = 'ckETH';
const SUDT_SYMBOL = 'ckETH';
const SUDT_DECIMALS = 18;
const SUDT_TOTAL_SUPPLY = 9999999999;

async function deployContract() {
	console.log('Deploy ERC20 contract first');
	// https://github.com/nervosnetwork/godwoken-polyjuice/blob/compatibility-breaking-changes/solidity/erc20/SudtERC20Proxy_UserDefinedDecimals.sol
	const abi_content = await fs.readFile("./scripts/erc20/SudtERC20Proxy_UserDefinedDecimals.abi", "utf8");
	const abi = JSON.parse(abi_content);
	const bin = await fs.readFile('./scripts/erc20/SudtERC20Proxy_UserDefinedDecimals.bin', "utf8");
	const [sender] = await ethers.getSigners();
	const erc20Fact = new ethers.ContractFactory(abi, bin, sender);
	const erc20 = await erc20Fact.deploy(SUDT_NAME, SUDT_SYMBOL, SUDT_TOTAL_SUPPLY, SUDT_ID, SUDT_DECIMALS);
	console.log(`ERC20 on address: ${erc20.address}`);
	return erc20;
}

/**
 * 
 * Read a JSON file which contains an array looks like:
 * [
 * 	{"privateKey": "0x1"},
 * 	{"privateKey": "0x2"},
 * 	{"privateKey": "0x3"}
 * ]
 * 
 * The program will find the **privateKey** field.
 * 
 * @param {*} path 
 * @param {*} provider 
 * @returns 
 */
async function readAccountFileToSigners(path, provider) {
	const content = await fs.readFile(path, "utf8");
	let accounts = JSON.parse(content);
	return accounts.map((account) => {
		const privkey = account.privateKey;
		return new ethers.Wallet(privkey, provider);
	});
}

/**
 * 
 * Take out pks which are not a gw account or 0 balance.
 * @param {*} testcases an array of TestCases
 * @param {*} erc20 contract
 * @returns valid testcases
 */
async function filterInvalidTestCases(testcases, erc20) {
	let promises = testcases.map((testcase) => {
		const erc20_rw = erc20.connect(testcase.getAccount());
		const addr = testcase.getAddress();
		return erc20_rw.callStatic.balanceOf(addr).then(balance => {
			if (balance > 0) {
				return testcase;
			} else {
				console.log(`${addr} has no balance`);
				return null;
			}
		}).catch(err => {
			console.error(`${addr} get balance with error: ${err}`);
		});
	});
	return (await Promise.allSettled(promises))
		.filter(result => result.status == 'fulfilled' && result.value != null)
		.map(result => result.value);
}

class TestCase {
	constructor(account, eth_address) {
		this.account = account;
		this.eth_address = eth_address;
		this.available = true;
	}

	getAddress() {
		return this.eth_address;
	}

	getAccount() {
		return this.account;
	}

	reset() {
		this.available = true;
	}

	take() {
		this.available = false;
	}
}

class Benchmark {
	/**
	 * 
	 * @param {[TestCase]} testcases
	 * @param {int} batch_num 
	 */
	constructor(testcases, batch_num, amount) {
		this.testcases = testcases;
		this.batch_num = batch_num;
		this.amount = amount;

		this.sent_cnt = 0;
		this.recv_cnt = 0;
		this.pending = 0;
		this.error = 0;
		this.committed = 0;
		this.timeout = 0;

		this.ticker = Date.now();
	}

	/**
	 * @returns An array of pairs representing: [testcase_from, testcase_to]
	 */
	prepareNextBatch() {
		let avail_cases = this.testcases.filter((t) => t.available);
		if (avail_cases.length == 0) {
			return [];
		}

		// max testcases in a batch
		const len = (this.batch_num > avail_cases.length) ? avail_cases.length : this.batch_num;
		// copy refs in a new array
		let array = [...Array(len).keys()].map(v => avail_cases[v]);
		// set inavailable flag
		array.forEach((t) => {
			t.take();
		});

		let from_accounts = [...array];
		let to_accounts = [...array];
		let first = to_accounts.shift();
		to_accounts = [...to_accounts, first];

		return from_accounts.map((from, i) => { return [from, to_accounts[i]]; });
	}

	incSent() {
		this.sent_cnt++;
	}

	incRecv() {
		this.recv_cnt++;
	}

	incPending() {
		this.pending++;
	}

	incError() {
		this.error++;
	}

	incCommitted() {
		this.committed++;
	}

	incTimeout() {
		this.timeout++;
	}

	stats() {
		const secs = (Date.now() - this.ticker) / 1000;
		const sent_freq = this.sent_cnt / secs;
		const l2_tps = this.pending / secs;
		const l1_tps = this.committed / secs;
		return {
			sent_req: this.sent_cnt,
			sent_freq,
			l2_tps,
			l1_tps,
			pending: this.pending,
			committed: this.committed,
			error: this.error,
			timeout: this.timeout,
		};
	}

}

async function run(erc20, benchmark) {
	let batch = benchmark.prepareNextBatch();
	if (batch.length == 0) {
		console.log('No available test case! Wait for 10s...');
		await delay(10_000);
		return;
	}
	for (let pair of batch) {
		spawnTransferTask(erc20, pair[0], pair[1], benchmark.amount, benchmark);
	}
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function spawnTransferTask(erc20, from, to, amount, benchmark) {
	const erc20_rw = erc20.connect(from.getAccount());
	// Do not wait this.
	erc20_rw.transfer(to.getAddress(), amount)
		.then(tx => {
			// transfer request is sent successfully
			benchmark.incSent();
			return tx;
		})
		.then(tx => {
			// wait tx on L2
			return tx.wait();
		})
		.then(receipt => {
			// recv receipt
			benchmark.incPending();
			return receipt.transactionHash;
		})
		.then(hash => {
			return waitTxCommitted(hash);
		})
		.then(res => {
			if (res == 'committed') {
				benchmark.incCommitted();
			} else if (res == 'timeout') {
				benchmark.incTimeout();
			} else {
				// should never hit
				console.log(`UNEXPECTED BEHAVIOUR: ${res}`);
			}
		})
		.catch((err) => {
			// console.error(err);
			// failed to recv receipt and ignore error.
			benchmark.incError();
		})
		.finally(() => {
			from.reset();
		})

		;

}

function waitTxCommitted(hash, ticker) {
	const timeout_sec = 60;
	return new Promise((resolve) => {
		setTimeout(() => {
			ethers.provider.getTransaction(hash)
				.then(res => {
					if (res.confirmations > 0) {
						return resolve('committed');
					}
				}).finally(() => {
					if (Date.now() - ticker > timeout_sec * 1000) {
						return resolve('timeout');
					}
					waitTxCommitted(hash, ticker);
				});

		}, 5000);
	});

}


async function toTestCases(accounts) {
	let testcases = [];
	for (let account of accounts) {
		const addr = await account.getAddress();
		let testcase = new TestCase(account, addr);
		testcases.push(testcase);
	}
	return testcases;
}
async function main() {
	const erc20 = await deployContract();

	const path = process.env.ACCOUNT_FILE_PATH;
	let batch_num = process.env.BATCH_NUM || 30;
	if (typeof batch_num === 'string') {
		batch_num = Number(batch_num);
	}
	const interval = 1000 * (process.env.INTERVAL || 1);
	let accounts = await readAccountFileToSigners(path, ethers.provider);
	let testcases = await toTestCases(accounts);
	testcases = await filterInvalidTestCases(testcases, erc20);
	console.log(`Total valid accounts: ${testcases.length}`);

	let benchmark = new Benchmark(testcases, batch_num, 1);

	while (true) {
		run(erc20, benchmark);
		await delay(interval);
		console.log(benchmark.stats());
	}
}

/**
 * preset:
 * export ACCOUNT_FILE_PATH=your-accounts.json     
 * optional:
 * export BATCH_NUM=20
 * export INTERVAL=10
 * 
 * environment variables explain:
 * BATCH_NUM: max txs submitted once, default 30
 * INTERVAL: interval secs between batch requests, default 1s
 * ACCOUNT_FILE_PATH: path of generated account json file
 * 
 * npx hardhat run scripts/benchmark.js --network gw_devnet_v1
 */
main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});