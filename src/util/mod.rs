use crate::types::Config;
use crate::GodwokenUser;
use anyhow::{Context, Result};
use std::{env, fs, path::Path};

pub mod cli;
pub mod godwoken_ctl;

/// get miner, user1, ...
pub fn get_signers() -> (GodwokenUser, GodwokenUser) {
    let miner = GodwokenUser {
        private_key: env::var("MINER_PRIVATE_KEY").unwrap_or_else(|_| {
            "0xdd50cac37ec6dd12539a968c1a2cbedda75bd8724f7bcad486548eaabb87fc8b".to_string()
        }),
        pub_ckb_addr: env::var("MINER_CKB_ADDR")
            .unwrap_or_else(|_| "ckt1qyqy84gfm9ljvqr69p0njfqullx5zy2hr9kq0pd3n5".to_string()),
        ckb_balance: 0,
        account_script_hash: None,
        gw_account_id: None,
        sudt_id: None,
        l1_sudt_script_hash: None,
        sudt_script_args: env::var("MINER_SUDT_SCRIPT_ARGS").ok(),
    };
    let user1 = GodwokenUser {
        private_key: env::var("USER1_PRIVATE_KEY").unwrap_or_else(|_| {
            "0x6cd5e7be2f6504aa5ae7c0c04178d8f47b7cfc63b71d95d9e6282f5b090431bf".to_string()
        }),
        pub_ckb_addr: env::var("USER1_CKB_ADDR")
            .unwrap_or_else(|_| "ckt1qyqf22qfzaer95xm5d2m5km0f6k288x9warqnhsf4m".to_string()),
        ckb_balance: 0,
        account_script_hash: None,
        gw_account_id: None,
        sudt_id: None,
        l1_sudt_script_hash: None,
        sudt_script_args: env::var("USER1_SUDT_SCRIPT_ARGS").ok(),
    };
    (miner, user1)
}

pub fn read_data_from_stdout(output: std::process::Output, regex: &str, err_msg: &str) -> String {
    let stdout_text = String::from_utf8(output.stdout).unwrap_or_default();
    log::debug!("{}", &stdout_text);
    let pattern = regex::Regex::new(regex).unwrap();
    let data = if let Some(cap) = pattern.captures(&stdout_text) {
        cap.get(1).unwrap().as_str().to_owned()
    } else {
        panic!(
            "{}\n{}\n{}",
            err_msg,
            &String::from_utf8(output.stderr).unwrap_or_default(),
            &stdout_text
        );
    };
    data
}

fn read_config<P: AsRef<Path>>(path: P) -> Result<Config> {
    let content = fs::read(&path)
        .with_context(|| format!("read config file from {}", path.as_ref().to_string_lossy()))?;
    let config = toml::from_slice(&content).with_context(|| "parse config file")?;
    Ok(config)
}

fn read_godwoken_config() -> Result<Config> {
    let path = "./configs/godwoken-config.toml";
    read_config(&path)
}

/// get finality blocks from godwoken config.
/// default: 6
pub fn get_finality_blocks() -> u64 {
    if let Ok(config) = read_godwoken_config() {
        let finality_blocks = config.genesis.rollup_config.finality_blocks;
        u64::from_str_radix(finality_blocks.trim_start_matches("0x"), 16).unwrap_or(6)
    } else {
        6
    }
}
