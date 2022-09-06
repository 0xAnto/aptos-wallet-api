const {
  AptosAccount,
  AptosClient,
  FaucetClient,
  BCS,
  TxnBuilderTypes,
  HexString,
  TokenClient,
} = require("aptos");
const bip39 = require("@scure/bip39");
const english = require("@scure/bip39/wordlists/english");
const fetch = require("cross-fetch");

const COIN_TYPE = 637;
const MAX_ACCOUNTS = 5;
const MAX_U64_BIG_INT = BigInt(2 ** 64) - 1n;

class WalletClient {
  faucet;
  client;
  token;
  nodeUrl;
  constructor(node_url, faucet_url) {
    this.client = new AptosClient(node_url);
    this.token = new TokenClient(this.client);
    this.faucet = new FaucetClient(node_url, faucet_url);
    this.nodeUrl = node_url;
  }
  async airdrop(address) {
    return Promise.resolve(
      await this.faucet.fundAccount(address, 1_000_000000)
    );
  }
  async createNewAccount() {
    const mnemonic = bip39.generateMnemonic(english.wordlist);
    console.log(mnemonic);
    for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
      const derivationPath = `m/44'/${COIN_TYPE}'/${i}'/0'/0'`;
      const account = AptosAccount.fromDerivePath(derivationPath, mnemonic);
      const address = HexString.ensure(account.address()).toShortString();
      const response = await fetch(`${this.nodeUrl}/accounts/${address}`, {
        method: "GET",
      });
      if (response.status === 404) {
        await this.faucet.fundAccount(address, 0);
        return {
          account,
          mnemonic,
        };
      }
    }
    throw new Error("Max no. of accounts reached");
  }
  async balance(coinType, address) {
    if (address !== "") {
      // coinType like 0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>
      let resources = await this.client.getAccountResources(address);
      let accountResource = resources.find((r) => r.type === coinType);
      return parseInt(accountResource?.data.coin.value);
    }
  }
  async getAccountFromMnemonic(code) {
    return AptosAccount.fromDerivePath(`m/44'/${COIN_TYPE}'/0'/0'/0'`, code);
  }
  async accountTransactions(accountAddress) {
    const data = await this.client.getAccountTransactions(accountAddress);
    const transactions = data.map((item) => ({
      data: item.payload,
      from: item.sender,
      gas: item.gas_used,
      gasPrice: item.gas_unit_price,
      hash: item.hash,
      success: item.success,
      timestamp: item.timestamp,
      toAddress: item.payload.arguments[0],
      price: item.payload.arguments[1],
      type: item.type,
      version: item.version,
      vmStatus: item.vm_status,
    }));
    return transactions;
  }
  async transfer(account, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const token = new TxnBuilderTypes.TypeTagStruct(
        TxnBuilderTypes.StructTag.fromString("0x1::aptos_coin::AptosCoin")
      );
      const entryFunctionPayload =
        new TxnBuilderTypes.TransactionPayloadEntryFunction(
          TxnBuilderTypes.EntryFunction.natural(
            "0x1::coin",
            "transfer",
            [token],
            [
              BCS.bcsToBytes(
                TxnBuilderTypes.AccountAddress.fromHex(
                  HexString.ensure(recipient_address).toString()
                )
              ),
              BCS.bcsSerializeUint64(amount),
            ]
          )
        );

      const rawTxn = await this.client.generateRawTransaction(
        account.address(),
        entryFunctionPayload
      );

      const bcsTxn = AptosClient.generateBCSTransaction(account, rawTxn);
      const transactionRes = await this.client.submitSignedBCSTransaction(
        bcsTxn
      );

      await this.client.waitForTransaction(transactionRes.hash);
      return await Promise.resolve(transactionRes.hash);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async estimateGasUsage(account, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const token = new TxnBuilderTypes.TypeTagStruct(
        TxnBuilderTypes.StructTag.fromString("0x1::aptos_coin::AptosCoin")
      );
      const entryFunctionPayload =
        new TxnBuilderTypes.TransactionPayloadEntryFunction(
          TxnBuilderTypes.EntryFunction.natural(
            "0x1::coin",
            "transfer",
            [token],
            [
              BCS.bcsToBytes(
                TxnBuilderTypes.AccountAddress.fromHex(
                  HexString.ensure(recipient_address).toString()
                )
              ),
              BCS.bcsSerializeUint64(amount),
            ]
          )
        );
      const rawTxn = await this.client.generateRawTransaction(
        account.address(),
        entryFunctionPayload
      );
      const simulateResponse = await this.client.simulateTransaction(
        account,
        rawTxn
      );
      return simulateResponse[0].gas_used;
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getEvents(address, eventHandleStruct, fieldName) {
    let resn = await this.client.getEventsByEventHandle(
      address,
      eventHandleStruct,
      fieldName
    );
    return resn;
  }
  async getAllTransactions(address, coin) {
    let transactions = [];
    let withdrawals = await this.getEvents(address, coin, "withdraw_events");
    let deposits = await this.getEvents(address, coin, "deposit_events");
    transactions.push(...withdrawals, ...deposits);
    let sortedTransactions = transactions.sort((a, b) => {
      return b.version - a.version;
    });
    return sortedTransactions;
  }
  async getTransactionDetailsByVersion(version) {
    return Promise.resolve(await this.client.getTransactionByVersion(version));
  }
  async getTransactionDetailsByHash(hash) {
    return Promise.resolve(await this.client.getTransactionByHash(hash));
  }
  async registerCoin(account, coin_type_path) {
    console.log("account, coin_type_path", account, coin_type_path);
    const token = new TxnBuilderTypes.TypeTagStruct(
      TxnBuilderTypes.StructTag.fromString(coin_type_path)
    );

    const entryFunctionPayload =
      new TxnBuilderTypes.TransactionPayloadEntryFunction(
        TxnBuilderTypes.EntryFunction.natural(
          "0x1::coins",
          "register",
          [token],
          []
        )
      );

    const rawTxn = await this.client.generateRawTransaction(
      account.address(),
      entryFunctionPayload
    );

    const bcsTxn = AptosClient.generateBCSTransaction(account, rawTxn);
    const transactionRes = await this.client.submitSignedBCSTransaction(bcsTxn);
    await this.client.waitForTransaction(transactionRes.hash);
    const resp = await this.client.getTransactionByHash(transactionRes.hash);
    const status = { success: resp.success, vm_status: resp.vm_status };
    const txnHash = transactionRes.hash;
    return { txnHash, ...status };
  }
  async createCollection(account, name, description, uri) {
    return Promise.resolve(
      await this.token.createCollection(account, name, description, uri)
    );
  }
  async createToken(
    account,
    collection_name,
    name,
    description,
    supply,
    uri,
    max = MAX_U64_BIG_INT,
    royalty_payee_address = account.address(),
    royalty_points_denominator = 0,
    royalty_points_numerator = 0,
    property_keys = [],
    property_values = [],
    property_types = []
  ) {
    return Promise.resolve(
      await this.token.createToken(
        account,
        collection_name,
        name,
        description,
        supply,
        uri,
        max,
        royalty_payee_address,
        royalty_points_denominator,
        royalty_points_numerator,
        property_keys,
        property_values,
        property_types
      )
    );
  }
}

// const main = async () => {
//   const NODE_URL =
//     process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com/v1";
//   const FAUCET_URL =
//     process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";

//   const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
//   const code =
//     "chief expand holiday act crowd wall zone amount surprise confirm grow plastic";
//   const account = await walletClient.getAccountFromMnemonic(code);
//   console.log(account.address());

//   // let gas_estimate = await walletClient.estimateTransfer(
//   //   account,
//   //   "0xdbbccfe83ae786cf1d3d99053a5d44f6fb4f8d25a6abf63045f454231fcb01b3",
//   //   1000
//   // );
//   // console.log("gas_estimate", gas_estimate);
//   // let nftColl = await walletClient.createCollection(
//   //   account,
//   //   "Anto",
//   //   "Anto's NFT",
//   //   "Nft Uri"
//   // );
//   // console.log("nftColl", nftColl);

//   // let nftTxn = await walletClient.createToken(
//   //   account,
//   //   "Anto",
//   //   "Anto's 001",
//   //   "First NFT on Aptos",
//   //   10,
//   //   "NFT Uri",
//   //   10,
//   //   account.address(),
//   //   0,
//   //   0,
//   //   [],
//   //   [],
//   //   []
//   // );
//   // console.log("nftTxn", nftTxn);
//   // let txns = await walletClient.getAllTransactions(
//   //   "0x48133de717f538c53c86392446c209e37c9d069a83826ea0341b2af8c8e604cf",
//   //   "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
//   // );
//   // console.log(txns);
//   // const { account, mnemonic } = await walletClient.createNewAccount();
//   // console.log(code);
//   // const address =
//   //   "0x9006e2a49f38e33267e17ba21b2554354fa23913ef90a777891824dc19c5e317";
//   // console.log(private);
//   // const account = await walletClient.getAccountFromPrivateKey(secret);

//   // console.log(account.toPrivateKeyObject().privateKeyHex);

//   // let detail = await walletClient.getTransactionDetailsByHash(
//   //   "0xa76f4e50b43609b9da3089b1cc7df78bc6d85dfd45051777aa40e8495f2d3ffa"
//   // );
//   // let detail = await walletClient.getTransactionDetailsByVersion(61483556);
//   // console.log(detail);
// };
// main();
