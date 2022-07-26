'use strict';
import { GodwokenClient } from "./godwoken";
import { Reader } from "ckb-js-toolkit";
import { signTypedData, SignTypedDataVersion } from "@metamask/eth-sig-util";
import lumos from '@ckb-lumos/base';
const { utils } = lumos;
import keccak256 from "keccak256";
import crypto from "crypto";
import { expect } from 'chai';
import {
	SerializeMetaContractArgs,
	SerializeRawL2Transaction,
	SerializeL2Transaction,
	SerializeETHAddrRegArgs,
} from "./godwoken-schema";

/**
 * Some node info we need when we build a transaction.
 */
class NodeInfo {
	constructor(nodeInfoJson) {
		this.nodeInfoJson = nodeInfoJson;
	}

	getRollupTyeHash() {
		return this.nodeInfoJson.rollup_cell.type_hash;
	}

	getChainId() {
		return this.nodeInfoJson.rollup_config.chain_id;
	}

	getEthAccountTypeHash() {
		return this.nodeInfoJson.eoa_scripts
			.filter(v => v.eoa_type == 'eth')[0]
			.type_hash;
	}

	getEthAddrRegTypeHash() {
		return this.nodeInfoJson.backends
			.filter(v => v.backend_type == 'eth_addr_reg')[0]
			.validator_script_type_hash;
	}
}

function normalizeHexNumber(length, value) {
	if (!(value instanceof ArrayBuffer)) {
		let intValue = BigInt(value).toString(16);
		if (intValue.length % 2 !== 0) {
			intValue = "0" + intValue;
		}
		if (intValue.length / 2 > length) {
			throw new Error(
				`${intValue.length / 2} bytes long, expected length is ${length}!`
			);
		}
		const view = new DataView(new ArrayBuffer(length));
		for (let i = 0; i < intValue.length / 2; i++) {
			const start = intValue.length - (i + 1) * 2;
			view.setUint8(i, parseInt(intValue.substr(start, 2), 16));
		}
		value = view.buffer;
	}
	if (value.byteLength < length) {
		const array = new Uint8Array(length);
		array.set(new Uint8Array(value), 0);
		value = array.buffer;
	}
	return value;
}

function privateKeyToEthAddress(privateKey) {
	const ecdh = crypto.createECDH(`secp256k1`);
	ecdh.generateKeys();
	ecdh.setPrivateKey(Buffer.from(privateKey.slice(2), "hex"));
	const publicKey = "0x" + ecdh.getPublicKey("hex", "uncompressed");
	const ethAddress =
		"0x" +
		keccak256(Buffer.from(publicKey.slice(4), "hex"))
			.slice(12)
			.toString("hex");
	return ethAddress;
}
async function privateKeyToLayer2ScriptHash(
	privateKey,
	ethAccountTypeHash,
	rollupTypeHash
) {
	const ethAddress = privateKeyToEthAddress(privateKey);
	console.log(`ethAddress: ${ethAddress}`);
	return ethAddrToScriptHash(ethAccountTypeHash, rollupTypeHash, ethAddress);
}

function ethAddrToScriptHash(
	ethAccountTypeHash,
	rollupTypeHash,
	ethAddress) {
	const script = {
		code_hash: ethAccountTypeHash,
		hash_type: "type",
		args: rollupTypeHash + ethAddress.slice(2),
	};

	const scriptHash = utils.computeScriptHash(script);
	return scriptHash;

}

function normalizeRawL2Tx(rawL2Tx) {
	const tx = {
		chain_id: normalizeHexNumber(8, rawL2Tx.chain_id),
		from_id: normalizeHexNumber(4, rawL2Tx.from_id),
		to_id: normalizeHexNumber(4, rawL2Tx.to_id),
		nonce: normalizeHexNumber(4, rawL2Tx.nonce),
		args: new Reader(rawL2Tx.args)
	};
	return tx;

}
function serializeRawL2Tx(rawL2Tx) {
	const tx = normalizeRawL2Tx(rawL2Tx);
	return new Reader(SerializeRawL2Transaction(tx)).serializeJson();
}

function serializeL2Tx(l2tx) {
	const tx = {
		raw: normalizeRawL2Tx(l2tx.raw),
		signature: new Reader(l2tx.signature)
	};
	return new Reader(
		SerializeL2Transaction(tx)
	).serializeJson();
}

async function privateKeyToAccountId(
	godwokenClient,
	privateKey,
	ethAccountTypeHash,
	rollupTypeHash
) {
	const scriptHash = await privateKeyToLayer2ScriptHash(
		privateKey,
		ethAccountTypeHash,
		rollupTypeHash
	);
	const id = await godwokenClient.getAccountIdByScriptHash(scriptHash);
	return id;
}

