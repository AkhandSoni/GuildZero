// Backend-only SDK adapter. Never import this into browser components.
import { JsonRpcProvider } from "near-api-js";
import { rpc, TESTNET_RPC } from "./rpc";

export function settlementProvider() {
  const provider = new JsonRpcProvider({ url: TESTNET_RPC });
  // SDK convenience methods otherwise perform their own fetches without an
  // AbortSignal. Share the fixed-network, bounded, non-retrying transport.
  provider.sendJsonRpc = (method, params) => rpc(method, params as Record<string, unknown>);
  return provider;
}
