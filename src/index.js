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
    let response = await this.client.getEventsByEventHandle(
      address,
      eventHandleStruct,
      fieldName
    );
    return response;
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
          "0x1::managed_coin",
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
  async offerToken(
    account,
    receiver_address,
    creator_address,
    collection_name,
    token_name,
    amount,
    property_version = 0
  ) {
    return Promise.resolve(
      await this.token.offerToken(
        account,
        receiver_address,
        creator_address,
        collection_name,
        token_name,
        amount,
        property_version
      )
    );
  }
  async cancelTokenOffer(
    account,
    receiver_address,
    creator_address,
    collection_name,
    token_name,
    property_version = 0
  ) {
    return Promise.resolve(
      await this.token.cancelTokenOffer(
        account,
        receiver_address,
        creator_address,
        collection_name,
        token_name,
        property_version
      )
    );
  }
  async claimToken(
    account,
    sender_address,
    creator_address,
    collection_name,
    token_name,
    property_version = 0
  ) {
    return Promise.resolve(
      await this.tokenClient.claimToken(
        account,
        sender_address,
        creator_address,
        collection_name,
        token_name,
        property_version
      )
    );
  }
  async getTokenIds(address) {
    const countDeposit = {};
    const countWithdraw = {};
    const elementsFetched = new Set();
    const tokenIds = [];

    const depositEvents = await this.getEvents(
      address,
      "0x3::token::TokenStore",
      "deposit_events"
    );

    const withdrawEvents = await this.getEvents(
      address,
      "0x3::token::TokenStore",
      "withdraw_events"
    );

    depositEvents.forEach((element) => {
      const elementString = JSON.stringify(element.data.id);
      elementsFetched.add(elementString);
      countDeposit[elementString] = countDeposit[elementString]
        ? {
            count: countDeposit[elementString].count + 1,
            sequence_number: element.sequence_number,
            data: element.data.id,
          }
        : {
            count: 1,
            sequence_number: element.sequence_number,
            data: element.data.id,
          };
    });

    withdrawEvents.forEach((element) => {
      const elementString = JSON.stringify(element.data.id);
      elementsFetched.add(elementString);
      countWithdraw[elementString] = countWithdraw[elementString]
        ? {
            count: countWithdraw[elementString].count + 1,
            sequence_number: element.sequence_number,
            data: element.data.id,
          }
        : {
            count: 1,
            sequence_number: element.sequence_number,
            data: element.data.id,
          };
    });

    if (elementsFetched) {
      Array.from(elementsFetched).forEach((elementString) => {
        const depositEventCount = countDeposit[elementString]
          ? countDeposit[elementString].count
          : 0;
        const withdrawEventCount = countWithdraw[elementString]
          ? countWithdraw[elementString].count
          : 0;
        tokenIds.push({
          data: countDeposit[elementString]
            ? countDeposit[elementString].data
            : countWithdraw[elementString].data,
          deposit_sequence_number: countDeposit[elementString]
            ? countDeposit[elementString].sequence_number
            : 0,
          withdraw_sequence_number: countWithdraw[elementString]
            ? countWithdraw[elementString].sequence_number
            : 0,
          difference: depositEventCount - withdrawEventCount,
        });
      });
    }
    return tokenIds;
  }
  async signAndSubmitTransactions(account, txnRequests) {
    const hashs = [];
    for (const rawTxn of txnRequests) {
      try {
        const txnRequest = await this.client.generateTransaction(
          rawTxn.sender,
          rawTxn.payload,
          rawTxn.options
        );

        const signedTxn = await this.client.signTransaction(
          account,
          txnRequest
        );
        const res = await this.client.submitTransaction(signedTxn);
        await this.client.waitForTransaction(res.hash);
        console.log(res.hash, "completed");
        hashs.push(res.hash);
      } catch (err) {
        hashs.push(err.message);
      }
    }
    return Promise.resolve(hashs);
  }
}

//
//
//
//

const main = async () => {
  const NODE_URL =
    process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com/v1";
  const FAUCET_URL =
    process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";

  const walletClient = new WalletClient(NODE_URL, FAUCET_URL);
  const code =
    "chief expand holiday act crowd wall zone amount surprise confirm grow plastic";
  const account = await walletClient.getAccountFromMnemonic(code);
  // console.log(account);
  // let reg = await walletClient.registerCoin(
  //   account,
  //   "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC"
  // );
  // console.log(reg);

  // let tokenIds = await walletClient.getTokenIds(account.address());
  // tokenIds.forEach((token) => console.log(token.data.token_data_id));
  // console.log("tokenIds", tokenIds);
  // const collectionName = "AntosCollection";
  // const tokenName = "Anto's 001";
  // const txn1 = {
  //   sender: account.address().toShortString(),
  //   payload: {
  //     function: "0x3::token::create_collection_script",
  //     type_arguments: [],
  //     arguments: [
  //       collectionName,
  //       "description",
  //       "https://www.aptos.dev",
  //       12345,
  //       [false, false, false],
  //     ],
  //   },
  // };

  // const txn2 = {
  //   sender: account.address().toShortString(),
  //   payload: {
  //     function: "0x3::token::create_token_script",
  //     type_arguments: [],
  //     arguments: [
  //       collectionName,
  //       tokenName,
  //       "token description",
  //       1,
  //       12345,
  //       "https://aptos.dev/img/nyan.jpeg",
  //       account.address().toShortString(),
  //       0,
  //       0,
  //       [false, false, false, false, false],
  //       [],
  //       [],
  //       [],
  //     ],
  //   },
  // };

  // let txns = await walletClient.signAndSubmitTransactions(account, [
  //   txn1,
  //   txn2,
  // ]);
  // console.log(txns);
  // let gas_estimate = await walletClient.estimateTransfer(
  //   account,
  //   "0xdbbccfe83ae786cf1d3d99053a5d44f6fb4f8d25a6abf63045f454231fcb01b3",
  //   1000
  // );
  // console.log("gas_estimate", gas_estimate);
  // let nftColl = await walletClient.createCollection(
  //   account,
  //   "Anto",
  //   "Anto's NFT",
  //   "Nft Uri"
  // );
  // console.log("nftColl", nftColl);

  // let nftTxn = await walletClient.createToken(
  //   account,
  //   "Anto",
  //   "Anto's 002",
  //   "Kana on Aptos",
  //   10,
  //   "https://www.kanalabs.io/static/media/kana-labs-logo.184851f66aef0526f82c829b55e37b34.svg",
  //   10,
  //   account.address(),
  //   0,
  //   0,
  //   [],
  //   [],
  //   []
  // );
  // console.log("nftTxn", nftTxn);
  // let txns = await walletClient.getAllTransactions(
  //   "0x48133de717f538c53c86392446c209e37c9d069a83826ea0341b2af8c8e604cf",
  //   "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
  // );
  // console.log(txns);
  // const { account, mnemonic } = await walletClient.createNewAccount();
  // console.log(code);
  // const address =
  //   "0x9006e2a49f38e33267e17ba21b2554354fa23913ef90a777891824dc19c5e317";
  // console.log(private);
  // const account = await walletClient.getAccountFromPrivateKey(secret);

  // console.log(account.toPrivateKeyObject().privateKeyHex);

  // let detail = await walletClient.getTransactionDetailsByHash(
  //   "0xa76f4e50b43609b9da3089b1cc7df78bc6d85dfd45051777aa40e8495f2d3ffa"
  // );
  // let detail = await walletClient.getTransactionDetailsByVersion(61483556);
  // console.log(detail);
};
main();