function createMetaContractArgs(rollupTypeHash, ethAccountTypeHash, ethAddr) {
	console.log(`rollup type hash: ${rollupTypeHash}`);
	console.log(`eth account type hash: ${ethAccountTypeHash}`);
	console.log(`eth addr: ${ethAddr}`);
	const scriptArgs = rollupTypeHash + ethAddr.slice(2).toLowerCase();
	// const scriptArgs = rollupTypeHash;
	console.log(`script args: ${scriptArgs}`);
	const l2Script = {
		code_hash: new Reader(ethAccountTypeHash),
		hash_type: 1, //Type
		args: new Reader(scriptArgs),
	};
	const fee = "0x1";
	const createAccount = {
		script: l2Script,
		fee: {
			registry_id: normalizeHexNumber(4, "0x2"),
			amount: normalizeHexNumber(16, fee)
		}
	};

	// MetaContractArgs
	const metaContractArgs = {
		type: "CreateAccount",
		value: createAccount
	};

	return new Reader(SerializeMetaContractArgs(metaContractArgs)).serializeJson();
}
async function convertToTypedL2Tx(fromEthAddr, rawL2Tx, rpc) {
	const chain_id = Number(rawL2Tx.chain_id);
	const nonce = Number(rawL2Tx.nonce);
	const toScriptHash = await rpc.getScriptHashByAccountId(rawL2Tx.to_id);
	return {
		chain_id,
		nonce,
		from: fromEthAddr,
		to: toScriptHash,
		args: rawL2Tx.args
	};
}

function bytesToHexString(byteArray) {
	return Array.from(byteArray, function (byte) {
		return ('0' + (byte & 0xFF).toString(16)).slice(-2);
	}).join('');
}

function getEIP712DomainSignature(typedL2Tx, privateKey) {
	console.log(`typedL2Tx: ${JSON.stringify(typedL2Tx, null, 2)}`);
	const typedData = {
		"types": {
			"EIP712Domain": [
				{ "name": "name", "type": "string" },
				{ "name": "version", "type": "string" },
				{ "name": "chainId", "type": "uint256" },
			],
			"RegistryAddress": [
				{ "name": "registry", "type": "string" },
				{ "name": "address", "type": "address" }
			],
			"L2Transaction": [
				{ "name": "chainId", "type": "uint256" },
				{ "name": "from", "type": "RegistryAddress" },
				{ "name": "to", "type": "bytes32" },
				{ "name": "nonce", "type": "uint256" },
				{ "name": "args", "type": "bytes" }
			]
		},
		"primaryType": "L2Transaction",
		"domain": {
			"name": "Godwoken",
			"version": "1",
			"chainId": typedL2Tx.chain_id,
		},
		"message": {
			"chainId": typedL2Tx.chain_id,
			"from": {
				"registry": "ETH",
				"address": typedL2Tx.from
			},
			"to": typedL2Tx.to,
			"nonce": typedL2Tx.nonce,
			"args": typedL2Tx.args
		}
	};
	const signature = signTypedData({
		privateKey: Buffer.from(privateKey.slice(2), 'hex'),
		data: typedData,
		version: SignTypedDataVersion.V4
	});
	return signature;
}

//1. create EOA account for ethAddr
async function createEoaAccount(rpc, privateKey, ethAddr, nodeInfo) {
	const rollupTypeHash = nodeInfo.getRollupTyeHash();
	const ethAccountTypeHash = nodeInfo.getEthAccountTypeHash();
	const chainId = nodeInfo.getChainId();
	const fromId = await privateKeyToAccountId(rpc, privateKey, ethAccountTypeHash, rollupTypeHash);
	console.log(`fromId: ${fromId}`);
	let nonce = await rpc.getNonce(fromId);
	//0x0 is reserved for meta contract
	const metaContractAccountId = "0x0";

	const args = createMetaContractArgs(rollupTypeHash, ethAccountTypeHash, ethAddr);
	console.log(`createMetaContractArgs: ${args}`);
	//The structure of tx means: we want to create a tx that creating 
	//an EOA account(which type hash is ethAccountTypeHash) with Meta Contract.
	const createEOATx = await buildTx(rpc, privateKey, fromId, metaContractAccountId, nonce, args, chainId);
	const l2TxHash = await rpc.submitL2Tx(createEOATx);
	console.log(`l2txHash: ${l2TxHash}`);
	//We expect to receive a receipt of the tx.
	//Attention! If the ethAddr has been created before, then we may not be able to receive a receipt.
	let receipt = await waitReceipt(rpc, l2TxHash);
	console.log(`receipt: ${JSON.stringify(receipt, null, 2)}`);

	//Check the EOA account we just created.
	const newScriptHash = ethAddrToScriptHash(ethAccountTypeHash, rollupTypeHash, ethAddr);
	const newAccountId = await rpc.getAccountIdByScriptHash(newScriptHash);
	console.log(`newAccountId: ${newAccountId}`);
	return newAccountId;
}

