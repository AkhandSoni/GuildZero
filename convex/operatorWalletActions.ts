"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { rpc, assertTestnet } from "../lib/settlement/rpc";
import { walletAmounts } from "../lib/settlement/wallet";
import { testnetAccount } from "../lib/settlement/policy";
export const read = internalAction({
  args: { id: v.id("operatorWalletSnapshots"), account: v.string(), requestedAt: v.number() },
  handler: async (ctx, args) => {
    let failure: "configuration" | "network" | "account" | "protocol" | "evidence" = "configuration";
    try {
      if (process.env.NEAR_NETWORK !== "testnet" || args.account !== process.env.NEAR_OPERATOR_ACCOUNT_ID || !testnetAccount(args.account)) throw new Error("CONFIGURATION_CHANGED");
      failure = "network";
      await assertTestnet();
      failure = "account";
      const account = await rpc("query", { request_type: "view_account", account_id: args.account, finality: "final" });
      failure = "protocol";
      const protocol = await rpc("EXPERIMENTAL_protocol_config", { finality: "final" });
      failure = "evidence";
      const amounts = walletAmounts(account, protocol.runtime_config?.storage_amount_per_byte);
      if (!Number.isSafeInteger(account.block_height) || account.block_height < 0 || typeof account.block_hash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account.block_hash)) throw new Error("INVALID_BLOCK_EVIDENCE");
      await ctx.runMutation(internal.operatorWallet.finish, { ...args, result: { ...amounts, blockHeight: account.block_height, blockHash: account.block_hash } });
    } catch {
      await ctx.runMutation(internal.operatorWallet.finish, { ...args, failure });
    }
  },
});
