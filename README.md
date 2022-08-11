# Aptos Wallet Api
### Initialize WalletClient
```
const NODE_URL =
  process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com";
const FAUCET_URL =
  process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";

const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
```
### Cteate New Account 
```
  let { account, mnemonic } = await walletClient.createNewAccount();
```
### Check Balance
```
  let balance = await walletClient.balance(addr1);
 ```
 ### Send Token
 ```
  let txnHash = await walletClient.sendToken(fromAccount, toAddress, sendAmount);
 ```
 ### Import Account
 ```
  let account = await walletClient.getAccountFromMnemonic(seed);
 ```
 ### Account Transactions
 ```
  let txns = await walletClient.accountTransactions(address);
  ```