//2. Set mapping between ethAddr and godwoken script hash with Eth Addr Registry contract.
async function setMapping(rpc, privateKey, ethAddr, nodeInfo) {
	const rollupTypeHash = nodeInfo.getRollupTyeHash();
	const ethAccountTypeHash = nodeInfo.getEthAccountTypeHash();
	const ethAddrRegTypeHash = nodeInfo.getEthAddrRegTypeHash();
	const chainId = nodeInfo.getChainId();
	const fromId = await privateKeyToAccountId(rpc, privateKey, ethAccountTypeHash, rollupTypeHash);
	console.log(`fromId: ${fromId}`);
	const nonce = await rpc.getNonce(fromId);
	const ethAddrRegScriptHash = buildEthAddrRegScriptHash(rollupTypeHash, ethAddrRegTypeHash);
	const newScriptHash = ethAddrToScriptHash(ethAccountTypeHash, rollupTypeHash, ethAddr);
	console.log(`newScriptHash: ${newScriptHash}`);
	const ethRegMapArgs = buildEthRegMapArgs(newScriptHash);
	const ethRegAccountId = await rpc.getAccountIdByScriptHash(ethAddrRegScriptHash);
	console.log(`ethRegAccountId: ${ethRegAccountId}`);
	const l2Tx = await buildTx(rpc, privateKey, fromId, ethRegAccountId, nonce, ethRegMapArgs, chainId);
	const l2TxHash = await rpc.submitL2Tx(l2Tx);
	console.log(`l2txHash: ${l2TxHash}`);
	const receipt = await waitReceipt(rpc, l2TxHash);
	console.log(`l2TxHash: ${JSON.stringify(receipt, null, 2)}`);
}


function buildEthAddrRegScriptHash(rollupTypeHash, ethAddrRegTypeHash) {
	const script = {
		code_hash: ethAddrRegTypeHash,
		hash_type: "type",
		args: rollupTypeHash,
	};

	const scriptHash = utils.computeScriptHash(script);
	return scriptHash;

}
function buildEthRegMapArgs(accountScriptHash) {
	const fee = "0x1";
	const setMapping = {
		"gw_script_hash": new Reader(accountScriptHash),
		"fee": {
			registry_id: normalizeHexNumber(4, "0x2"),
			amount: normalizeHexNumber(16, fee)
		}
	};
	const ethRegArgs = {
		"type": "SetMapping",
		"value": setMapping
	};
	return new Reader(SerializeETHAddrRegArgs(ethRegArgs)).serializeJson();
}

async function buildTx(rpc, privateKey, fromId, toId, nonce, args, chainId) {
	const rawL2Tx = {
		chain_id: chainId,
		from_id: fromId,
		to_id: toId,
		nonce: nonce,
		args: args
	};
	const fromEthAddr = privateKeyToEthAddress(privateKey);
	const typedL2Tx = await convertToTypedL2Tx(fromEthAddr, rawL2Tx, rpc);
	const signature = getEIP712DomainSignature(typedL2Tx, privateKey);

	console.log(`signature: ${signature}`);
	const l2tx1 = {
		raw: rawL2Tx,
		signature: signature
	};
	console.log("l2 tx:", JSON.stringify(l2tx1, null, 2));
	return serializeL2Tx(l2tx1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReceipt(rpc, txHash) {
	while (true) {
		await sleep(1000);
		let receipt = await rpc.getTransactionReceipt(txHash);
		if (receipt === null) {
			continue;
		}
		return receipt;
	}

}

async function main() {
	let rpc = new GodwokenClient("http://localhost:8024");
	//This private key is used in kicker.
	//We need to deposit some CKB first.
	const privateKey = process.env.PRIVATE_KEY;
	console.log("private key:", privateKey);
	expect(privateKey).to.exist;
	//The EOA account we are going to create.
	const ethAddress = process.env.ETH_ADDRESS || '0x8fa599f36278e337db301ecf292ff1c5e3cfda84';
	console.log(`Use meta-contract to create account: ${ethAddress}`);

	const res = await rpc.getNodeInfo();
	const nodeInfo = new NodeInfo(res);
	const newAccountId = await createEoaAccount(rpc, privateKey, ethAddress, nodeInfo);
	expect(newAccountId).to.exist;
	const scriptHash = await rpc.getScriptHashByAccountId(newAccountId);
	expect(scriptHash).to.exist;
	console.log(`Script hash: ${scriptHash}`);

	await setMapping(rpc, privateKey, ethAddress, nodeInfo);
	const registryAddress = await rpc.getRegistryAddressByScriptHash(scriptHash, '0x2');
	const actualRegistryAddress = {
		registry_id: '0x2',
		address: ethAddress
	};
	expect(registryAddress).to.deep.equal(actualRegistryAddress);
}

main();