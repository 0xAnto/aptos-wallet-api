# Aptos Wallet Client Api

A light weight wallet client built for aptos blockchain

## Installation

```bash
npm i aptos-wallet-api
```

## Usage

```bash
const WalletClient = require("aptos-wallet-api/src/wallet-client");
```

### Initialize WalletClient

```bash
const NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
const FAUCET_URL = "https://faucet.net.aptoslabs.com";

const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
```

### Cteate New Account

```bash
  const { mnemonic, account } = await walletClient.createNewAccount();
```

### Check Balance

```bash
  let balance = await walletClient.balance(account.address());
```

### Airdrop

```bash
 await walletClient.airdrop(account.address());
```

### Import Account from Mnemonic

```bash
  const account = await walletClient.getAccountFromMnemonic(mnemonic);
```

### Send Token

```bash
 let transfer = await walletClient.transfer(
    account,
    "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC",
    "0x225f4210302db0bba77c212287ea73ef16586d3f48c7384030b4215861bd2283",
    300000
  );
```

### Estimate gas usage

```bash
 let gasUsage = await walletClient.estimateGasUsage(
    account,
    "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC",
    "0xdbbccfe83ae786cf1d3d99053a5d44f6fb4f8d25a6abf63045f454231fcb01b3",
    1000
  );
```

### Register new coin

```bash
let register = await walletClient.registerCoin(
    account,
    "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC"
  );
```

### Create a new NFT Collection

```bash
let nftCollection = await walletClient.createCollection(
    account,
    "Anto",
    "Anto's NFT",
    "<Your Nft Uri>"
  );
```

### Mint a NFT

```bash
let mintNFT = await walletClient.createToken(
    account,
    "Anto",
    "Anto's 001",
    "Anto on Aptos",
    10,
    "https://www.kanalabs.io/static/media/kana-labs-logo.184851f66aef0526f82c829b55e37b34.svg",
    10,
    account.address(),
    0,
    0,
    [],
    [],
    []
  );
```

### Offer NFT

```bash
  let offerNFT = await walletClient.offerToken(
    account,
    "0xef1f3c9e962a06f84b5d6e169dc8ecd490f0a54bab62d95fc7113da8e003fc0b",
    "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699",
    "Anto",
    "Anto's 001",
    1
  );
```

### Claim NFT

```bash
  let claimNFT = await walletClient.claimToken(
    account, // Receiver account
    "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699", // Who offered the NFT
    "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699", // Creator of the NFT
    "Anto", // Collection Name
    "Anto's 001" // NFT name
  );
```

### Get NFT IDs

```bash
  let tokenIds = await walletClient.getTokenIds(account.address());
```

### Get NFT Data

```bash
  let token = await walletClient.getToken(tokenId.data);
```

### Get Transaction Details by Hash

```bash
 let detail = await walletClient.getTransactionDetailsByHash(
    "0xa76f4e50b43609b9da3089b1cc7df78bc6d85dfd45051777aa40e8495f2d3ffa"
  );
```

### Get Transaction Details by Version

```bash
  let detail = await walletClient.getTransactionDetailsByVersion(61483556);
```

### Account Transactions

```bash
 let txns = await walletClient.getAllTransactions(address);
```
