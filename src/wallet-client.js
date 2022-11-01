const {
  AptosAccount,
  AptosClient,
  FaucetClient,
  TokenClient,
} = require("aptos");
const bip39 = require("@scure/bip39");
const { wordlist } = require("@scure/bip39/wordlists/english");
const fetch = require("cross-fetch");

const COIN_TYPE = 637;
const MAX_U64_BIG_INT = BigInt(2 ** 64) - 1n;

module.exports = class WalletClient {
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
    try {
      const mnemonic = bip39.generateMnemonic(wordlist);
      const derivationPath = `m/44'/${COIN_TYPE}'/0'/0'/0'`;
      const account = AptosAccount.fromDerivePath(derivationPath, mnemonic);
      return {
        success: true,
        account,
      };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * returns an AptosAccount at position m/44'/COIN_TYPE'/0'/0/0
   *
   * @param code mnemonic phrase of the wallet
   * @param derivationValue derivation path value
   * @returns AptosAccount object
   */

  async getAccountFromMnemonic(mnemonic, derivationValue) {
    try {
      let isValid = bip39.validateMnemonic(mnemonic, wordlist);
      if (!isValid) {
        return Promise.resolve({
          success: false,
          data: "Invalid Seed Phrase",
        });
      }
      const derivationPath = `m/44'/${COIN_TYPE}'/${derivationValue}'/0'/0'`;
      const data = AptosAccount.fromDerivePath(derivationPath, mnemonic);
      return Promise.resolve({ success: true, data });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * returns all tokens available in the account with their balance
   *
   * @param address address of the account
   * @returns list of tokens with their balance
   */
  async balance(address) {
    try {
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
        return {
          success: true,
          balances,
        };
      }
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * checks if the coinType is valid and return coinInfo
   * @param coinType Resource type
   * @returns coinInfo
   */
  async getCoinInfo(coinType) {
    try {
      let address = coinType.split("::")[0];
      let coinInfoType = `0x1::coin::CoinInfo<${coinType}>`;
      let resource = await this.client.getAccountResource(
        address,
        coinInfoType
      );
      return {
        success: true,
        coinInfo: resource.data,
      };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }
  /**
   * checks if the receiver has the resource or not
   * @param receiver_address receiver address
   * @param coin resourece type
   * @returns bool
   */
  async verifyResource(address, coin) {
    try {
      if (address !== "") {
        let coinStoreType = "0x1::coin::CoinStore";
        let isRegistered = false;
        let resources = await this.client.getAccountResources(address);
        let coinResources = resources.filter((r) =>
          r.type.startsWith(coinStoreType)
        );
        coinResources.forEach((resource) => {
          if (resource.type.includes(coin)) {
            isRegistered = true;
            return;
          }
        });
        return { success: true, isRegistered };
      } else return { success: false, Error: "Address can not be empty" };
    } catch (err) {
      return {
        success: false,
        error: JSON.parse(err.message).error_code,
      };
    }
  }

  /**
   * airdrops test coins in the given account
   *
   * @param address address of the receiver's account
   * @returns
   */
  async airdrop(address) {
    try {
      let hash = await this.faucet.fundAccount(address, 1_00_000_000);
      return {
        success: true,
        hash,
      };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * returns the list of on-chain transactions sent by the said account
   *
   * @param accountAddress address of the desired account
   * @returns list of transactions
   */
  async accountTransactions(accountAddress) {
    try {
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
      return { success: true, transactions };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * transfers Aptos Coins from signer to receiver
   *
   * @param account AptosAccount object of the signing account
   * @param recipient_address address of the receiver account
   * @param amount amount of aptos coins to be transferred
   * @returns transaction hash
   */
  async aptosTransfer(account, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }

      const payload = {
        function: "0x1::aptos_account::transfer",
        type_arguments: [],
        arguments: [recipient_address, amount],
      };

      const rawTxn = await this.client.generateTransaction(
        account.address(),
        payload,
        {
          max_gas_amount: "50000",
          gas_unit_price: "100",
        }
      );
      const signedTxn = await this.client.signTransaction(account, rawTxn);
      const transaction = await this.client.submitTransaction(signedTxn);
      await this.client.waitForTransaction(transaction.hash);

      return { success: true, hash: transaction.hash };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
  async transfer(account, coin, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const payload = {
        function: "0x1::coin::transfer",
        type_arguments: [`${coin}`],
        arguments: [recipient_address, amount],
      };

      const rawTxn = await this.client.generateTransaction(
        account.address(),
        payload,
        {
          max_gas_amount: "50000",
          gas_unit_price: "100",
        }
      );

      const signedTxn = await this.client.signTransaction(account, rawTxn);
      const transaction = await this.client.submitTransaction(signedTxn);
      await this.client.waitForTransaction(transaction.hash);
      return { success: true, hash: transaction.hash };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Estimate gas fee for given transaction
  async estimateGasUsage(account, coin, recipient_address, amount) {
    try {
      if (recipient_address.toString() === account.address().toString()) {
        return new Error("cannot transfer coins to self");
      }
      const payload = {
        function: "0x1::coin::transfer",
        type_arguments: [`${coin}`],
        arguments: [recipient_address, amount],
      };

      const rawTxn = await this.client.generateTransaction(
        account.address(),
        payload,
        {
          max_gas_amount: "50000",
          gas_unit_price: "100",
        }
      );
      const simulateResponse = await this.client.simulateTransaction(
        account,
        rawTxn
      );
      return { success: true, gas_used: simulateResponse[0].gas_used };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Signs the raw transaction
  async signTransaction(account, txnRequest) {
    try {
      return Promise.resolve(
        await this.client.signTransaction(account, txnRequest)
      );
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Submits the signed transaction
  async submitTransaction(signedTxn) {
    try {
      return Promise.resolve(await this.client.submitTransaction(signedTxn));
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // sign and submit a transaction
  async signAndSubmitTransaction(account, txnRequest) {
    const request = await this.client.generateTransaction(
      txnRequest.sender,
      txnRequest.payload,
      {
        max_gas_amount: "50000",
        gas_unit_price: "100",
      }
    );
    const signedTxn = await this.client.signTransaction(account, request);
    const res = await this.client.submitTransaction(signedTxn);
    await this.client.waitForTransaction(res.hash);
    return Promise.resolve(res.hash);
  }

  // sign and submit multiple transactions
  async signAndSubmitTransactions(account, txnRequests) {
    try {
      const hashs = [];
      for (const rawTxn of txnRequests) {
        try {
          const txnRequest = await this.client.generateTransaction(
            rawTxn.sender,
            rawTxn.payload,
            {
              max_gas_amount: "50000",
              gas_unit_price: "100",
            }
          );

          const signedTxn = await this.client.signTransaction(
            account,
            txnRequest
          );
          const res = await this.client.submitTransaction(signedTxn);
          await this.client.waitForTransaction(res.hash);
          hashs.push(res.hash);
        } catch (err) {
          return {
            success: false,
            err,
          };
        }
      }
      return Promise.resolve(hashs);
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // signs the given message
  async signMessage(account, message) {
    try {
      return Promise.resolve(account.signBuffer(Buffer.from(message)).hex());
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // wait for transaction to complete and return txn data
  async waitForTxnResult(hash) {
    try {
      let result = await this.client.waitForTransactionWithResult(hash);
      return {
        success: true,
        result,
      };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
    try {
      let response = await this.client.getEventsByEventHandle(
        address,
        eventHandleStruct,
        fieldName
      );
      return Promise.resolve(response);
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * returns the list of transactions from the account
   *
   * @param address address of the desired account
   * @returns list of events
   */
  async getAllTransactions(address) {
    try {
      let coins = [];
      let transactions = [];
      let coinStoreType = "0x1::coin::CoinStore";
      let resources = await this.client.getAccountResources(address);
      let coinResources = resources.filter((r) =>
        r.type.startsWith(coinStoreType)
      );
      coinResources.forEach((resource) => coins.push(resource?.type));
      for await (const coin of coins) {
        let withdrawals = await this.getEvents(
          address,
          coin,
          "withdraw_events"
        );
        let deposits = await this.getEvents(address, coin, "deposit_events");
        transactions.push(...withdrawals, ...deposits);
      }
      let sortedTransactions = transactions.sort((a, b) => {
        return b.version - a.version;
      });
      return { success: true, transactions: sortedTransactions };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Return the Transaaction details by version
  async getTransactionDetailsByVersion(version) {
    try {
      return Promise.resolve({
        success: true,
        transactionDetail: await this.client.getTransactionByVersion(version),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Return the Transaaction details by hash
  async getTransactionDetailsByHash(hash) {
    try {
      return Promise.resolve({
        success: true,
        transactionDetail: await this.client.getTransactionByHash(hash),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  // Registers a new coin
  async registerCoin(account, coin_type_path) {
    try {
      const entryFunctionPayload = {
        arguments: [],
        function: "0x1::managed_coin::register",
        type: "entry_function_payload",
        type_arguments: [coin_type_path],
      };

      const txnRequest = await this.client.generateTransaction(
        account.address(),
        entryFunctionPayload,
        {
          max_gas_amount: "50000",
          gas_unit_price: "100",
        }
      );
      const signedTxn = await this.client.signTransaction(account, txnRequest);
      const transactionRes = await this.client.submitTransaction(signedTxn);
      await this.client.waitForTransaction(transactionRes.hash);
      return await Promise.resolve({ success: true, hash: txnHash });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
  async createCollection(
    account,
    name,
    description,
    uri,
    maxAmount = MAX_U64_BIG_INT
  ) {
    try {
      return Promise.resolve({
        success: true,
        collectionDetail: await this.token.createCollection(
          account,
          name,
          description,
          uri,
          maxAmount
        ),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
    try {
      return Promise.resolve({
        success: true,
        tokenDetail: await this.token.createToken(
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
        ),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
    try {
      return Promise.resolve({
        success: true,
        offerDetail: await this.token.offerToken(
          account,
          receiver_address,
          creator_address,
          collection_name,
          token_name,
          amount,
          property_version
        ),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
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
    try {
      return Promise.resolve({
        success: true,
        claimDetail: await this.token.claimToken(
          account,
          sender_address,
          creator_address,
          collection_name,
          token_name,
          property_version
        ),
      });
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }
  // /**
  //  * Opt in to receive nft transfers from other accounts
  //  *
  //  * @param account AptosAccount which has to opt in for receiving nft transfers
  //  * @param optIn Boolean value of whether to opt in or not
  //  * @returns The hash of the transaction submitted to the API
  //  */
  // async optInDirectTransfer(account, optIn) {
  //   try {
  //     const payload = {
  //       function: "0x3::token::opt_in_direct_transfer",
  //       type_arguments: [],
  //       arguments: [optIn],
  //     };

  //     const rawTxn = await this.client.generateTransaction(
  //       account.address(),
  //       payload
  //     );

  //     const signedTxn = await this.client.signTransaction(account, rawTxn);
  //     const transaction = await this.client.submitTransaction(signedTxn);

  //     await this.client.waitForTransaction(transaction.hash);
  //     return {
  //       success: true,
  //       hash: transaction.hash,
  //     };
  //   } catch (err) {
  //     return Promise.reject(err);
  //   }
  // }

  // /**
  //  * Transfer the specified amount of tokens from account to receiver
  //  * Receiver must have opted in for direct transfers
  //  *
  //  * @param sender AptosAccount where token from which tokens will be transfered
  //  * @param receiver Hex-encoded 32 byte Aptos account address to which tokens will be transfered
  //  * @param creator Hex-encoded 32 byte Aptos account address to which created tokens
  //  * @param collectionName Name of collection where token is stored
  //  * @param name Token name
  //  * @param amount Amount of tokens which will be transfered
  //  * @param propertyVersion the version of token PropertyMap with a default value 0.
  //  * @returns The hash of the transaction submitted to the API
  //  */
  // async transferWithOptIn(
  //   sender,
  //   receiver,
  //   creator,
  //   collectionName,
  //   name,
  //   amount,
  //   propertyVersion = 0
  // ) {
  //   try {
  //     const payload = {
  //       function: "0x3::token::transfer_with_opt_in",
  //       type_arguments: [],
  //       arguments: [
  //         creator,
  //         collectionName,
  //         name,
  //         propertyVersion,
  //         receiver,
  //         amount,
  //       ],
  //     };

  //     const rawTxn = await this.client.generateTransaction(
  //       sender.address(),
  //       payload
  //     );

  //     const signedTxn = await this.client.signTransaction(sender, rawTxn);
  //     const transaction = await this.client.submitTransaction(signedTxn);

  //     await this.client.waitForTransaction(transaction.hash);
  //     return {
  //       success: true,
  //       hash: transaction.hash,
  //     };
  //   } catch (err) {
  //     return Promise.reject(err);
  //   }
  // }

  // get NFT IDs of the address
  async getEventStream(address, eventHandleStruct, fieldName, limit, start) {
    let endpointUrl = `${this.nodeUrl}/accounts/${address}/events/${eventHandleStruct}/${fieldName}`;
    if (limit) {
      endpointUrl += `?limit=${limit}`;
    }

    if (start) {
      endpointUrl += limit ? `&start=${start}` : `?start=${start}`;
    }
    const response = await fetch(endpointUrl, {
      method: "GET",
    });

    if (response.status === 404) {
      return [];
    }

    return response.json();
  }

  /**
   * returns a list of token IDs of the tokens in a user's account
   * (including the tokens that were minted)
   *
   * @param address address of the desired account
   * @returns list of token IDs
   */
  async getTokenIds(address) {
    try {
      const countDeposit = {};
      const countWithdraw = {};
      const elementsFetched = new Set();
      const tokenIds = [];

      const depositEvents = await this.getEventStream(
        address,
        "0x3::token::TokenStore",
        "deposit_events"
      );

      const withdrawEvents = await this.getEventStream(
        address,
        "0x3::token::TokenStore",
        "withdraw_events"
      );

      let maxDepositSequenceNumber = -1;
      let maxWithdrawSequenceNumber = -1;

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

        maxDepositSequenceNumber = Math.max(
          maxDepositSequenceNumber,
          parseInt(element.sequence_number, 10)
        );
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

        maxWithdrawSequenceNumber = Math.max(
          maxWithdrawSequenceNumber,
          parseInt(element.sequence_number, 10)
        );
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
              : "-1",
            withdraw_sequence_number: countWithdraw[elementString]
              ? countWithdraw[elementString].sequence_number
              : "-1",
            difference: depositEventCount - withdrawEventCount,
          });
        });
      }
      return {
        success: true,
        tokenIds,
        maxDepositSequenceNumber,
        maxWithdrawSequenceNumber,
      };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }

  /**
   * returns the token information (including the collection information)
   * about a said tokenID
   *
   * @param tokenId token ID of the desired token
   * @returns token information
   */
  async getTokenDetails(tokenId, resourceHandle) {
    try {
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
      return { success: true, token };
    } catch (err) {
      return {
        success: false,
        err,
      };
    }
  }
};
