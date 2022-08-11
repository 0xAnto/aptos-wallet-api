# Aptos Wallet Api
### Initialize WalletClient
```
const NODE_URL =
  process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com";
const FAUCET_URL =
  process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";

const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
```
