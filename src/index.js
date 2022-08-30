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
const { HDKey } = require("@scure/bip32");
const fetch = require("cross-fetch");
const { Buffer } = require("buffer/");

const COIN_TYPE = 637;
const MAX_ACCOUNTS = 5;
const ADDRESS_GAP = 10;

export class WalletClient {
  faucet;
  client;
  token;
  constructor(node_url, faucet_url) {
    this.client = new AptosClient(node_url);
    this.token = new TokenClient(this.client);
    this.faucet = new FaucetClient(node_url, faucet_url);
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
      return { account, mnemonic };
    }
    throw new Error("Max no. of accounts reached");
  }
  async initialize(address) {
    let hash = await this.faucet.fundAccount(address, 1000000);
    return hash;
  }
  async balance(address) {
    if (address !== "") {
      let resources = await this.client.getAccountResources(address);
      console.log(resources);
      // Find Aptos coin resource
      let accountResource = resources.find(
        (r) => r.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
      );
      return parseInt(accountResource?.data.coin.value);
    }
  }
  async importWallet(code) {
    let flag = false;
    let address = "";
    let pubKey = "";
    let derivationPath = "";
    let authKey = "";
    let secretKey = "";

    if (!bip39.validateMnemonic(code, english.wordlist)) {
      return Promise.reject(new Error("Incorrect mnemonic passed"));
    }
    const seed = bip39.mnemonicToSeedSync(code.toString());
    const node = HDKey.fromMasterSeed(Buffer.from(seed));
    const accountMetaData = [];
    for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
      flag = false;
      address = "";
      pubKey = "";
      derivationPath = "";
      authKey = "";
      secretKey = "";
      for (let j = 0; j < ADDRESS_GAP; j += 1) {
        /* eslint-disable no-await-in-loop */
        const exKey = node.derive(`m/44'/${COIN_TYPE}'/${i}'/0/${j}`);
        let acc = new AptosAccount(exKey.privateKey);
        if (j === 0) {
          address = acc.authKey().toString();
          pubKey = acc.pubKey().toString();
          secretKey = acc.toPrivateKeyObject();
          const response = await fetch(
            `${this.client.nodeUrl}/accounts/${address}`,
            {
              method: "GET",
            }
          );
          if (response.status === 404) {
            break;
          }
          const respBody = await response.json();
          authKey = respBody.authentication_key;
        }
        acc = new AptosAccount(exKey.privateKey, address);
        if (acc.authKey().toString() === authKey) {
          flag = true;
          derivationPath = `m/44'/${COIN_TYPE}'/${i}'/0/${j}`;
          break;
        }
        /* eslint-enable no-await-in-loop */
      }
      if (!flag) {
        break;
      }
      accountMetaData.push({
        derivationPath,
        address,
        pubKey,
        secretKey,
      });
    }
    console.log("code :", code);
    console.log("accounts", accountMetaData);
    return { code, accounts: accountMetaData };
  }
  async getAccountFromMnemonic(code) {
    return AptosAccount.fromDerivePath(`m/44'/${COIN_TYPE}'/0'/0'/0'`, code);
  }
  async getAccountFromPrivateKey(privateKey, address) {
    return new AptosAccount(privateKey, address);
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
  async getTransactionDetails(version) {
    // https://fullnode.devnet.aptoslabs.com/transactions/19957514
    let endpointUrl = `${this.client.nodeUrl}/transactions/${version}/`;
    const response = await fetch(endpointUrl, {
      method: "GET",
    });

    if (response.status === 404) {
      return [];
    }
    let res = response.json();
    return res;
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
}
// const main = async () => {
//   const NODE_URL =
//     process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com";
//   const FAUCET_URL =
//     process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";

//   const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
// const account = await walletClient.createNewAccount();
// const code =
//   "awful punch pact rapid south robust subject hockey bomb panel arctic flat";
// console.log(code);
// const account = await walletClient.getAccountFromMnemonic(code);
// const address =
//   "0x9006e2a49f38e33267e17ba21b2554354fa23913ef90a777891824dc19c5e317";
// const secret = new Uint8Array(64)[
//   (95,
//   108,
//   76,
//   197,
//   88,
//   243,
//   86,
//   255,
//   9,
//   16,
//   185,
//   213,
//   192,
//   138,
//   234,
//   96,
//   228,
//   25,
//   216,
//   126,
//   180,
//   161,
//   238,
//   123,
//   200,
//   229,
//   124,
//   145,
//   75,
//   142,
//   179,
//   156,
//   47,
//   172,
//   102,
//   183,
//   40,
//   128,
//   75,
//   101,
//   21,
//   157,
//   231,
//   159,
//   8,
//   168,
//   118,
//   208,
//   181,
//   102,
//   9,
//   121,
//   125,
//   220,
//   31,
//   246,
//   5,
//   201,
//   121,
//   112,
//   38,
//   142,
//   159,
//   200)
// ];
// const private = new Uint8Array(secret);
// console.log(private);
// const account = await walletClient.getAccountFromPrivateKey(secret, address);
// console.log(account.address().toShortString());
// };
// main();
