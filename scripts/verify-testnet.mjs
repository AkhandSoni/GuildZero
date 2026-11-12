import { inspectReceipt,testnetAccount,yocto } from "../lib/settlement/policy.ts";
import { assertTestnet,rpc } from "../lib/settlement/rpc.ts";
import { existsSync } from "node:fs";
if(existsSync(".env.near.local"))process.loadEnvFile(".env.near.local");
const txHash=process.env.NEAR_RECEIPT_TX_HASH,sender=process.env.NEAR_OPERATOR_ACCOUNT_ID,recipient=process.env.NEAR_RECEIPT_RECIPIENT,amountYocto=process.env.NEAR_RECEIPT_AMOUNT_YOCTO,nonce=process.env.NEAR_RECEIPT_NONCE;
if(!txHash||!sender||!recipient||!amountYocto||!nonce){console.error("Not run: set the public receipt fields documented in docs/settlement.md. No transaction will be sent.");process.exit(2);}
if(!testnetAccount(sender)||!testnetAccount(recipient)||!/^\d{1,30}$/.test(nonce))throw new Error("Invalid testnet receipt fields");yocto(amountYocto);
try{await assertTestnet();const receipt=await rpc("tx",{tx_hash:txHash,sender_account_id:sender,wait_until:"FINAL"});const result=inspectReceipt(receipt,{txHash,sender,recipient,amountYocto,nonce});console.log(JSON.stringify({txHash,network:"testnet",...result},null,2));if(result.status!=="CONFIRMED")process.exitCode=1;}
catch{console.error("Receipt verification unavailable; no confirmation is claimed and no transfer was submitted.");process.exitCode=1;}
