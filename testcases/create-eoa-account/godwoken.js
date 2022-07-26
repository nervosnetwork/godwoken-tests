'use strict';

import { RPC } from "ckb-js-toolkit";
export class GodwokenClient {
	constructor(url) {
		this.rpc = new RPC(url);
	}

	async rpcCall(method, args) {
		return await this.rpc[method](...args);
	}

	async getNonce(accountId) {
		return await this.rpcCall("gw_get_nonce", [accountId]);
	}

	async getScriptHash(accountId) {
		return await this.rpcCall("gw_get_script_hash", [accountId]);
	}

	async executeL2Tx(tx) {
		return await this.rpcCall("gw_execute_l2transaction", [tx]);
	}
	async submitL2Tx(tx) {
		return await this.rpcCall("gw_submit_l2transaction", [tx]);
	}

	async getRollupTyeHash() {
		return await this.rpcCall("poly_getRollupTypeHash", []);
	}

	async getBalance(addr) {
		return await this.rpcCall("eth_getBalance", [addr, "latest"]);
	}

	async getEthAccountTypeHash() {
		return await this.rpcCall("poly_getEthAccountLockHash", []);
	}

	async getAccountIdByScriptHash(scriptHash) {
		return await this.rpcCall("gw_get_account_id_by_script_hash", [scriptHash]);
	}

	async getScriptHashByAccountId(accountId) {
		return await this.rpcCall("gw_get_script_hash", [accountId]);
	}

	async getTransactionReceipt(txHash) {
		return await this.rpcCall("gw_get_transaction_receipt", [txHash]);
	}

	async getScriptHashByRegistryAddress(registryAddress) {
		return await this.rpcCall("gw_get_script_hash_by_registry_address", [registryAddress]);
	}

	async getRegistryAddressByScriptHash(scriptHash, registryId) {
		return await this.rpcCall("gw_get_registry_address_by_script_hash", [scriptHash, registryId]);
	}

	async getNodeInfo() {
		return await this.rpcCall("gw_get_node_info", []);
	}
}