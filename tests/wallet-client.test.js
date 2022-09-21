const { AptosAccount, AptosClient, FaucetClient } = require("aptos");
const { WalletClient } = require("../src/index");
describe("Unit Tests", () => {
  const NODE_URL_DEV = "https://fullnode.devnet.aptoslabs.com/v1";
  const FAUCET_URL_DEV = "https://faucet.devnet.aptoslabs.com";
  const mnemonic =
    "nasty breeze culture wrap cradle fiber guilt mango nurse mimic zone column";
  let walletClient = new WalletClient(NODE_URL_DEV, FAUCET_URL_DEV);
  let client = new AptosClient(NODE_URL_DEV);
  let faucet = new FaucetClient(NODE_URL_DEV, FAUCET_URL_DEV);
  it("create-wallet-client", async () => {
    const { account, mnemonic } = await walletClient.createNewAccount();
    console.log("mnemonic", mnemonic);
    console.log(account.address().toShortString());
  }, 30000);

  it("create-new-account", async () => {
    const { account } = await walletClient.createNewAccount();
    await walletClient.airdrop(account.address());
  }, 30000);
  it("import-account", async () => {
    const account = await walletClient.getAccountFromMnemonic(mnemonic);
    console.log(account.address().toShortString());
  }, 30000);
  it("accountTransactions", async () => {
    const account = await walletClient.getAccountFromMnemonic(mnemonic);
    await walletClient.airdrop(account.address());
    const txns = await walletClient.accountTransactions(account.address());
    console.log(txns);
  }, 30000);
  it("balance", async () => {
    const account = await walletClient.getAccountFromMnemonic(mnemonic);
    await walletClient.airdrop(account.address());
    const balance = await walletClient.balance(account.address());
    console.log(balance);
  }, 30000);
  it("transfer", async () => {
    const account = await walletClient.getAccountFromMnemonic(mnemonic);
    await walletClient.airdrop(account.address());
    const transfer = await walletClient.transfer(
      account,
      "0x1::aptos_coin::AptosCoin",
      "0x71400ddbb1c1cd251f9c6f1ada028db1f209c2a0951eacd14cacbc4faa5d21d0",
      888
    );
    console.log("transfer", transfer);
  }, 30000);
});
