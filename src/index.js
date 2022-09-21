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

  /**
   * Creates a new account with new seed phrase
   *
   * @param
   * @returns AptosAccount object, mnemonic
   */
  async createNewAccount() {
    const mnemonic = bip39.generateMnemonic(english.wordlist);
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

  /**
   * returns all tokens available in the account with their balance
   *
   * @param address address of the account
   * @returns list of tokens with their balance
   */
  async balance(address) {
    if (address !== "") {
      let coinStoreType = "0x1::coin::CoinStore";
      let balances = [];
      let resources = await this.client.getAccountResources(address);
      let coinResources = resources.filter((r) =>
        r.type.startsWith(coinStoreType)
      );
      coinResources.forEach((resource) =>
        balances.push({
          coin: resource?.type,
          value: resource?.data?.coin?.value,
        })
      );
      return balances;
    }
  }

  /**
   * airdrops test coins in the given account
   *
   * @param address address of the receiver's account
   * @returns
   */
  async airdrop(address) {
    return Promise.resolve(
      await this.faucet.fundAccount(address, 1_00_000_000)
    );
  }

  /**
   * returns an AptosAccount at position m/44'/COIN_TYPE'/0'/0/0
   *
   * @param code mnemonic phrase of the wallet
   * @returns AptosAccount object
   */
  async getAccountFromMnemonic(code) {
    return AptosAccount.fromDerivePath(`m/44'/${COIN_TYPE}'/0'/0'/0'`, code);
  }

  /**
   * returns the list of on-chain transactions sent by the said account
   *
   * @param accountAddress address of the desired account
   * @returns list of transactions
   */
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

  /**
   * transfers Coins from signer to receiver
   *
   * @param account AptosAccount object of the signing account
   * @param coinType you need to transfer
   * @param recipient_address address of the receiver account
   * @param amount amount of aptos coins to be transferred
   * @returns transaction hash
   */
  async transfer(account, coinType, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const token = new TxnBuilderTypes.TypeTagStruct(
        TxnBuilderTypes.StructTag.fromString(coinType)
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

  // Estimate gas fee for given transaction
  async estimateGasUsage(account, coinType, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const token = new TxnBuilderTypes.TypeTagStruct(
        TxnBuilderTypes.StructTag.fromString(coinType)
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

  // Signs the raw transaction
  async signTransaction(account, txnRequest) {
    return Promise.resolve(
      await this.client.signTransaction(account, txnRequest)
    );
  }

  // Submits the signed transaction
  async submitTransaction(signedTxn) {
    return Promise.resolve(await this.client.submitTransaction(signedTxn));
  }

  // sign and submit multiple transactions
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
        hashs.push(res.hash);
      } catch (err) {
        hashs.push(err.message);
      }
    }
    return Promise.resolve(hashs);
  }

  // signs the given message
  async signMessage(account, message) {
    return Promise.resolve(account.signBuffer(Buffer.from(message)).hex());
  }

  /**
   * returns the list of events
   *
   * @param address address of the desired account
   * @param eventHandleStruct struct name
   * @param fieldName event Name
   * @returns list of events
   */
  async getEvents(address, eventHandleStruct, fieldName) {
    let response = await this.client.getEventsByEventHandle(
      address,
      eventHandleStruct,
      fieldName
    );
    return response;
  }

  /**
   * returns the list of transactions from the account
   *
   * @param address address of the desired account
   * @returns list of events
   */
  async getAllTransactions(address) {
    let coins = [];
    let transactions = [];
    let coinStoreType = "0x1::coin::CoinStore";
    let resources = await this.client.getAccountResources(address);
    let coinResources = resources.filter((r) =>
      r.type.startsWith(coinStoreType)
    );
    coinResources.forEach((resource) => coins.push(resource?.type));
    for await (const coin of coins) {
      let withdrawals = await this.getEvents(address, coin, "withdraw_events");
      let deposits = await this.getEvents(address, coin, "deposit_events");
      transactions.push(...withdrawals, ...deposits);
    }
    let sortedTransactions = transactions.sort((a, b) => {
      return b.version - a.version;
    });
    return sortedTransactions;
  }

  // Return the Transaaction details by version
  async getTransactionDetailsByVersion(version) {
    return Promise.resolve(await this.client.getTransactionByVersion(version));
  }

  // Return the Transaaction details by hash
  async getTransactionDetailsByHash(hash) {
    return Promise.resolve(await this.client.getTransactionByHash(hash));
  }

  // Registers a new coin
  async registerCoin(account, coin_type_path) {
    const entryFunctionPayload = {
      arguments: [],
      function: "0x1::managed_coin::register",
      type: "entry_function_payload",
      type_arguments: [coin_type_path],
    };
    console.log("entryFunctionPayload", entryFunctionPayload);

    const txnRequest = await this.client.generateTransaction(
      account.address(),
      entryFunctionPayload,
      {
        max_gas_amount: "4000",
        gas_unit_price: "100",
      }
    );
    // console.log("txnRequest :", txnRequest);
    const signedTxn = await this.client.signTransaction(account, txnRequest);
    // // console.log("signedTxn :", signedTxn);
    const transactionRes = await this.client.submitTransaction(signedTxn);
    await this.client.waitForTransaction(transactionRes.hash);
    const resp = await this.client.getTransactionByHash(transactionRes.hash);
    const status = { success: resp.success, vm_status: resp.vm_status };
    const txnHash = transactionRes.hash;
    return { txnHash, ...status };
  }

  /**
   * creates an NFT collection
   *
   * @param account AptosAccount object of the signing account
   * @param name collection name
   * @param description collection description
   * @param uri collection URI
   * @returns transaction hash
   */
  async createCollection(account, name, description, uri) {
    return Promise.resolve(
      await this.token.createCollection(account, name, description, uri)
    );
  }

  /**
   * creates an NFT
   *
   * @param account AptosAccount object of the signing account
   * @param collection_name collection name
   * @param name NFT name
   * @param description NFT description
   * @param supply supply for the NFT
   * @param uri NFT URI
   * @param royalty_points_per_million royalty points per million
   * @returns transaction hash
   */
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

  /**
   * offers an NFT to another account
   *
   * @param account AptosAccount object of the signing account
   * @param receiver_address address of the receiver account
   * @param creator_address address of the creator account
   * @param collection_name collection name
   * @param token_name NFT name
   * @param amount amount to receive while offering the token
   * @returns transaction hash
   */
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

  /**
   * claims offered NFT
   *
   * @param account AptosAccount of the signing account
   * @param sender_address address of the sender account
   * @param creator_address address of the creator account
   * @param collection_name collection name
   * @param token_name NFT name
   * @returns transaction hash
   */
  async claimToken(
    account,
    sender_address,
    creator_address,
    collection_name,
    token_name,
    property_version = 0
  ) {
    return Promise.resolve(
      await this.token.claimToken(
        account,
        sender_address,
        creator_address,
        collection_name,
        token_name,
        property_version
      )
    );
  }

  /**
   * cancels an NFT offer
   *
   * @param account AptosAccount of the signing account
   * @param receiver_address address of the receiver account
   * @param creator_address address of the creator account
   * @param collection_name collection name
   * @param token_name NFT name
   * @returns transaction hash
   */
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

  // get NFT IDs of the address
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

  /**
   * returns the token information (including the collection information)
   * about a said tokenID
   *
   * @param tokenId token ID of the desired token
   * @returns token information
   */
  async getToken(tokenId, resourceHandle) {
    let accountResource;
    if (!resourceHandle) {
      const resources = await this.client.getAccountResources(
        tokenId.token_data_id.creator
      );
      accountResource = resources.find(
        (r) => r.type === "0x3::token::Collections"
      );
    }

    const tableItemRequest = {
      key_type: "0x3::token::TokenDataId",
      value_type: "0x3::token::TokenData",
      key: tokenId.token_data_id,
    };
    const token = await this.client.getTableItem(
      resourceHandle || accountResource.data.token_data.handle,
      tableItemRequest
    );
    token.collection = tokenId.token_data_id.collection;
    return token;
  }
}

module.exports = {
  WalletClient,
};

//
//
//
//

// const main = async (netwotk) => {
//   let walletClient;
//   const NODE_URL_TEST = "https://fullnode.testnet.aptoslabs.com/v1";
//   const FAUCET_URL_TEST = "https://faucet.testnet.aptoslabs.com.";
//   const NODE_URL_DEV =
//     process.env.APTOS_NODE_URL || "https://fullnode.devnet.aptoslabs.com/v1";
//   const FAUCET_URL_DEV =
//     process.env.APTOS_FAUCET_URL || "https://faucet.devnet.aptoslabs.com";
//   if (netwotk === "devnet") {
//     walletClient = new WalletClient(NODE_URL_DEV, FAUCET_URL_DEV);
//   } else if (netwotk === "testnet") {
//     walletClient = new WalletClient(NODE_URL_TEST, FAUCET_URL_TEST);
//   }
//   // console.log("walletClient", walletClient);
//   const { account, mnemonic } = await walletClient.createNewAccount();
//   // console.log(mnemonic, account);
//   let client = new AptosClient(NODE_URL_DEV);
//   let faucet = new FaucetClient(NODE_URL_DEV, FAUCET_URL_DEV);
//   await faucet.fundAccount(account.address(), 1000000);
//   // const code =
//   //   "chief expand holiday act crowd wall zone amount surprise confirm grow plastic";
//   // const account = await walletClient.getAccountFromMnemonic(code);
//   console.log(account.address().toShortString());
//   // await walletClient.airdrop(account.address());

//   // let txPayload = {
//   //   arguments: [],
//   //   function: "0x1::managed_coin::register",
//   //   type: "entry_function_payload",
//   //   type_arguments: [
//   //     "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC",
//   //   ],
//   // };
//   // const txnRequest = await client.generateTransaction(
//   //   account.address(),
//   //   txPayload,
//   //   {
//   //     max_gas_amount: "1000",
//   //     gas_unit_price: "100",
//   //   }
//   // );
//   // console.log("txnRequest :", txnRequest);
//   // let reg = await walletClient.registerCoin(
//   //   account,
//   //   "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDT"
//   // );
//   // console.log(reg);
//   // const signedTxn = await client.signTransaction(account, txnRequest);
//   // // console.log("signedTxn :", signedTxn);
//   // const res = await client.submitTransaction(signedTxn);
//   // await client.waitForTransactionWithResult(res.hash);
//   // console.log(res);
//   // const rawTxn = await client.generateRawTransaction(
//   //   account.address(),
//   //   txPayload
//   // );
//   // console.log("rawTxn", rawTxn);
//   // const bcsTxn = AptosClient.generateBCSTransaction(account, rawTxn);
//   // const transactionRes = await client.submitSignedBCSTransaction(bcsTxn);
//   // await client.waitForTransactionWithResult(transactionRes.hash);
//   // console.log("transactionRes", transactionRes);
//   // console.log(res);
//   // console.log("transactionRes", transactionRes);
//   // const txnRequest = await client.generateRawTransaction(
//   //   account.address(),
//   //   txPayload,
//   //   {
//   //     maxGasAmount: "1000",
//   //     gasUnitPrice: "100",
//   //     expireTimestamp: Math.floor(Date.now() / 1e3) + 20,
//   //   }
//   // );
//   // //   account.address(),
//   // //   txPayload,
//   // //   {
//   // //     max_gas_amount: "10000",
//   // //     gas_unit_price: "100",
//   // //   }
//   // // );
//   // console.log("txnRequest :", txnRequest);
//   // const signedTxn = await client.signTransaction(account, txnRequest);
//   // // // // console.log("signedTxn :", signedTxn);
//   // const res = await client.submitTransaction(signedTxn);
//   // await client.waitForTransactionWithResult(res.hash);
//   // console.log(res);
//   // let reg1 = await walletClient.registerCoin(
//   //   account,
//   //   "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDT"
//   // );
//   // console.log(reg1);
//   // let bal = await walletClient.balance(account.address());
//   // console.log("bal", bal);
//   // let tokenIds = await walletClient.getTokenIds(account.address());
//   // tokenIds.forEach((token) => console.log(token.data));
//   // console.log("token creator", tokenIds[0].data.token_data_id.creator);
//   // console.log("tokenIds", tokenIds);
//   // let token = await walletClient.getToken(tokenIds[0].data);
//   // console.log("token", token);
//   // const collectionName = "AntosCollection";
//   // const tokenName = "Anto's 001";
//   // const txn1 = {
//   //   sender: account.address().toShortString(),
//   //   payload: {
//   //     arguments: [],
//   //     function: "0x1::managed_coin::register",
//   //     type: "entry_function_payload",
//   //     type_arguments: [
//   //       "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC",
//   //     ],
//   //   },
//   // };

//   // const txn2 = {
//   //   sender: account.address().toShortString(),
//   //   payload: {
//   //     arguments: [],
//   //     function: "0x1::managed_coin::register",
//   //     type: "entry_function_payload",
//   //     type_arguments: [
//   //       "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::USDT",
//   //     ],
//   //   },
//   // };

//   // let offerNFT = await walletClient.offerToken(
//   //   account,
//   //   "0xaf24a60cf1908918cb7ea621db0991052a5e0630c14529e3ae61a7f978b51c46",
//   //   "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699",
//   //   "Anto",
//   //   "Anto's 001",
//   //   1
//   // );
//   // console.log("offerNFT", offerNFT);
//   // let claimNFT = await walletClient.claimToken(
//   //   account, // Receiver account
//   //   "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699", // Who offered the NFT
//   //   "0x82b94c0423cf25f6a58589f992390ec917eec0945198d9031c10cd79cedb6699", // Creator of the NFT
//   //   "Anto", // Collection Name
//   //   "Anto's 001" // NFT name
//   // );
//   // console.log("claimNFT", claimNFT);
//   // let txns = await walletClient.signAndSubmitTransactions(account, [
//   //   txn1,
//   //   txn2,
//   // ]);
//   // console.log(txns);
//   // let gas_usage = await walletClient.estimateGasUsage(
//   //   account,
//   //   "0x43417434fd869edee76cca2a4d2301e528a1551b1d719b75c350c3c97d15b8b9::coins::BTC",
//   //   "0xdbbccfe83ae786cf1d3d99053a5d44f6fb4f8d25a6abf63045f454231fcb01b3",
//   //   1000
//   // );
//   // console.log("gas_usage", gas_usage);
//   // let nftCollection = await walletClient.createCollection(
//   //   account,
//   //   "Anto",
//   //   "Anto's NFT",
//   //   "https://twitter.com/0xAnto"
//   // );
//   // console.log("nftCollection", nftCollection);

//   // let mintNFT = await walletClient.createToken(
//   //   account,
//   //   "Anto",
//   //   "Anto's 001",
//   //   "Antos Aptos",
//   //   1000,
//   //   "https://twitter.com/0xAnto/photo",
//   //   1000,
//   //   account.address(),
//   //   10,
//   //   1,
//   //   [],
//   //   [],
//   //   []
//   // );
//   // console.log("mintNFT", mintNFT);
//   // let txns = await walletClient.getAllTransactions(
//   //   account.address(),
//   //   "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
//   // );
//   // console.log(txns);
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
//   // let transfer = await walletClient.transfer(
//   //   account,
//   //   "0x1::aptos_coin::AptosCoin",
//   //   "0x71400ddbb1c1cd251f9c6f1ada028db1f209c2a0951eacd14cacbc4faa5d21d0",
//   //   888
//   // );
//   // console.log("transfer", transfer);
//   // let signedMessage = await walletClient.signMessage(account, "Hello World");
//   // console.log("signedMessage", signedMessage);
// };
// main("devnet");
// main("testnet");
