const {
  AptosAccount,
  AptosClient,
  FaucetClient,
  BCS,
  TxnBuilderTypes,
  HexString,
} = require("aptos");
const bip39 = require("@scure/bip39");
const english = require("@scure/bip39/wordlists/english");
const { HDKey } = require("@scure/bip32");
const fetch = require("cross-fetch");
const bigInt = require("big-integer");
const { Buffer } = require("buffer/");
const {
  AccountAddress,
  TypeTagStruct,
  ScriptFunction,
  StructTag,
  TransactionPayloadScriptFunction,
  RawTransaction,
  ChainId,
} = TxnBuilderTypes;

const COIN_TYPE = 637;
const MAX_ACCOUNTS = 5;
const ADDRESS_GAP = 10;

export class WalletClient {
  faucet;
  client;

  constructor(node_url, faucet_url) {
    this.client = new AptosClient(node_url);
    this.faucet = new FaucetClient(node_url, faucet_url);
  }
  async airdrop(address) {
    return Promise.resolve(await this.faucet.fundAccount(address, 20000));
  }
  async createNewAccount() {
    const mnemonic = bip39.generateMnemonic(english.wordlist);
    const seed = bip39.mnemonicToSeedSync(mnemonic.toString());
    const node = HDKey.fromMasterSeed(Buffer.from(seed));
    for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
      const derivationPath = `m/44'/${COIN_TYPE}'/${i}'/0/0`;
      const exKey = node.derive(derivationPath);
      const account = new AptosAccount(exKey.privateKey);
      const address = account.authKey().toString();
      const response = await fetch(
        `${this.client.nodeUrl}/accounts/${address}`,
        {
          method: "GET",
        }
      );
      if (response.status === 404) {
        await this.faucet.fundAccount(account.authKey(), 20000);
        return { account, mnemonic };
      }
      /* eslint-enable no-await-in-loop */
    }
    throw new Error("Max no. of accounts reached");
  }
  async balance(address) {
    if (address !== "") {
      let resources = await this.client.getAccountResources(address);
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
    if (!bip39.validateMnemonic(code, english.wordlist)) {
      return Promise.reject(new Error("Incorrect mnemonic passed"));
    }
    const seed = bip39.mnemonicToSeedSync(code.toString());
    const node = HDKey.fromMasterSeed(Buffer.from(seed));
    const exKey = node.derive(`m/44'/${COIN_TYPE}'/0'/0/0`);
    const account = new AptosAccount(exKey.privateKey);
    return account;
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

      const payload = {
        type: "script_function_payload",
        function: "0x1::coin::transfer",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],

        arguments: [
          `${HexString.ensure(recipient_address)}`,
          amount.toString(),
        ],
      };
      const txnRequest = await this.client.generateTransaction(
        account.address(),
        payload,
        {
          max_gas_amount: "1000",
        }
      );
      const signedTxn = await this.client.signTransaction(account, txnRequest);
      const res = await this.client.submitTransaction(signedTxn);
      await this.client.waitForTransaction(res.hash);
      return Promise.resolve(res.hash);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async sendToken(fromAccount, receiverAddress, amount) {
    const token = new TypeTagStruct(
      StructTag.fromString("0x1::aptos_coin::AptosCoin")
    );
    const scriptFunctionPayload = new TransactionPayloadScriptFunction(
      ScriptFunction.natural(
        "0x1::coin",
        "transfer",
        [token],
        [
          BCS.bcsToBytes(AccountAddress.fromHex(receiverAddress)),
          BCS.bcsSerializeUint64(amount),
        ]
      )
    );
    const [{ sequence_number: sequenceNumber }, chainId] = await Promise.all([
      this.client.getAccount(fromAccount.address()),
      this.client.getChainId(),
    ]);

    const rawTxn = new RawTransaction(
      AccountAddress.fromHex(fromAccount.address()),
      bigInt(sequenceNumber),
      scriptFunctionPayload,
      1000n,
      1n,
      bigInt(Math.floor(Date.now() / 1000) + 10),
      new ChainId(chainId)
    );
    const bcsTxn = AptosClient.generateBCSTransaction(fromAccount, rawTxn);
    const transactionRes = await this.client.submitSignedBCSTransaction(bcsTxn);
    await this.client.waitForTransaction(transactionRes.hash);
    return transactionRes.hash;
  }
  async getEvents(address, eventHandleStruct, fieldName) {
    let endpointUrl = `${this.client.nodeUrl}/accounts/${address}/events/${eventHandleStruct}/${fieldName}`;
    // if (limit) {
    //   endpointUrl += `?limit=${limit}`;
    // }
    // if (start) {
    //   endpointUrl += limit ? `&start=${start}` : `?start=${start}`;
    // }
    const response = await fetch(endpointUrl, {
      method: "GET",
    });

    if (response.status === 404) {
      return [];
    }
    let res = response.json();
    return res;
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
}
