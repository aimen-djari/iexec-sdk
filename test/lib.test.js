// @jest/global comes with jest
// eslint-disable-next-line import/no-extraneous-dependencies
import { jest } from '@jest/globals';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import BN from 'bn.js';
import fsExtra from 'fs-extra';
import { join } from 'path';
import JSZip from 'jszip';
import { execAsync } from './test-utils';

import { utils, IExec, errors } from '../src/lib';
import { sleep, bytes32Regex, addressRegex } from '../src/common/utils/utils';
import { TEE_FRAMEWORKS } from '../src/common/utils/constant';

const { NULL_ADDRESS } = utils;
const { readFile, ensureDir, writeFile } = fsExtra;

console.log('Node version:', process.version);

// increased from 60 s with ganache to 120s
const DEFAULT_TIMEOUT = 120000;

jest.setTimeout(DEFAULT_TIMEOUT);

// compare object with nested number or string number
expect.extend({
  toLooseEqual(received, target) {
    const stringifyNestedNumbers = (obj) => {
      const objOut = {};
      Object.entries(obj).forEach((e) => {
        const [k, v] = e;
        if (typeof v === 'number') objOut[k] = v.toString();
        else if (typeof v === 'object') {
          objOut[k] = stringifyNestedNumbers(v);
        } else objOut[k] = v;
      });
      return objOut;
    };
    return {
      pass: this.equals(
        stringifyNestedNumbers(received),
        stringifyNestedNumbers(target),
      ),
      message: () =>
        `not loosely equal \nreceived: ${JSON.stringify(
          received,
          null,
          2,
        )}\nexpected: ${JSON.stringify(target, null, 2)}`,
    };
  },
});

// CONFIG
const { DRONE, INFURA_PROJECT_ID, ETHERSCAN_API_KEY, ALCHEMY_API_KEY } =
  process.env;
// public chains
console.log('using env INFURA_PROJECT_ID', !!INFURA_PROJECT_ID);
console.log('using env ETHERSCAN_API_KEY', !!ETHERSCAN_API_KEY);
console.log('using env ALCHEMY_API_KEY', !!ALCHEMY_API_KEY);

const providerOptions = {
  ...(INFURA_PROJECT_ID && { infura: INFURA_PROJECT_ID }),
  ...(ETHERSCAN_API_KEY && { etherscan: ETHERSCAN_API_KEY }),
  ...(ALCHEMY_API_KEY && { alchemy: ALCHEMY_API_KEY }),
};

const mainnetHost = 'mainnet';
const bellecourHost = 'https://bellecour.iex.ec';

// 1 block / tx
// TODO can be replaced by instamine chain to speedup tests
const tokenChainInstamineUrl = DRONE
  ? 'http://token-chain:8545'
  : 'http://localhost:18545';
const nativeChainInstamineUrl = DRONE
  ? 'http://native-chain:8545'
  : 'http://localhost:28545';
// blocktime 1s for concurrent tx test
const tokenChain1sUrl = DRONE
  ? 'http://token-chain:8545'
  : 'http://localhost:18545';
// openethereum node (with ws)
const tokenChainOpenethereumUrl = DRONE
  ? 'http://token-chain:8545'
  : 'http://localhost:18545';
// secret management service
const sconeSms = DRONE
  ? 'http://token-sms-scone:13300'
  : 'http://localhost:13301';
const gramineSms = DRONE
  ? 'http://token-sms-gramine:13300'
  : 'http://localhost:13302';

const smsMap = {
  [TEE_FRAMEWORKS.SCONE]: sconeSms,
  [TEE_FRAMEWORKS.GRAMINE]: gramineSms,
};

// result proxy
const resultProxyURL = DRONE
  ? 'http://token-result-proxy:13200'
  : 'http://localhost:13200';
// marketplace
const iexecGatewayURL = DRONE
  ? 'http://token-gateway:3000'
  : 'http://localhost:13000';

const RICH_ADDRESS = '0x7bd4783FDCAD405A28052a0d1f11236A741da593';
const RICH_PRIVATE_KEY =
  '0x564a9db84969c8159f7aa3d5393c5ecd014fce6a375842a45b12af6677b12407';

// a random known address for deterministic hash
const KNOWN_ADDRESS = '0x650ae1d365369129c326Cd15Bf91793b52B7cf59';
const RICH_PRIVATE_KEY2 =
  '0xde43b282c2931fc41ca9e1486fedc2c45227a3b9b4115c89d37f6333c8816d89';

const networkId = 65535;
const hubAddress = '0xC129e7917b7c7DeDfAa5Fff1FB18d5D7050fE8ca';
const enterpriseHubAddress = '0xb80C02d24791fA92fA8983f15390274698A75D23';
const nativeHubAddress = '0xC129e7917b7c7DeDfAa5Fff1FB18d5D7050fE8ca';
const ensRegistryAddress = '0xaf87b82B01E484f8859c980dE69eC8d09D30F22a';
const ensPublicResolverAddress = '0x464E9FC01C2970173B183D24B43A0FA07e6A072E';

console.log('hubAddress', hubAddress);
console.log('nativeHubAddress', nativeHubAddress);
console.log('enterpriseHubAddress', enterpriseHubAddress);

// UTILS
const tokenChainRPC = new JsonRpcProvider(tokenChainInstamineUrl);
const tokenChainRPC1s = new JsonRpcProvider(tokenChain1sUrl);
const tokenChainWallet = new Wallet(RICH_PRIVATE_KEY, tokenChainRPC);
const whitelistAdminWallet = new Wallet(RICH_PRIVATE_KEY, tokenChainRPC);

// const nativeChainRPC = new ethers.providers.JsonRpcProvider(nativeChainUrl);
// const nativeChainWallet = new ethers.Wallet(PRIVATE_KEY, nativeChainRPC);

const initializeTask = async (wallet, hub, dealid, idx) => {
  const hubContract = new Contract(
    hub,
    [
      {
        constant: false,
        inputs: [
          {
            name: '_dealid',
            type: 'bytes32',
          },
          {
            name: 'idx',
            type: 'uint256',
          },
        ],
        name: 'initialize',
        outputs: [
          {
            name: '',
            type: 'bytes32',
          },
        ],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    wallet,
  );
  const initTx = await hubContract.initialize(dealid, idx);
  await initTx.wait();
};

const grantKYC = async (wallet, hub, address) => {
  const iExecContract = new Contract(
    hub,
    [
      {
        inputs: [],
        name: 'token',
        outputs: [
          {
            internalType: 'address',
            name: '',
            type: 'address',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    wallet,
  );
  const eRlcAddress = await iExecContract.token();
  const eRlcContract = new Contract(
    eRlcAddress,
    [
      {
        inputs: [
          {
            internalType: 'address[]',
            name: 'accounts',
            type: 'address[]',
          },
        ],
        name: 'grantKYC',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    wallet,
  );
  const grantTx = await eRlcContract.grantKYC([address]);
  await grantTx.wait();
};

const revokeKYC = async (wallet, hub, address) => {
  const iExecContract = new Contract(
    hub,
    [
      {
        inputs: [],
        name: 'token',
        outputs: [
          {
            internalType: 'address',
            name: '',
            type: 'address',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    wallet,
  );
  const eRlcAddress = await iExecContract.token();
  const eRlcContract = new Contract(
    eRlcAddress,
    [
      {
        inputs: [
          {
            internalType: 'address[]',
            name: 'accounts',
            type: 'address[]',
          },
        ],
        name: 'revokeKYC',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    wallet,
  );
  const revokeTx = await eRlcContract.revokeKYC([address]);
  await revokeTx.wait();
};

let sequenceId = Date.now();
const getId = () => {
  sequenceId += 1;
  return sequenceId;
};

const deployRandomApp = async (iexec, { owner, teeFramework } = {}) =>
  iexec.app.deployApp({
    owner: owner || (await iexec.wallet.getAddress()),
    name: `app${getId()}`,
    type: 'DOCKER',
    multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
    checksum:
      '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    mrenclave: teeFramework && {
      framework: teeFramework,
      version: 'v1',
      fingerprint: 'fingerprint',
      ...(teeFramework.toLowerCase() === TEE_FRAMEWORKS.SCONE && {
        entrypoint: 'entrypoint.sh',
        heapSize: 4096,
      }),
    },
  });

const deployRandomDataset = async (iexec, { owner } = {}) =>
  iexec.dataset.deployDataset({
    owner: owner || (await iexec.wallet.getAddress()),
    name: `dataset${getId()}`,
    multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
    checksum:
      '0x0000000000000000000000000000000000000000000000000000000000000000',
  });

const deployRandomWorkerpool = async (iexec, { owner } = {}) =>
  iexec.workerpool.deployWorkerpool({
    owner: owner || (await iexec.wallet.getAddress()),
    description: `workerpool${getId()}`,
  });

const deployAndGetApporder = async (
  iexec,
  {
    teeFramework,
    appprice = 0,
    volume = 1,
    datasetrestrict,
    workerpoolrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const appDeployRes = await deployRandomApp(iexec, { teeFramework });
  const app = appDeployRes.address;
  return iexec.order
    .createApporder({
      app,
      appprice,
      volume,
      tag,
      datasetrestrict,
      workerpoolrestrict,
      requesterrestrict,
    })
    .then((order) =>
      iexec.order.signApporder(order, { preflightCheck: false }),
    );
};

const deployAndGetDatasetorder = async (
  iexec,
  {
    datasetprice = 0,
    volume = 1,
    apprestrict,
    workerpoolrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const datasetDeployRes = await deployRandomDataset(iexec);
  const dataset = datasetDeployRes.address;
  return iexec.order
    .createDatasetorder({
      dataset,
      datasetprice,
      volume,
      tag,
      apprestrict,
      workerpoolrestrict,
      requesterrestrict,
    })
    .then((order) =>
      iexec.order.signDatasetorder(order, { preflightCheck: false }),
    );
};

const deployAndGetWorkerpoolorder = async (
  iexec,
  {
    category = 0,
    workerpoolprice = 0,
    volume = 1,
    trust,
    apprestrict,
    datasetrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const workerpoolDeployRes = await deployRandomWorkerpool(iexec);
  const workerpool = workerpoolDeployRes.address;
  return iexec.order
    .createWorkerpoolorder({
      workerpool,
      workerpoolprice,
      volume,
      category,
      trust,
      tag,
      apprestrict,
      datasetrestrict,
      requesterrestrict,
    })
    .then(iexec.order.signWorkerpoolorder);
};

const getMatchableRequestorder = async (
  iexec,
  { apporder, datasetorder, workerpoolorder } = {},
) => {
  const address = await iexec.wallet.getAddress();
  return iexec.order
    .createRequestorder({
      requester: address,
      app: apporder.app,
      appmaxprice: apporder.appprice,
      dataset: datasetorder ? datasetorder.dataset : NULL_ADDRESS,
      datasetmaxprice: datasetorder ? datasetorder.datasetprice : 0,
      workerpool: workerpoolorder.workerpool,
      workerpoolmaxprice: workerpoolorder.workerpoolprice,
      category: workerpoolorder.category,
      trust: workerpoolorder.trust,
      volume: workerpoolorder.volume,
    })
    .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
};

const createCategory = async (iexec, { workClockTimeRef = 0 } = {}) => {
  const res = await iexec.hub.createCategory({
    name: 'custom',
    description: 'desc',
    workClockTimeRef,
  });
  return res.catid.toString();
};

const getRandomWallet = () => {
  const { privateKey, publicKey, address } = Wallet.createRandom();
  return { privateKey, publicKey, address };
};
const getRandomAddress = () => getRandomWallet().address;

const signRegex = /^(0x)([0-9a-f]{2}){65}$/;

// TESTS
describe('[workflow]', () => {
  let noDurationCatId;
  let apporder;
  let datasetorder;
  let workerpoolorder;
  let workerpoolorderToClaim;

  test('create category', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const res = await iexec.hub.createCategory({
      name: 'custom',
      description: 'desc',
      workClockTimeRef: '0',
    });
    noDurationCatId = res.catid.toString();
    expect(res).toBeDefined();
    expect(res.catid).toBeDefined();
    expect(res.txHash).toBeDefined();
  });

  test('deploy and sell app', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const owner = await iexec.wallet.getAddress();
    const appName = `My app${getId()}`;
    const appDeployRes = await iexec.app.deployApp({
      owner,
      name: appName,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    });
    expect(appDeployRes.address).toBeDefined();
    expect(appDeployRes.txHash).toBeDefined();

    const appShowRes = await iexec.app.showApp(appDeployRes.address);
    expect(appShowRes.objAddress).toBe(appDeployRes.address);
    expect(appShowRes.app.owner).toBe(owner);
    expect(appShowRes.app.appName).toBe(appName);
    expect(appShowRes.app.appType).toBe('DOCKER');
    expect(appShowRes.app.appMultiaddr).toBe(
      'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
    );
    expect(appShowRes.app.appChecksum).toBe(
      '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    );
    expect(appShowRes.app.appMREnclave).toBe('');

    const order = await iexec.order.createApporder({
      app: appDeployRes.address,
      appprice: '1000000000',
      volume: '1000',
    });
    const signedorder = await iexec.order.signApporder(order, {
      preflightCheck: false,
    });
    apporder = signedorder;
    expect(signedorder.sign).toBeDefined();
  });

  test('deploy and sell dataset', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const owner = await iexec.wallet.getAddress();
    const datasetName = `My dataset${getId()}`;
    const datasetDeployRes = await iexec.dataset.deployDataset({
      owner,
      name: datasetName,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
    expect(datasetDeployRes.address).toBeDefined();
    expect(datasetDeployRes.txHash).toBeDefined();

    const datasetShowRes = await iexec.dataset.showDataset(
      datasetDeployRes.address,
    );
    expect(datasetShowRes.objAddress).toBe(datasetDeployRes.address);
    expect(datasetShowRes.dataset.owner).toBe(owner);
    expect(datasetShowRes.dataset.datasetName).toBe(datasetName);
    expect(datasetShowRes.dataset.datasetMultiaddr).toBe(
      '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
    );
    expect(datasetShowRes.dataset.datasetChecksum).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    );

    const order = await iexec.order.createDatasetorder({
      dataset: datasetDeployRes.address,
      datasetprice: '1000000000',
      volume: '1000',
    });
    const signedorder = await iexec.order.signDatasetorder(order, {
      preflightCheck: false,
    });
    datasetorder = signedorder;
    expect(signedorder.sign).toBeDefined();
  });

  test('deploy and sell computing power', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const owner = await iexec.wallet.getAddress();
    const desc = `workerpool${getId()}`;
    const workerpoolDeployRes = await iexec.workerpool.deployWorkerpool({
      owner,
      description: desc,
    });
    expect(workerpoolDeployRes.address).toBeDefined();
    expect(workerpoolDeployRes.txHash).toBeDefined();

    const workerpoolShowRes = await iexec.workerpool.showWorkerpool(
      workerpoolDeployRes.address,
    );
    expect(workerpoolShowRes.objAddress).toBe(workerpoolDeployRes.address);
    expect(workerpoolShowRes.workerpool.owner).toBe(owner);
    expect(workerpoolShowRes.workerpool.workerpoolDescription).toBe(desc);
    expect(workerpoolShowRes.workerpool.schedulerRewardRatioPolicy).not.toBe(
      undefined,
    );
    expect(workerpoolShowRes.workerpool.workerStakeRatioPolicy).not.toBe(
      undefined,
    );

    const order = await iexec.order.createWorkerpoolorder({
      workerpool: workerpoolDeployRes.address,
      workerpoolprice: '1000000000',
      category: '2',
      volume: '1000',
    });
    await iexec.account.deposit(order.workerpoolprice);
    const signedorder = await iexec.order.signWorkerpoolorder(order);
    workerpoolorder = signedorder;
    expect(signedorder.sign).toBeDefined();
    // generate no duration order
    const orderToClaim = await iexec.order.createWorkerpoolorder({
      workerpool: workerpoolDeployRes.address,
      workerpoolprice: '0',
      category: noDurationCatId,
      volume: '1000',
    });
    workerpoolorderToClaim = await iexec.order.signWorkerpoolorder(
      orderToClaim,
    );
    expect(workerpoolorderToClaim.sign).toBeDefined();
  });

  test('buy computation', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const order = await iexec.order.createRequestorder({
      app: apporder.app,
      appmaxprice: apporder.appprice,
      dataset: datasetorder.dataset,
      datasetmaxprice: datasetorder.datasetprice,
      workerpoolmaxprice: workerpoolorder.workerpoolprice,
      requester: await iexec.wallet.getAddress(),
      category: workerpoolorder.category,
      volume: '1',
      params: {
        iexec_args: 'test',
      },
    });
    const signedorder = await iexec.order.signRequestorder(
      {
        ...order,
        params: {
          iexec_args: 'test',
        },
      },
      { preflightCheck: false },
    );
    const totalPrice = new BN(order.appmaxprice)
      .add(new BN(order.datasetmaxprice))
      .add(new BN(order.workerpoolmaxprice));
    await iexec.account.deposit(totalPrice);
    expect(signedorder.sign).toBeDefined();

    const matchOrdersRes = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder: signedorder,
      },
      { preflightCheck: false },
    );
    expect(matchOrdersRes).toBeDefined();
    expect(matchOrdersRes.dealid).toBeDefined();
    expect(matchOrdersRes.txHash).toBeDefined();
    expect(matchOrdersRes.volume.eq(new BN(1))).toBe(true);
  });

  test('show & claim task, show & claim deal (initialized & uninitialized tasks)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const order = await iexec.order.createRequestorder({
      app: apporder.app,
      appmaxprice: apporder.appprice,
      dataset: datasetorder.dataset,
      datasetmaxprice: datasetorder.datasetprice,
      workerpoolmaxprice: workerpoolorderToClaim.workerpoolprice,
      requester: await iexec.wallet.getAddress(),
      category: workerpoolorderToClaim.category,
      volume: '10',
    });
    const signedorder = await iexec.order.signRequestorder(order, {
      preflightCheck: false,
    });
    const totalPrice = new BN(order.appmaxprice)
      .add(new BN(order.datasetmaxprice))
      .add(new BN(order.workerpoolmaxprice))
      .mul(new BN(order.volume));
    await iexec.account.deposit(totalPrice);
    expect(signedorder.sign).toBeDefined();
    const matchOrdersRes = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder: workerpoolorderToClaim,
        requestorder: signedorder,
      },
      { preflightCheck: false },
    );
    expect(matchOrdersRes).toBeDefined();
    expect(matchOrdersRes.dealid).toBeDefined();
    expect(matchOrdersRes.txHash).toBeDefined();
    expect(matchOrdersRes.volume.eq(new BN(10))).toBe(true);

    const showDealRes = await iexec.deal.show(matchOrdersRes.dealid);
    expect(showDealRes).toBeDefined();
    expect(showDealRes.app).toBeDefined();
    expect(showDealRes.app.pointer).toBe(apporder.app);
    expect(showDealRes.app.owner).toBeDefined();
    expect(showDealRes.app.price.eq(new BN(apporder.appprice))).toBe(true);
    expect(showDealRes.dataset).toBeDefined();
    expect(showDealRes.dataset.pointer).toBe(datasetorder.dataset);
    expect(showDealRes.dataset.owner).toBeDefined();
    expect(
      showDealRes.dataset.price.eq(new BN(datasetorder.datasetprice)),
    ).toBe(true);
    expect(showDealRes.workerpool).toBeDefined();
    expect(showDealRes.workerpool.pointer).toBe(
      workerpoolorderToClaim.workerpool,
    );
    expect(showDealRes.workerpool.owner).toBeDefined();
    expect(
      showDealRes.workerpool.price.eq(
        new BN(workerpoolorderToClaim.workerpoolprice),
      ),
    ).toBe(true);
    expect(showDealRes.trust.eq(new BN(1))).toBe(true);
    expect(showDealRes.category.eq(new BN(signedorder.category))).toBe(true);
    expect(showDealRes.tag).toBe(signedorder.tag);
    expect(showDealRes.params).toBe(signedorder.params);
    expect(showDealRes.startTime instanceof BN).toBe(true);
    expect(showDealRes.finalTime instanceof BN).toBe(true);
    expect(showDealRes.finalTime.gte(showDealRes.startTime)).toBe(true);
    expect(showDealRes.deadlineReached).toBe(true);
    expect(showDealRes.botFirst.eq(new BN(0))).toBe(true);
    expect(showDealRes.botSize.eq(new BN(10))).toBe(true);
    expect(showDealRes.workerStake.eq(new BN(0))).toBe(true);
    expect(showDealRes.schedulerRewardRatio.eq(new BN(1))).toBe(true);
    expect(showDealRes.requester).toBe(signedorder.requester);
    expect(showDealRes.beneficiary).toBe(signedorder.beneficiary);
    expect(showDealRes.callback).toBe(signedorder.callback);
    expect(typeof showDealRes.tasks).toBe('object');
    expect(showDealRes.tasks[0]).toBeDefined();
    expect(showDealRes.tasks[9]).toBeDefined();
    expect(showDealRes.tasks[10]).toBeUndefined();

    const showTaskUnsetRes = await iexec.task
      .show(showDealRes.tasks[0])
      .catch((e) => e);
    expect(showTaskUnsetRes instanceof errors.ObjectNotFoundError).toBe(true);
    expect(showTaskUnsetRes.message).toBe(
      `No task found for id ${showDealRes.tasks[0]} on chain ${networkId}`,
    );

    const taskIdxToInit = 1;
    await initializeTask(
      tokenChainWallet,
      hubAddress,
      matchOrdersRes.dealid,
      taskIdxToInit,
    );
    const showTaskActiveRes = await iexec.task.show(
      showDealRes.tasks[taskIdxToInit],
    );
    expect(showTaskActiveRes.status).toBe(1);
    expect(showTaskActiveRes.dealid).toBe(matchOrdersRes.dealid);
    expect(showTaskActiveRes.idx.eq(new BN(taskIdxToInit))).toBe(true);
    expect(showTaskActiveRes.timeref.eq(new BN(0))).toBe(true);
    expect(
      showTaskActiveRes.contributionDeadline.eq(showDealRes.finalTime),
    ).toBe(true);
    expect(showTaskActiveRes.finalDeadline.eq(showDealRes.finalTime)).toBe(
      true,
    );
    expect(showTaskActiveRes.revealCounter.eq(new BN(0))).toBe(true);
    expect(showTaskActiveRes.winnerCounter.eq(new BN(0))).toBe(true);
    expect(showTaskActiveRes.contributors).toStrictEqual([]);
    expect(showTaskActiveRes.consensusValue).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    );
    expect(showTaskActiveRes.resultDigest).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    );
    expect(showTaskActiveRes.results).toStrictEqual({ storage: 'none' });
    expect(showTaskActiveRes.idx.eq(new BN(taskIdxToInit))).toBe(true);
    expect(showTaskActiveRes.statusName).toBe('TIMEOUT');
    expect(showTaskActiveRes.taskTimedOut).toBe(true);

    const taskIdxToClaim = 2;
    await initializeTask(
      tokenChainWallet,
      hubAddress,
      matchOrdersRes.dealid,
      taskIdxToClaim,
    );
    const claimTaskRes = await iexec.task.claim(
      showDealRes.tasks[taskIdxToClaim],
    );
    expect(claimTaskRes).toBeDefined();

    const claimDealRes = await iexec.deal.claim(matchOrdersRes.dealid);
    expect(claimDealRes).toBeDefined();
    expect(claimDealRes.transactions).toBeDefined();
    expect(claimDealRes.transactions.length).toBe(2);
    expect(claimDealRes.transactions[0]).toBeDefined();
    expect(claimDealRes.transactions[0].type).toBe('claimArray');
    expect(claimDealRes.transactions[1]).toBeDefined();
    expect(claimDealRes.transactions[1].type).toBe('initializeAndClaimArray');
    expect(claimDealRes.claimed).toBeDefined();
    expect(Object.keys(claimDealRes.claimed).length).toBe(9);
    expect(claimDealRes.claimed[0]).toBeDefined();
  });
});

describe('[getSignerFromPrivateKey]', () => {
  test('sign tx send value', async () => {
    const amount = new BN(1000);
    const receiver = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const senderInitialBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverInitialBalances = await iexec.wallet.checkBalances(receiver);
    const txHash = await iexec.wallet.sendETH(amount, receiver);
    const senderFinalBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverFinalBalances = await iexec.wallet.checkBalances(receiver);
    expect(txHash).toBeDefined();
    expect(txHash.length).toBe(66);
    expect(
      senderFinalBalances.wei
        .add(new BN(amount))
        .lte(senderInitialBalances.wei),
    ).toBe(true);
    expect(senderFinalBalances.nRLC.eq(senderInitialBalances.nRLC)).toBe(true);
    expect(
      receiverFinalBalances.wei
        .sub(new BN(amount))
        .eq(receiverInitialBalances.wei),
    ).toBe(true);
    const tx = await tokenChainRPC.getTransaction(txHash);
    expect(tx).toBeDefined();
  });

  test('sign tx no value', async () => {
    const amount = '1000000000';
    const receiver = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const senderInitialBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverInitialBalances = await iexec.wallet.checkBalances(receiver);
    const txHash = await iexec.wallet.sendRLC(amount, receiver);
    const senderFinalBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverFinalBalances = await iexec.wallet.checkBalances(receiver);
    expect(txHash).toBeDefined();
    expect(txHash.length).toBe(66);
    expect(senderFinalBalances.wei.lte(senderInitialBalances.wei)).toBe(true);
    expect(
      senderFinalBalances.nRLC
        .add(new BN(amount))
        .eq(senderInitialBalances.nRLC),
    ).toBe(true);
    expect(
      receiverFinalBalances.nRLC
        .sub(new BN(amount))
        .eq(receiverInitialBalances.nRLC),
    ).toBe(true);
    const tx = await tokenChainRPC.getTransaction(txHash);
    expect(tx).toBeDefined();
  });

  test('gasPrice option', async () => {
    const amount = '1000000000';
    const gasPrice = '123456789';
    const receiver = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
      {
        gasPrice,
      },
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const senderInitialBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverInitialBalances = await iexec.wallet.checkBalances(receiver);
    const txHash = await iexec.wallet.sendRLC(amount, receiver);
    const senderFinalBalances = await iexec.wallet.checkBalances(
      await iexec.wallet.getAddress(),
    );
    const receiverFinalBalances = await iexec.wallet.checkBalances(receiver);
    expect(txHash).toBeDefined();
    expect(txHash.length).toBe(66);
    expect(senderFinalBalances.wei.lte(senderInitialBalances.wei)).toBe(true);
    expect(
      senderFinalBalances.nRLC
        .add(new BN(amount))
        .eq(senderInitialBalances.nRLC),
    ).toBe(true);
    expect(
      receiverFinalBalances.nRLC
        .sub(new BN(amount))
        .eq(receiverInitialBalances.nRLC),
    ).toBe(true);
    const tx = await tokenChainRPC.getTransaction(txHash);
    expect(tx).toBeDefined();
    expect(tx.gasPrice.toString()).toBe(gasPrice);
  });

  test('getTransactionCount option (custom nonce management)', async () => {
    const amount = new BN(1000);
    const receiver = getRandomAddress();

    const nonceProvider = await (async (address) => {
      const initNonce = BigInt(
        await tokenChainRPC1s.send('eth_getTransactionCount', [
          address,
          'latest',
        ]),
      );
      let i = 0n;
      const getNonce = () => Promise.resolve((initNonce + i).toString());

      const increaseNonce = () => {
        i += 1n;
      };
      return {
        getNonce,
        increaseNonce,
      };
    })(RICH_ADDRESS);

    const signer = utils.getSignerFromPrivateKey(
      tokenChain1sUrl,
      RICH_PRIVATE_KEY,
      {
        getTransactionCount: nonceProvider.getNonce,
      },
    );

    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );

    await expect(iexec.wallet.sendETH(amount, receiver)).resolves.toMatch(
      bytes32Regex,
    );
    await expect(iexec.wallet.sendETH(amount, receiver)).rejects.toThrow();
    nonceProvider.increaseNonce();
    await expect(iexec.wallet.sendETH(amount, receiver)).resolves.toMatch(
      bytes32Regex,
    );
    await expect(iexec.wallet.sendETH(amount, receiver)).rejects.toThrow();
    nonceProvider.increaseNonce();
    await expect(iexec.wallet.sendETH(amount, receiver)).resolves.toMatch(
      bytes32Regex,
    );
  });

  // skip instable quorum test as providers get added
  test.skip(
    'providers option',
    async () => {
      const alchemyFailQuorumFail = {
        ...providerOptions,
        alchemy: 'FAIL',
        quorum: 3,
      };
      const alchemyFailQuorumPass = {
        ...providerOptions,
        alchemy: 'FAIL',
        quorum: 2,
      };
      const infuraFailQuorumFail = {
        ...providerOptions,
        infura: 'FAIL',
        quorum: 3,
      };
      const infuraFailQuorumPass = {
        ...providerOptions,
        infura: 'FAIL',
        quorum: 2,
      };
      const etherscanFailQuorumFail = {
        ...providerOptions,
        etherscan: 'FAIL',
        quorum: 3,
      };
      const etherscanFailQuorumPass = {
        ...providerOptions,
        etherscan: 'FAIL',
        quorum: 2,
      };
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: alchemyFailQuorumFail,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).rejects.toThrow();
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: alchemyFailQuorumPass,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).resolves.toBeDefined();
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: etherscanFailQuorumFail,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).rejects.toThrow();
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: etherscanFailQuorumPass,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).resolves.toBeDefined();
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: infuraFailQuorumFail,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).rejects.toThrow();
      await expect(
        new IExec({
          ethProvider: utils.getSignerFromPrivateKey(
            mainnetHost,
            RICH_PRIVATE_KEY,
            {
              providers: infuraFailQuorumPass,
            },
          ),
        }).wallet.checkBalances(NULL_ADDRESS),
      ).resolves.toBeDefined();
    },
    DEFAULT_TIMEOUT * 2,
  );

  test('providers option ignored with RPC host', async () => {
    const alchemyFailQuorumFail = {
      alchemy: 'FAIL',
      quorum: 3,
    };
    const infuraFailQuorumFail = {
      infura: 'FAIL',
      quorum: 3,
    };
    const etherscanFailQuorumFail = {
      etherscan: 'FAIL',
      quorum: 3,
    };
    await expect(
      new IExec(
        {
          ethProvider: utils.getSignerFromPrivateKey(
            tokenChainInstamineUrl,
            RICH_PRIVATE_KEY,
            {
              providers: alchemyFailQuorumFail,
            },
          ),
        },
        {
          hubAddress,
        },
      ).wallet.checkBalances(NULL_ADDRESS),
    ).resolves.toBeDefined();
    await expect(
      new IExec(
        {
          ethProvider: utils.getSignerFromPrivateKey(
            tokenChainInstamineUrl,
            RICH_PRIVATE_KEY,
            {
              providers: etherscanFailQuorumFail,
            },
          ),
        },
        {
          hubAddress,
        },
      ).wallet.checkBalances(NULL_ADDRESS),
    ).resolves.toBeDefined();
    await expect(
      new IExec(
        {
          ethProvider: utils.getSignerFromPrivateKey(
            tokenChainInstamineUrl,
            RICH_PRIVATE_KEY,
            {
              providers: infuraFailQuorumFail,
            },
          ),
        },
        {
          hubAddress,
        },
      ).wallet.checkBalances(NULL_ADDRESS),
    ).resolves.toBeDefined();
  });
});

describe('[hub]', () => {
  test('hub.showCategory()', async () => {
    const iexec = new IExec(
      { ethProvider: tokenChainInstamineUrl },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.hub.showCategory(0);
    expect(res).toStrictEqual({
      description: '{}',
      name: 'XS',
      workClockTimeRef: new BN(300),
    });
  });
});

describe('[wallet]', () => {
  test('wallet.getAddress()', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const res = await iexec.wallet.getAddress();
    expect(res).toBe(wallet.address);
  });

  test('wallet.checkBalances()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(initialBalance.wei).toBeInstanceOf(BN);
    expect(initialBalance.nRLC).toBeInstanceOf(BN);
    await iexec.wallet.sendETH(5, NULL_ADDRESS);
    await iexec.wallet.sendRLC(10, NULL_ADDRESS);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(finalBalance.wei).toBeInstanceOf(BN);
    expect(finalBalance.nRLC).toBeInstanceOf(BN);
    expect(finalBalance.wei.add(new BN(5)).lt(initialBalance.wei)).toBe(true);
    expect(finalBalance.nRLC.add(new BN(10)).eq(initialBalance.nRLC)).toBe(
      true,
    );
  });

  test('wallet.checkBalances() (native)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(initialBalance.wei).toBeInstanceOf(BN);
    expect(initialBalance.nRLC).toBeInstanceOf(BN);
    expect(
      initialBalance.wei.div(new BN(1000000000)).eq(initialBalance.nRLC),
    ).toBe(true);
    await iexec.wallet.sendRLC(10, NULL_ADDRESS);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(finalBalance.wei).toBeInstanceOf(BN);
    expect(finalBalance.nRLC).toBeInstanceOf(BN);
    expect(finalBalance.wei.add(new BN(10)).lt(initialBalance.wei)).toBe(true);
    expect(finalBalance.nRLC.add(new BN(10)).lte(initialBalance.nRLC)).toBe(
      true,
    );
    expect(finalBalance.wei.div(new BN(1000000000)).eq(finalBalance.nRLC)).toBe(
      true,
    );
  });

  test('wallet.checkBridgedBalances() (token)', async () => {
    const signer = utils.getSignerFromPrivateKey(mainnetHost, RICH_PRIVATE_KEY);
    const iexec = new IExec({
      ethProvider: signer,
    });
    const res = await iexec.wallet.checkBridgedBalances(RICH_ADDRESS);
    expect(res.nRLC).toBeInstanceOf(BN);
    expect(res.wei).toBeInstanceOf(BN);
  });

  test('wallet.checkBridgedBalances() (native)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      bellecourHost,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        providerOptions,
      },
    );
    const res = await iexec.wallet.checkBridgedBalances(RICH_ADDRESS);
    expect(res.nRLC).toBeInstanceOf(BN);
    expect(res.wei).toBeInstanceOf(BN);
  });

  test('wallet.sendETH()', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendETH(5, receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.wei.add(new BN(5)).lt(initialBalance.wei)).toBe(true);
    expect(finalBalance.nRLC.eq(initialBalance.nRLC)).toBe(true);
    expect(
      receiverFinalBalance.wei.eq(receiverInitialBalance.wei.add(new BN(5))),
    ).toBe(true);
    expect(receiverFinalBalance.nRLC.eq(receiverInitialBalance.nRLC)).toBe(
      true,
    );
  });

  test('wallet.sendETH() (specified unit)', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendETH('0.5 gwei', receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(
      finalBalance.wei.add(new BN('500000000')).lt(initialBalance.wei),
    ).toBe(true);
    expect(finalBalance.nRLC.eq(initialBalance.nRLC)).toBe(true);
    expect(
      receiverFinalBalance.wei.eq(
        receiverInitialBalance.wei.add(new BN('500000000')),
      ),
    ).toBe(true);
    expect(receiverFinalBalance.nRLC.eq(receiverInitialBalance.nRLC)).toBe(
      true,
    );
  });

  test('wallet.sendETH() (throw on native)', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    await expect(iexec.wallet.sendETH(10, receiverAddress)).rejects.toThrow(
      Error('sendETH() is disabled on sidechain, use sendRLC()'),
    );
  });

  test('wallet.sendRLC()', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendRLC(5, receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.wei.lt(initialBalance.wei)).toBe(true);
    expect(finalBalance.nRLC.add(new BN(5)).eq(initialBalance.nRLC)).toBe(true);
    expect(receiverFinalBalance.wei.eq(receiverInitialBalance.wei)).toBe(true);
    expect(
      receiverFinalBalance.nRLC.eq(receiverInitialBalance.nRLC.add(new BN(5))),
    ).toBe(true);
  });

  test('wallet.sendRLC() (specified unit)', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendRLC('0.5 RLC', receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.wei.lt(initialBalance.wei)).toBe(true);
    expect(
      finalBalance.nRLC.add(new BN('500000000')).eq(initialBalance.nRLC),
    ).toBe(true);
    expect(receiverFinalBalance.wei.eq(receiverInitialBalance.wei)).toBe(true);
    expect(
      receiverFinalBalance.nRLC.eq(
        receiverInitialBalance.nRLC.add(new BN('500000000')),
      ),
    ).toBe(true);
  });

  test('wallet.sendRLC() (native)', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendRLC(5, receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.nRLC.add(new BN(5)).eq(initialBalance.nRLC)).toBe(true);
    expect(
      finalBalance.wei
        .add(new BN(5).mul(new BN(1000000000)))
        .eq(initialBalance.wei),
    ).toBe(true);
    expect(
      receiverFinalBalance.nRLC.sub(new BN(5)).eq(receiverInitialBalance.nRLC),
    ).toBe(true);
    expect(
      receiverFinalBalance.wei
        .sub(new BN(5).mul(new BN(1000000000)))
        .eq(receiverInitialBalance.wei),
    ).toBe(true);
  });

  test('wallet.sendRLC() (native, specified unit)', async () => {
    const receiverAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    const txHash = await iexec.wallet.sendRLC('0.000005 RLC', receiverAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.nRLC.add(new BN(5000)).eq(initialBalance.nRLC)).toBe(
      true,
    );
    expect(
      finalBalance.wei
        .add(new BN(5000).mul(new BN(1000000000)))
        .eq(initialBalance.wei),
    ).toBe(true);
    expect(
      receiverFinalBalance.nRLC
        .sub(new BN(5000))
        .eq(receiverInitialBalance.nRLC),
    ).toBe(true);
    expect(
      receiverFinalBalance.wei
        .sub(new BN(5000).mul(new BN(1000000000)))
        .eq(receiverInitialBalance.wei),
    ).toBe(true);
  });

  test('wallet.sendRLC() (token enterprise, receiver whitelisted)', async () => {
    const randomAddress = getRandomAddress();
    await grantKYC(whitelistAdminWallet, enterpriseHubAddress, randomAddress);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    const initialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      randomAddress,
    );
    const txHash = await iexec.wallet.sendRLC(5, randomAddress);
    const finalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      randomAddress,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(finalBalance.nRLC.add(new BN(5)).eq(initialBalance.nRLC)).toBe(true);
    expect(
      receiverFinalBalance.nRLC.sub(new BN(5)).eq(receiverInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.sendRLC() (token enterprise, not whitelisted)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(iexec.wallet.sendRLC(5, getRandomAddress())).rejects.toThrow(
      Error(`${randomWallet.address} is not authorized to interact with eRLC`),
    );
  });

  test('wallet.sendRLC() (token enterprise, receiver not whitelisted)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const receiverAddress = getRandomAddress();
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(iexec.wallet.sendRLC(5, receiverAddress)).rejects.toThrow(
      Error(`${receiverAddress} is not authorized to interact with eRLC`),
    );
  });

  test('wallet.sweep()', async () => {
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const sweeperWallet = getRandomWallet();
    const receiverWallet = getRandomWallet();
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          sweeperWallet.privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.1 ether', sweeperWallet.address);
    await iexecRichman.wallet.sendRLC(20, sweeperWallet.address);
    const initialBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    const res = await iexec.wallet.sweep(receiverWallet.address);
    const finalBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    expect(res.sendNativeTxHash).toMatch(bytes32Regex);
    expect(res.sendERC20TxHash).toMatch(bytes32Regex);
    expect(initialBalance.wei.gt(new BN(0))).toBe(true);
    expect(initialBalance.nRLC.gt(new BN(0))).toBe(true);
    expect(finalBalance.wei.eq(new BN(0))).toBe(true);
    expect(finalBalance.nRLC.eq(new BN(0))).toBe(true);
    expect(receiverFinalBalance.wei.gt(receiverInitialBalance.wei)).toBe(true);
    expect(
      receiverFinalBalance.nRLC
        .sub(initialBalance.nRLC)
        .eq(receiverInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.sweep() (ERC20 fail)', async () => {
    const sweeperWallet = getRandomWallet();
    const receiverWallet = getRandomWallet();
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          sweeperWallet.privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH(100, sweeperWallet.address);
    await iexecRichman.wallet.sendRLC(20, sweeperWallet.address);
    const initialBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    await expect(iexec.wallet.sweep(receiverWallet.address)).rejects.toThrow(
      'Failed to sweep ERC20, sweep aborted. errors: Failed to transfer ERC20: ', // reason message exposed may differ from a ethereum client to another
    );
    const finalBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    expect(initialBalance.wei.gt(new BN(0))).toBe(true);
    expect(initialBalance.nRLC.gt(new BN(0))).toBe(true);
    expect(finalBalance.wei.eq(initialBalance.wei)).toBe(true);
    expect(finalBalance.nRLC.eq(initialBalance.nRLC)).toBe(true);
    expect(receiverFinalBalance.wei.eq(receiverInitialBalance.wei)).toBe(true);
    expect(receiverFinalBalance.nRLC.eq(receiverInitialBalance.nRLC)).toBe(
      true,
    );
  });

  test('wallet.sweep() (ERC20 success, native fail)', async () => {
    const sweeperWallet = getRandomWallet();
    const receiverWallet = getRandomWallet();
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          sweeperWallet.privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('55000000000000', sweeperWallet.address);
    await iexecRichman.wallet.sendRLC(20, sweeperWallet.address);
    const initialBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    const res = await iexec.wallet.sweep(receiverWallet.address);
    const finalBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    expect(res.sendNativeTxHash).toBeUndefined();
    expect(res.sendERC20TxHash).toMatch(bytes32Regex);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toBe(
      "Failed to transfer native token': Tx fees are greater than wallet balance",
    );
    expect(initialBalance.wei.gt(new BN(0))).toBe(true);
    expect(initialBalance.nRLC.gt(new BN(0))).toBe(true);
    expect(finalBalance.wei.gt(new BN(0))).toBe(true);
    expect(finalBalance.nRLC.eq(new BN(0))).toBe(true);
    expect(receiverFinalBalance.wei.eq(receiverInitialBalance.wei)).toBe(true);
    expect(
      receiverFinalBalance.nRLC
        .sub(initialBalance.nRLC)
        .eq(receiverInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.sweep() (native)', async () => {
    const sweeperWallet = getRandomWallet();
    const receiverWallet = getRandomWallet();
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          nativeChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          nativeChainInstamineUrl,
          sweeperWallet.privateKey,
        ),
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    await iexecRichman.wallet.sendRLC(20, sweeperWallet.address);
    const initialBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    const res = await iexec.wallet.sweep(receiverWallet.address);
    const finalBalance = await iexec.wallet.checkBalances(
      sweeperWallet.address,
    );
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      receiverWallet.address,
    );
    expect(res.sendNativeTxHash).toMatch(bytes32Regex);
    expect(res.sendERC20TxHash).toBeUndefined();
    expect(initialBalance.wei.gt(new BN(0))).toBe(true);
    expect(initialBalance.nRLC.gt(new BN(0))).toBe(true);
    expect(finalBalance.wei.eq(new BN(0))).toBe(true);
    expect(finalBalance.nRLC.eq(new BN(0))).toBe(true);
    expect(
      receiverFinalBalance.wei
        .sub(initialBalance.wei)
        .eq(receiverInitialBalance.wei),
    ).toBe(true);
    expect(
      receiverFinalBalance.nRLC
        .sub(initialBalance.nRLC)
        .eq(receiverInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.sweep() (token enterprise, receiver whitelisted)', async () => {
    const randomSenderWallet = getRandomWallet();
    const randomReceiverWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomSenderWallet.address,
    );
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomReceiverWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),

        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          randomSenderWallet.privateKey,
        ),

        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await iexecRichman.wallet.sendETH(
      '10000000000000000',
      randomSenderWallet.address,
    );
    await iexecRichman.wallet.sendRLC(20, randomSenderWallet.address);
    const initialBalance = await iexec.wallet.checkBalances(
      randomSenderWallet.address,
    );
    const receiverInitialBalance = await iexec.wallet.checkBalances(
      randomReceiverWallet.address,
    );
    const res = await iexec.wallet.sweep(randomReceiverWallet.address);
    const finalBalance = await iexec.wallet.checkBalances(
      randomSenderWallet.address,
    );
    const receiverFinalBalance = await iexec.wallet.checkBalances(
      randomReceiverWallet.address,
    );
    expect(res.sendNativeTxHash).toMatch(bytes32Regex);
    expect(res.sendERC20TxHash).toMatch(bytes32Regex);
    expect(initialBalance.wei.gt(new BN(0))).toBe(true);
    expect(initialBalance.nRLC.gt(new BN(0))).toBe(true);
    expect(finalBalance.wei.eq(new BN(0))).toBe(true);
    expect(finalBalance.nRLC.eq(new BN(0))).toBe(true);
    expect(receiverFinalBalance.wei.gt(receiverInitialBalance.wei)).toBe(true);
    expect(
      receiverFinalBalance.nRLC
        .sub(initialBalance.nRLC)
        .eq(receiverInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.sweep() (token enterprise, not whitelisted)', async () => {
    const randomSenderWallet = getRandomWallet();
    const randomReceiverWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomReceiverWallet.address,
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          randomSenderWallet.privateKey,
        ),
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(
      iexec.wallet.sweep(randomReceiverWallet.address),
    ).rejects.toThrow(
      Error(
        `${randomSenderWallet.address} is not authorized to interact with eRLC`,
      ),
    );
  });

  test('wallet.sweep() (token enterprise, receiver not whitelisted)', async () => {
    const randomSenderWallet = getRandomWallet();
    const randomReceiverWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomSenderWallet.address,
    );
    const iexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          randomSenderWallet.privateKey,
        ),
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(
      iexec.wallet.sweep(randomReceiverWallet.address),
    ).rejects.toThrow(
      Error(
        `${randomReceiverWallet.address} is not authorized to interact with eRLC`,
      ),
    );
  });

  test('wallet.wrapEnterpriseRLC() (token standard -> enterprise)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,

        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,

        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );
    const standardInitialBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseInitialBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    const txHash = await iexecStandard.wallet.wrapEnterpriseRLC(5);
    const standardFinalBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseFinalBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(
      standardFinalBalance.nRLC.add(new BN(5)).eq(standardInitialBalance.nRLC),
    ).toBe(true);
    expect(
      enterpriseFinalBalance.nRLC
        .sub(new BN(5))
        .eq(enterpriseInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.wrapEnterpriseRLC() (token standard -> enterprise) (init enterprise)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );
    const standardInitialBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseInitialBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    const txHash = await iexecEnterprise.wallet.wrapEnterpriseRLC(5);
    const standardFinalBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseFinalBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(
      standardFinalBalance.nRLC.add(new BN(5)).eq(standardInitialBalance.nRLC),
    ).toBe(true);
    expect(
      enterpriseFinalBalance.nRLC
        .sub(new BN(5))
        .eq(enterpriseInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.unwrapEnterpriseRLC() (token enterprise -> standard)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );
    const standardInitialBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseInitialBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    const txHash = await iexecEnterprise.wallet.unwrapEnterpriseRLC(5);
    const standardFinalBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseFinalBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(
      standardFinalBalance.nRLC.sub(new BN(5)).eq(standardInitialBalance.nRLC),
    ).toBe(true);
    expect(
      enterpriseFinalBalance.nRLC
        .add(new BN(5))
        .eq(enterpriseInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.unwrapEnterpriseRLC() (token enterprise -> standard) (init standard)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );
    const standardInitialBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseInitialBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    const txHash = await iexecStandard.wallet.unwrapEnterpriseRLC(5);
    const standardFinalBalance = await iexecStandard.wallet.checkBalances(
      randomWallet.address,
    );
    const enterpriseFinalBalance = await iexecEnterprise.wallet.checkBalances(
      randomWallet.address,
    );
    expect(txHash).toMatch(bytes32Regex);
    expect(
      standardFinalBalance.nRLC.sub(new BN(5)).eq(standardInitialBalance.nRLC),
    ).toBe(true);
    expect(
      enterpriseFinalBalance.nRLC
        .add(new BN(5))
        .eq(enterpriseInitialBalance.nRLC),
    ).toBe(true);
  });

  test('wallet.wrapEnterpriseRLC() (token standard -> enterprise, exceed balance)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    await expect(
      iexecStandard.wallet.wrapEnterpriseRLC('2 RLC'),
    ).rejects.toThrow(Error('Amount to wrap exceed wallet balance'));
  });

  test('wallet.unwrapEnterpriseRLC() (token enterprise -> standard, exceed balance)', async () => {
    const randomWallet = getRandomWallet();
    await grantKYC(
      whitelistAdminWallet,
      enterpriseHubAddress,
      randomWallet.address,
    );
    const iexecRichman = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await iexecRichman.wallet.sendETH('0.01 ether', randomWallet.address);
    await iexecRichman.wallet.sendRLC('1 RLC', randomWallet.address);
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );

    await expect(
      iexecEnterprise.wallet.unwrapEnterpriseRLC('2 RLC'),
    ).rejects.toThrow('Amount to unwrap exceed wallet balance');
  });

  test('wallet.wrapEnterpriseRLC() (token standard -> enterprise, not whitelisted)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        enterpriseSwapConf: {
          hubAddress: enterpriseHubAddress,
        },
      },
    );
    await expect(iexecStandard.wallet.wrapEnterpriseRLC(5)).rejects.toThrow(
      Error(`${randomWallet.address} is not authorized to interact with eRLC`),
    );
  });

  test('wallet.unwrapEnterpriseRLC() (token enterprise -> standard not whitelisted)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
        enterpriseSwapConf: {
          hubAddress,
        },
      },
    );
    await expect(iexecEnterprise.wallet.unwrapEnterpriseRLC(5)).rejects.toThrow(
      Error(`${randomWallet.address} is not authorized to interact with eRLC`),
    );
  });

  test('wallet.wrapEnterpriseRLC() (token standard -> enterprise, missing conf)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecEnterprise = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(iexecEnterprise.wallet.wrapEnterpriseRLC(5)).rejects.toThrow(
      `enterpriseSwapConf option not set and no default value for your chain ${networkId}`,
    );
  });

  test('wallet.unwrapEnterpriseRLC() (token enterprise -> standard, missing conf)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecStandard = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    await expect(iexecStandard.wallet.unwrapEnterpriseRLC(5)).rejects.toThrow(
      `enterpriseSwapConf option not set and no default value for your chain ${networkId}`,
    );
  });
});

describe('[account]', () => {
  test('account.checkBalance()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const initialBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    expect(initialBalance.stake).toBeInstanceOf(BN);
    expect(initialBalance.locked).toBeInstanceOf(BN);
    await iexec.account.deposit(5);
    const finalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    expect(finalBalance.stake).toBeInstanceOf(BN);
    expect(finalBalance.locked).toBeInstanceOf(BN);
    expect(finalBalance.stake.sub(new BN(5)).eq(initialBalance.stake)).toBe(
      true,
    );
    expect(finalBalance.locked.eq(initialBalance.locked)).toBe(true);
  });

  test('account.checkBalance() (enterprise)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    const initialBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    expect(initialBalance.stake).toBeInstanceOf(BN);
    expect(initialBalance.locked).toBeInstanceOf(BN);
    await iexec.account.deposit(5);
    const finalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    expect(finalBalance.stake).toBeInstanceOf(BN);
    expect(finalBalance.locked).toBeInstanceOf(BN);
    expect(finalBalance.stake.sub(new BN(5)).eq(initialBalance.stake)).toBe(
      true,
    );
    expect(finalBalance.locked.eq(initialBalance.locked)).toBe(true);
  });

  test('account.checkBridgedBalance() (token)', async () => {
    const signer = utils.getSignerFromPrivateKey(mainnetHost, RICH_PRIVATE_KEY);
    const iexec = new IExec({
      ethProvider: signer,
    });
    const res = await iexec.account.checkBridgedBalance(RICH_ADDRESS);
    expect(res.stake).toBeInstanceOf(BN);
    expect(res.locked).toBeInstanceOf(BN);
  });

  test('account.checkBridgedBalance() (native)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      bellecourHost,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        providerOptions,
      },
    );
    const res = await iexec.account.checkBridgedBalance(RICH_ADDRESS);
    expect(res.stake).toBeInstanceOf(BN);
    expect(res.locked).toBeInstanceOf(BN);
  });

  test('account.deposit() (token)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.deposit(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.sub(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.add(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (token, specified unit)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.deposit('0.005 RLC');
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5000000');
    expect(
      accountFinalBalance.stake
        .sub(new BN('5000000'))
        .eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC
        .add(new BN('5000000'))
        .eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (token, exceed wallet balance)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const { nRLC } = await iexec.wallet.checkBalances(RICH_ADDRESS);
    await expect(iexec.account.deposit(nRLC.add(new BN(1)))).rejects.toThrow(
      Error('Deposit amount exceed wallet balance'),
    );
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(accountFinalBalance.stake.eq(accountInitialBalance.stake)).toBe(
      true,
    );
    expect(walletFinalBalance.nRLC.eq(walletInitialBalance.nRLC)).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (native)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.deposit(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.sub(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.add(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (native, specified unit)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.deposit('0.005 RLC');
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5000000');
    expect(
      accountFinalBalance.stake
        .sub(new BN('5000000'))
        .eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC
        .add(new BN('5000000'))
        .eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (native, exceed wallet balance)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const { nRLC } = await iexec.wallet.checkBalances(RICH_ADDRESS);
    await expect(iexec.account.deposit(nRLC.add(new BN(1)))).rejects.toThrow(
      Error('Deposit amount exceed wallet balance'),
    );
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(accountFinalBalance.stake.eq(accountInitialBalance.stake)).toBe(
      true,
    );
    expect(walletFinalBalance.nRLC.eq(walletInitialBalance.nRLC)).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (token enterprise)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.deposit(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.sub(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.add(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.deposit() (token enterprise, not whitelisted)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(iexec.account.deposit(5)).rejects.toThrow(
      Error(`${randomWallet.address} is not authorized to interact with eRLC`),
    );
  });

  test('account.withdraw() (token)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    await iexec.account.deposit(10);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.withdraw(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.add(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.sub(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (token, specified unit)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    await iexec.account.deposit(10000);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.withdraw('0.000005 RLC');
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5000');
    expect(
      accountFinalBalance.stake
        .add(new BN(5000))
        .eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.sub(new BN(5000)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (token, exceed account balance)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    await iexec.account.deposit(10);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const { stake } = await iexec.account.checkBalance(RICH_ADDRESS);
    await expect(iexec.account.withdraw(stake.add(new BN(1)))).rejects.toThrow(
      Error('Withdraw amount exceed account balance'),
    );
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(accountFinalBalance.stake.eq(accountInitialBalance.stake)).toBe(
      true,
    );
    expect(walletFinalBalance.nRLC.eq(walletInitialBalance.nRLC)).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (native)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    await iexec.account.deposit(10);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.withdraw(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.add(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.sub(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (native, specified unit)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    await iexec.account.deposit(10000);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.withdraw('0.000005 RLC');
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5000');
    expect(
      accountFinalBalance.stake
        .add(new BN(5000))
        .eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.sub(new BN(5000)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (native, exceed account balance)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      nativeChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress: nativeHubAddress,
        isNative: true,
        useGas: false,
      },
    );
    await iexec.account.deposit(10);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const { stake } = await iexec.account.checkBalance(RICH_ADDRESS);
    await expect(iexec.account.withdraw(stake.add(new BN(1)))).rejects.toThrow(
      Error('Withdraw amount exceed account balance'),
    );
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(accountFinalBalance.stake.eq(accountInitialBalance.stake)).toBe(
      true,
    );
    expect(walletFinalBalance.nRLC.eq(walletInitialBalance.nRLC)).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (withdraw amount 0)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    await expect(iexec.account.withdraw(0)).rejects.toThrow(
      Error('Withdraw amount must be greater than 0'),
    );
  });

  test('account.withdraw() (token enterprise)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await iexec.account.deposit(10);
    const accountInitialBalance = await iexec.account.checkBalance(
      RICH_ADDRESS,
    );
    const walletInitialBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    const res = await iexec.account.withdraw(5);
    const accountFinalBalance = await iexec.account.checkBalance(RICH_ADDRESS);
    const walletFinalBalance = await iexec.wallet.checkBalances(RICH_ADDRESS);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.amount).toBe('5');
    expect(
      accountFinalBalance.stake.add(new BN(5)).eq(accountInitialBalance.stake),
    ).toBe(true);
    expect(
      walletFinalBalance.nRLC.sub(new BN(5)).eq(walletInitialBalance.nRLC),
    ).toBe(true);
    expect(accountFinalBalance.locked.eq(accountInitialBalance.locked)).toBe(
      true,
    );
  });

  test('account.withdraw() (token enterprise, not whitelisted)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
        flavour: 'enterprise',
      },
      {
        hubAddress: enterpriseHubAddress,
      },
    );
    await expect(iexec.account.withdraw(5)).rejects.toThrow(
      Error(`${randomWallet.address} is not authorized to interact with eRLC`),
    );
  });
});

describe('[app]', () => {
  test('app.deployApp()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = {
      owner: await iexec.wallet.getAddress(),
      name: `app${getId()}`,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    };
    const res = await iexec.app.deployApp(app);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.address).toMatch(addressRegex);

    await expect(iexec.app.deployApp(app)).rejects.toThrow(
      Error(`App already deployed at address ${res.address}`),
    );
  });

  test('app.predictAppAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = {
      owner: await iexec.wallet.getAddress(),
      name: `app${getId()}`,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    };
    const res = await iexec.app.predictAppAddress(app);
    const { address } = await iexec.app.deployApp(app);
    expect(res).toBe(address);
  });

  test('app.predictAppAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = {
      owner: await iexec.wallet.getAddress(),
      name: `app${getId()}`,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    };
    const predictedAddress = await iexec.app.predictAppAddress(app);
    await expect(iexec.app.checkDeployedApp(predictedAddress)).resolves.toBe(
      false,
    );
    await iexec.app.deployApp(app);
    await expect(iexec.app.checkDeployedApp(predictedAddress)).resolves.toBe(
      true,
    );
  });

  test('app.transferApp()', async () => {
    const receiverAddress = getRandomAddress();
    const iexecAppOwner = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomApp(iexecAppOwner);
    const iexecRandom = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          getRandomWallet().privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await expect(
      iexecRandom.app.transferApp(getRandomAddress(), receiverAddress),
    ).rejects.toThrow(Error('Invalid app address'));
    await expect(
      iexecRandom.app.transferApp(address, receiverAddress),
    ).rejects.toThrow(Error('Only app owner can transfer app ownership'));
    const res = await iexecAppOwner.app.transferApp(address, receiverAddress);
    expect(res.address).toBe(address);
    expect(res.to).toBe(receiverAddress);
    expect(res.txHash).toMatch(bytes32Regex);
    const { app } = await iexecRandom.app.showApp(address);
    expect(app.owner).toBe(receiverAddress);
  });

  test('app.showApp()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = {
      owner: await iexec.wallet.getAddress(),
      name: `app${getId()}`,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
      mrenclave: {
        framework: 'SCONE',
        version: 'v5',
        entrypoint: 'python /app/app.py',
        heapSize: 1073741824,
        fingerprint:
          'eca3ace86f1e8a5c47123c8fd271319e9eb25356803d36666dc620f30365c0c1',
      },
    };
    const { address } = await iexec.app.deployApp(app);

    const res = await iexec.app.showApp(address);
    expect(res.objAddress).toBe(address);
    expect(res.app.owner).toBe(app.owner);
    expect(res.app.registry).toMatch(addressRegex);
    expect(res.app.appName).toBe(app.name);
    expect(res.app.appType).toBe(app.type);
    expect(res.app.appMultiaddr).toBe(app.multiaddr);
    expect(res.app.appChecksum).toBe(app.checksum);
    expect(res.app.appMREnclave).toBe(JSON.stringify(app.mrenclave));

    await expect(iexec.app.showApp(NULL_ADDRESS)).rejects.toThrow(
      new errors.ObjectNotFoundError('app', NULL_ADDRESS, networkId),
    );
  });

  test('app.countUserApps()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const resBeforeDeploy = await iexec.app.countUserApps(userAddress);
    await deployRandomApp(iexec);
    const res = await iexec.app.countUserApps(userAddress);
    expect(resBeforeDeploy).toBeInstanceOf(BN);
    expect(res).toBeInstanceOf(BN);
    expect(resBeforeDeploy.add(new BN(1)).eq(res)).toBe(true);
  });

  test('app.showUserApp()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const app = {
      owner: userAddress,
      name: `app${getId()}`,
      type: 'DOCKER',
      multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
      checksum:
        '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
      mrenclave: {
        framework: 'SCONE',
        version: 'v5',
        entrypoint: 'python /app/app.py',
        heapSize: 1073741824,
        fingerprint:
          'eca3ace86f1e8a5c47123c8fd271319e9eb25356803d36666dc620f30365c0c1',
      },
    };
    const { address } = await iexec.app.deployApp(app);
    const count = await iexec.app.countUserApps(userAddress);
    const res = await iexec.app.showUserApp(count.sub(new BN(1)), userAddress);
    expect(res.objAddress).toBe(address);
    expect(res.app.owner).toBe(app.owner);
    expect(res.app.registry).toMatch(addressRegex);
    expect(res.app.appName).toBe(app.name);
    expect(res.app.appType).toBe(app.type);
    expect(res.app.appMultiaddr).toBe(app.multiaddr);
    expect(res.app.appChecksum).toBe(app.checksum);
    expect(res.app.appMREnclave).toBe(JSON.stringify(app.mrenclave));
    await expect(iexec.app.showUserApp(count, userAddress)).rejects.toThrow(
      Error('app not deployed'),
    );
  });

  test('app.pushAppSecret()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const { address } = await deployRandomApp(iexec, {
      teeFramework: TEE_FRAMEWORKS.GRAMINE,
    });
    const randomWallet = getRandomWallet();
    const randomIexec = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainOpenethereumUrl,
          randomWallet.privateKey,
        ),
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    // only owner can push secret
    await expect(randomIexec.app.pushAppSecret(address, 'foo')).rejects.toThrow(
      Error(
        `Wallet ${randomWallet.address} is not allowed to set secret for ${address}`,
      ),
    );
    // infer teeFramework to use
    await expect(iexec.app.pushAppSecret(address, 'foo')).resolves.toBe(true);
    // can't update existing secret
    await expect(iexec.app.pushAppSecret(address, 'foo')).rejects.toThrow(
      Error(`Secret already exists for ${address} and can't be updated`),
    );
    // check inferred teeFramework with teeFramework option
    await expect(
      iexec.app.pushAppSecret(address, 'foo', { teeFramework: 'gramine' }),
    ).rejects.toThrow(
      Error(`Secret already exists for ${address} and can't be updated`),
    );
    // check teeFramework option
    await expect(
      iexec.app.pushAppSecret(address, 'foo', { teeFramework: 'scone' }),
    ).resolves.toBe(true);
    // validate teeFramework
    await expect(
      iexec.app.pushAppSecret(address, 'foo', { teeFramework: 'foo' }),
    ).rejects.toThrow(Error('teeFramework is not a valid TEE framework'));
  });

  test('app.checkAppSecretExists()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const { address } = await deployRandomApp(iexec, {
      teeFramework: TEE_FRAMEWORKS.GRAMINE,
    });
    await expect(iexec.app.checkAppSecretExists(address)).resolves.toBe(false);
    await iexec.app.pushAppSecret(address, 'foo');
    // infer teeFramework to use
    await expect(iexec.app.checkAppSecretExists(address)).resolves.toBe(true);
    // check inferred teeFramework with teeFramework option
    await expect(
      iexec.app.checkAppSecretExists(address, { teeFramework: 'gramine' }),
    ).resolves.toBe(true);
    // check teeFramework option
    await expect(
      iexec.app.checkAppSecretExists(address, { teeFramework: 'scone' }),
    ).resolves.toBe(false);
    // validate teeFramework
    await expect(
      iexec.app.checkAppSecretExists(address, { teeFramework: 'foo' }),
    ).rejects.toThrow(Error('teeFramework is not a valid TEE framework'));
  });
});

describe('[dataset]', () => {
  test('dataset.generateEncryptionKey()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const key = iexec.dataset.generateEncryptionKey();
    expect(typeof key).toBe('string');
    expect(Buffer.from(key, 'base64').length).toBe(32);
  });

  test('dataset.encrypt()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const key = iexec.dataset.generateEncryptionKey();
    const encryptedBytes = await iexec.dataset.encrypt(
      await readFile(join(process.cwd(), 'test/inputs/files/text.zip')),
      key,
    );
    expect(encryptedBytes).toBeInstanceOf(Buffer);
    expect(encryptedBytes.length).toBe(224);

    // decrypt with openssl
    const outDirPath = join(process.cwd(), 'test/out');
    await ensureDir(outDirPath).then(() =>
      writeFile(join(outDirPath, 'dataset.enc'), encryptedBytes),
    );
    const encryptedFilePath = join(outDirPath, 'dataset.enc');
    const decryptedFilePath = join(outDirPath, 'decrypted.zip');
    await expect(
      execAsync(
        `tail -c+17 "${encryptedFilePath}" | openssl enc -d -aes-256-cbc -out "${decryptedFilePath}" -K $(echo "${iexec.dataset.generateEncryptionKey()}" | base64 -d | xxd -p -c 32) -iv $(head -c 16 "${encryptedFilePath}" | xxd -p -c 16)`,
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      execAsync(
        `tail -c+17 "${encryptedFilePath}" | openssl enc -d -aes-256-cbc -out "${decryptedFilePath}" -K $(echo "${key}" | base64 -d | xxd -p -c 32) -iv $(head -c 16 "${encryptedFilePath}" | xxd -p -c 16)`,
      ),
    ).resolves.toBeDefined();
  });

  test('dataset.computeEncryptedFileChecksum()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const key = iexec.dataset.generateEncryptionKey();
    const fileBytes = await readFile(
      join(process.cwd(), 'test/inputs/files/text.zip'),
    );

    const originalFileChecksum =
      await iexec.dataset.computeEncryptedFileChecksum(fileBytes);
    expect(originalFileChecksum).toBe(
      '0x43836bca5914a130343c143d8146a4a75690fc08445fd391a2c6cf9b48694515',
    );

    const encryptedFileBytes = await iexec.dataset.encrypt(fileBytes, key);
    const encryptedFileChecksum =
      await iexec.dataset.computeEncryptedFileChecksum(encryptedFileBytes);
    expect(encryptedFileChecksum).toMatch(bytes32Regex);
  });

  test('dataset.deployDataset()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = {
      owner: await iexec.wallet.getAddress(),
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    const res = await iexec.dataset.deployDataset(dataset);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.address).toMatch(addressRegex);

    await expect(iexec.dataset.deployDataset(dataset)).rejects.toThrow(
      Error(`Dataset already deployed at address ${res.address}`),
    );
  });

  test('dataset.predictDatasetAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = {
      owner: await iexec.wallet.getAddress(),
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    const res = await iexec.dataset.predictDatasetAddress(dataset);
    const { address } = await iexec.dataset.deployDataset(dataset);
    expect(res).toBe(address);
  });

  test('dataset.predictDatasetAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = {
      owner: await iexec.wallet.getAddress(),
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    const predictedAddress = await iexec.dataset.predictDatasetAddress(dataset);
    await expect(
      iexec.dataset.checkDeployedDataset(predictedAddress),
    ).resolves.toBe(false);
    await iexec.dataset.deployDataset(dataset);
    await expect(
      iexec.dataset.checkDeployedDataset(predictedAddress),
    ).resolves.toBe(true);
  });

  test('dataset.transferDataset()', async () => {
    const receiverAddress = getRandomAddress();
    const iexecDatasetOwner = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomDataset(iexecDatasetOwner);
    const iexecRandom = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          getRandomWallet().privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await expect(
      iexecRandom.dataset.transferDataset(getRandomAddress(), receiverAddress),
    ).rejects.toThrow(Error('Invalid dataset address'));
    await expect(
      iexecRandom.dataset.transferDataset(address, receiverAddress),
    ).rejects.toThrow(
      Error('Only dataset owner can transfer dataset ownership'),
    );
    const res = await iexecDatasetOwner.dataset.transferDataset(
      address,
      receiverAddress,
    );
    expect(res.address).toBe(address);
    expect(res.to).toBe(receiverAddress);
    expect(res.txHash).toMatch(bytes32Regex);
    const { dataset } = await iexecRandom.dataset.showDataset(address);
    expect(dataset.owner).toBe(receiverAddress);
  });

  test('dataset.showDataset()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = {
      owner: await iexec.wallet.getAddress(),
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    const { address } = await iexec.dataset.deployDataset(dataset);

    const res = await iexec.dataset.showDataset(address);
    expect(res.objAddress).toBe(address);
    expect(res.dataset.owner).toBe(dataset.owner);
    expect(res.dataset.registry).toMatch(addressRegex);
    expect(res.dataset.datasetName).toBe(dataset.name);
    expect(res.dataset.datasetMultiaddr).toBe(dataset.multiaddr);
    expect(res.dataset.datasetChecksum).toBe(dataset.checksum);

    await expect(iexec.dataset.showDataset(NULL_ADDRESS)).rejects.toThrow(
      new errors.ObjectNotFoundError('dataset', NULL_ADDRESS, networkId),
    );
  });

  test('dataset.countUserDatasets()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const resBeforeDeploy = await iexec.dataset.countUserDatasets(userAddress);
    await deployRandomDataset(iexec);
    const res = await iexec.dataset.countUserDatasets(userAddress);
    expect(resBeforeDeploy).toBeInstanceOf(BN);
    expect(res).toBeInstanceOf(BN);
    expect(resBeforeDeploy.add(new BN(1)).eq(res)).toBe(true);
  });

  test('dataset.showUserDataset()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const dataset = {
      owner: userAddress,
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    const { address } = await iexec.dataset.deployDataset(dataset);
    const count = await iexec.dataset.countUserDatasets(userAddress);
    const res = await iexec.dataset.showUserDataset(
      count.sub(new BN(1)),
      userAddress,
    );
    expect(res.objAddress).toBe(address);
    expect(res.dataset.owner).toBe(dataset.owner);
    expect(res.dataset.registry).toMatch(addressRegex);
    expect(res.dataset.datasetName).toBe(dataset.name);
    expect(res.dataset.datasetMultiaddr).toBe(dataset.multiaddr);
    expect(res.dataset.datasetChecksum).toBe(dataset.checksum);
    await expect(
      iexec.dataset.showUserDataset(count, userAddress),
    ).rejects.toThrow(Error('dataset not deployed'));
  });

  test('dataset.pushDatasetSecret()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,

        smsURL: smsMap,
      },
    );
    const datasetDeployRes = await iexec.dataset.deployDataset({
      owner: await iexec.wallet.getAddress(),
      name: `dataset${getId()}`,
      multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
    const datasetAddress = datasetDeployRes.address;
    const pushRes = await iexec.dataset.pushDatasetSecret(
      datasetAddress,
      'oops',
    );
    expect(pushRes).toBe(true);
    await expect(
      iexec.dataset.pushDatasetSecret(datasetAddress, 'oops'),
    ).rejects.toThrow(
      Error(`Secret already exists for ${datasetAddress} and can't be updated`),
    );
    const newDatasetDeployRes = await deployRandomDataset(iexec);
    const newDatasetAddress = newDatasetDeployRes.address;
    await expect(
      iexec.dataset.pushDatasetSecret(newDatasetAddress, 'oops', {
        teeFramework: 'Wrong TEE',
      }),
    ).rejects.toThrow(Error('teeFramework is not a valid TEE framework'));

    await expect(
      iexec.dataset.pushDatasetSecret(newDatasetAddress, 'oops', {
        teeFramework: TEE_FRAMEWORKS.GRAMINE,
      }),
    ).resolves.toBe(true);
  });

  test('dataset.pushDatasetSecret() (not deployed)', async () => {
    const randomAddress = getRandomAddress();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    await expect(
      iexec.dataset.pushDatasetSecret(randomAddress, 'oops'),
    ).rejects.toThrow(
      Error(
        `Wallet ${RICH_ADDRESS} is not allowed to set secret for ${randomAddress}`,
      ),
    );
  });

  test('dataset.pushDatasetSecret() (invalid owner)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const datasetDeployRes = await deployRandomDataset(iexec, {
      owner: getRandomAddress(),
    });
    const datasetAddress = datasetDeployRes.address;
    await expect(
      iexec.dataset.pushDatasetSecret(datasetAddress, 'oops'),
    ).rejects.toThrow(
      Error(
        `Wallet ${RICH_ADDRESS} is not allowed to set secret for ${datasetAddress}`,
      ),
    );
  });

  test('dataset.checkDatasetSecretExists()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const datasetDeployRes = await deployRandomDataset(iexec);
    const datasetAddress = datasetDeployRes.address;
    const withoutSecretRes = await iexec.dataset.checkDatasetSecretExists(
      datasetAddress,
    );
    expect(withoutSecretRes).toBe(false);
    await iexec.dataset.pushDatasetSecret(datasetAddress, 'oops');
    const withSecretRes = await iexec.dataset.checkDatasetSecretExists(
      datasetAddress,
    );
    expect(withSecretRes).toBe(true);

    const datasetDeployedGramine = await deployRandomDataset(iexec);
    const datasetAddressGramine = datasetDeployedGramine.address;
    await iexec.dataset.pushDatasetSecret(datasetAddressGramine, 'oops', {
      teeFramework: TEE_FRAMEWORKS.GRAMINE,
    });
    const wrongTeeRes = await iexec.dataset.checkDatasetSecretExists(
      datasetAddressGramine,
      { teeFramework: TEE_FRAMEWORKS.SCONE },
    );
    expect(wrongTeeRes).toBe(false);
    const goodTeeRes = await iexec.dataset.checkDatasetSecretExists(
      datasetAddressGramine,
      { teeFramework: TEE_FRAMEWORKS.GRAMINE },
    );
    expect(goodTeeRes).toBe(true);
  });
});

describe('[workerpool]', () => {
  test('workerpool.deployWorkerpool()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = {
      owner: await iexec.wallet.getAddress(),
      description: `workerpool${getId()}`,
    };
    const res = await iexec.workerpool.deployWorkerpool(workerpool);
    expect(res.txHash).toMatch(bytes32Regex);
    expect(res.address).toMatch(addressRegex);

    await expect(iexec.workerpool.deployWorkerpool(workerpool)).rejects.toThrow(
      Error(`Workerpool already deployed at address ${res.address}`),
    );
  });

  test('workerpool.predictWorkerpoolAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = {
      owner: await iexec.wallet.getAddress(),
      description: `workerpool${getId()}`,
    };
    const res = await iexec.workerpool.predictWorkerpoolAddress(workerpool);
    const { address } = await iexec.workerpool.deployWorkerpool(workerpool);
    expect(res).toBe(address);
  });

  test('workerpool.predictWorkerpoolAddress()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = {
      owner: await iexec.wallet.getAddress(),
      description: `workerpool${getId()}`,
    };
    const predictedAddress = await iexec.workerpool.predictWorkerpoolAddress(
      workerpool,
    );
    await expect(
      iexec.workerpool.checkDeployedWorkerpool(predictedAddress),
    ).resolves.toBe(false);
    await iexec.workerpool.deployWorkerpool(workerpool);
    await expect(
      iexec.workerpool.checkDeployedWorkerpool(predictedAddress),
    ).resolves.toBe(true);
  });

  test('workerpool.transferWorkerpool()', async () => {
    const receiverAddress = getRandomAddress();
    const iexecWorkerpoolOwner = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          RICH_PRIVATE_KEY,
        ),
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomWorkerpool(iexecWorkerpoolOwner);
    const iexecRandom = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          tokenChainInstamineUrl,
          getRandomWallet().privateKey,
        ),
      },
      {
        hubAddress,
      },
    );
    await expect(
      iexecRandom.workerpool.transferWorkerpool(
        getRandomAddress(),
        receiverAddress,
      ),
    ).rejects.toThrow(Error('Invalid workerpool address'));
    await expect(
      iexecRandom.workerpool.transferWorkerpool(address, receiverAddress),
    ).rejects.toThrow(
      Error('Only workerpool owner can transfer workerpool ownership'),
    );
    const res = await iexecWorkerpoolOwner.workerpool.transferWorkerpool(
      address,
      receiverAddress,
    );
    expect(res.address).toBe(address);
    expect(res.to).toBe(receiverAddress);
    expect(res.txHash).toMatch(bytes32Regex);
    const { workerpool } = await iexecRandom.workerpool.showWorkerpool(address);
    expect(workerpool.owner).toBe(receiverAddress);
  });

  test('workerpool.setWorkerpoolApiUrl()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    const { address } = await deployRandomWorkerpool(iexec);
    const label = address.toLowerCase();
    const domain = 'users.iexec.eth';
    const name = `${label}.${domain}`;
    await iexec.ens.claimName(label, domain);
    await iexec.ens.configureResolution(name, address);
    const res = await iexec.workerpool.setWorkerpoolApiUrl(
      address,
      'https://my-workerpool.com',
    );
    expect(res).toMatch(bytes32Regex);
  });

  test('workerpool.getWorkerpoolApiUrl()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    const { address } = await deployRandomWorkerpool(iexec);
    const resNoApiUrl = await iexec.workerpool.getWorkerpoolApiUrl(address);
    expect(resNoApiUrl).toBe(undefined);

    const label = address.toLowerCase();
    const domain = 'users.iexec.eth';
    const name = `${label}.${domain}`;
    await iexec.ens.claimName(label, domain);
    await iexec.ens.configureResolution(name, address);
    const apiUrl = 'https://my-workerpool.com';
    await iexec.workerpool.setWorkerpoolApiUrl(address, apiUrl);
    const resConfigured = await iexec.workerpool.getWorkerpoolApiUrl(address);
    expect(resConfigured).toBe(apiUrl);
  });

  test('workerpool.showWorkerpool()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = {
      owner: await iexec.wallet.getAddress(),
      description: `workerpool${getId()}`,
    };
    const { address } = await iexec.workerpool.deployWorkerpool(workerpool);

    const res = await iexec.workerpool.showWorkerpool(address);
    expect(res.objAddress).toBe(address);
    expect(res.workerpool.owner).toBe(workerpool.owner);
    expect(res.workerpool.registry).toMatch(addressRegex);
    expect(res.workerpool.schedulerRewardRatioPolicy).toBeInstanceOf(BN);
    expect(res.workerpool.workerStakeRatioPolicy).toBeInstanceOf(BN);
    expect(res.workerpool.workerpoolDescription).toBe(workerpool.description);

    await expect(iexec.workerpool.showWorkerpool(NULL_ADDRESS)).rejects.toThrow(
      new errors.ObjectNotFoundError('workerpool', NULL_ADDRESS, networkId),
    );
  });

  test('workerpool.countUserWorkerpools()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const resBeforeDeploy = await iexec.workerpool.countUserWorkerpools(
      userAddress,
    );
    await deployRandomWorkerpool(iexec);
    const res = await iexec.workerpool.countUserWorkerpools(userAddress);
    expect(resBeforeDeploy).toBeInstanceOf(BN);
    expect(res).toBeInstanceOf(BN);
    expect(resBeforeDeploy.add(new BN(1)).eq(res)).toBe(true);
  });

  test('workerpool.showUserWorkerpool()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const userAddress = await iexec.wallet.getAddress();
    const workerpool = {
      owner: userAddress,
      description: `workerpool${getId()}`,
    };
    const { address } = await iexec.workerpool.deployWorkerpool(workerpool);
    const count = await iexec.workerpool.countUserWorkerpools(userAddress);
    const res = await iexec.workerpool.showUserWorkerpool(
      count.sub(new BN(1)),
      userAddress,
    );
    expect(res.objAddress).toBe(address);
    expect(res.workerpool.owner).toBe(workerpool.owner);
    expect(res.workerpool.registry).toMatch(addressRegex);
    expect(res.workerpool.schedulerRewardRatioPolicy).toBeInstanceOf(BN);
    expect(res.workerpool.workerStakeRatioPolicy).toBeInstanceOf(BN);
    expect(res.workerpool.workerpoolDescription).toBe(workerpool.description);
    await expect(
      iexec.workerpool.showUserWorkerpool(count, userAddress),
    ).rejects.toThrow(Error('workerpool not deployed'));
  });
});

describe('[order]', () => {
  test('order.createApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = getRandomAddress();
    const order = await iexec.order.createApporder({
      app,
    });
    expect(order).toEqual({
      app,
      appprice: '0',
      datasetrestrict: '0x0000000000000000000000000000000000000000',
      requesterrestrict: '0x0000000000000000000000000000000000000000',
      tag: '0x0000000000000000000000000000000000000000000000000000000000000000',
      volume: '1',
      workerpoolrestrict: '0x0000000000000000000000000000000000000000',
    });
  });

  test('order.createApporder() (override defaults)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const app = getRandomAddress();
    const datasetrestrict = getRandomAddress();
    const workerpoolrestrict = getRandomAddress();
    const requesterrestrict = getRandomAddress();
    const order = await iexec.order.createApporder({
      app,
      appprice: '1 RLC',
      datasetrestrict,
      workerpoolrestrict,
      requesterrestrict,
      tag: ['tee', 'scone'],
      volume: 100,
    });
    expect(order).toEqual({
      app,
      appprice: '1000000000',
      datasetrestrict,
      requesterrestrict,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
      volume: '100',
      workerpoolrestrict,
    });
  });

  test('order.createDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = getRandomAddress();
    const order = await iexec.order.createDatasetorder({
      dataset,
    });
    expect(order).toEqual({
      apprestrict: '0x0000000000000000000000000000000000000000',
      dataset,
      datasetprice: '0',
      requesterrestrict: '0x0000000000000000000000000000000000000000',
      tag: '0x0000000000000000000000000000000000000000000000000000000000000000',
      volume: '1',
      workerpoolrestrict: '0x0000000000000000000000000000000000000000',
    });
  });

  test('order.createDatasetorder() (override defaults)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const dataset = getRandomAddress();
    const apprestrict = getRandomAddress();
    const workerpoolrestrict = getRandomAddress();
    const requesterrestrict = getRandomAddress();
    const order = await iexec.order.createDatasetorder({
      dataset,
      datasetprice: '1 RLC',
      apprestrict,
      workerpoolrestrict,
      requesterrestrict,
      tag: ['tee', 'scone'],
      volume: 100,
    });
    expect(order).toEqual({
      dataset,
      datasetprice: '1000000000',
      apprestrict,
      requesterrestrict,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
      volume: '100',
      workerpoolrestrict,
    });
  });

  test('order.createWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = getRandomAddress();
    const order = await iexec.order.createWorkerpoolorder({
      workerpool,
      category: 5,
    });
    expect(order).toEqual({
      apprestrict: '0x0000000000000000000000000000000000000000',
      category: '5',
      datasetrestrict: '0x0000000000000000000000000000000000000000',
      requesterrestrict: '0x0000000000000000000000000000000000000000',
      tag: '0x0000000000000000000000000000000000000000000000000000000000000000',
      trust: '0',
      volume: '1',
      workerpool,
      workerpoolprice: '0',
    });
  });

  test('order.createWorkerpoolorder() (override defaults)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const workerpool = getRandomAddress();
    const apprestrict = getRandomAddress();
    const datasetrestrict = getRandomAddress();
    const requesterrestrict = getRandomAddress();
    const order = await iexec.order.createWorkerpoolorder({
      workerpool,
      workerpoolprice: '0.1 RLC',
      category: 5,
      apprestrict,
      datasetrestrict,
      requesterrestrict,
      tag: ['tee', 'scone'],
      trust: '10',
      volume: '100',
    });
    expect(order).toEqual({
      apprestrict,
      category: '5',
      datasetrestrict,
      requesterrestrict,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
      trust: '10',
      volume: '100',
      workerpool,
      workerpoolprice: '100000000',
    });
  });

  test('order.createRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const app = getRandomAddress();
    const order = await iexec.order.createRequestorder({
      app,
      category: 5,
    });
    expect(order).toEqual({
      app,
      appmaxprice: '0',
      beneficiary: RICH_ADDRESS,
      callback: '0x0000000000000000000000000000000000000000',
      category: '5',
      dataset: '0x0000000000000000000000000000000000000000',
      datasetmaxprice: '0',
      params: {
        iexec_result_storage_provider: 'ipfs',
        iexec_result_storage_proxy: 'https://result-proxy.iex.ec',
      },
      requester: RICH_ADDRESS,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000000',
      trust: '0',
      volume: '1',
      workerpool: '0x0000000000000000000000000000000000000000',
      workerpoolmaxprice: '0',
    });
  });

  test('order.createRequestorder() (override defaults)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const app = getRandomAddress();
    const dataset = getRandomAddress();
    const workerpool = getRandomAddress();
    const callback = getRandomAddress();
    const order = await iexec.order.createRequestorder({
      app,
      category: 5,
      dataset,
      workerpool,
      callback,
      appmaxprice: '1 nRLC',
      datasetmaxprice: '100 nRLC',
      workerpoolmaxprice: '0.1 RLC',
      params: {
        iexec_result_storage_provider: 'dropbox',
        iexec_result_encryption: true,
      },
      tag: ['tee', 'scone'],
      trust: '100',
      volume: '5',
    });
    expect(order).toEqual({
      app,
      appmaxprice: '1',
      beneficiary: RICH_ADDRESS,
      callback,
      category: '5',
      dataset,
      datasetmaxprice: '100',
      params: {
        iexec_result_storage_provider: 'dropbox',
        iexec_result_encryption: true,
      },
      requester: RICH_ADDRESS,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
      trust: '100',
      volume: '5',
      workerpool,
      workerpoolmaxprice: '100000000',
    });
  });

  test('order.createRequestorder() with iexec_secrets', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const app = getRandomAddress();
    const order = await iexec.order.createRequestorder({
      app,
      category: 5,
      params: {
        iexec_secrets: {
          1: 'foo',
        },
      },
      tag: ['tee', 'scone'],
    });
    expect(order).toEqual({
      app,
      appmaxprice: '0',
      beneficiary: RICH_ADDRESS,
      callback: '0x0000000000000000000000000000000000000000',
      category: '5',
      dataset: '0x0000000000000000000000000000000000000000',
      datasetmaxprice: '0',
      params: {
        iexec_secrets: {
          1: 'foo',
        },
        iexec_result_storage_provider: 'ipfs',
        iexec_result_storage_proxy: 'https://result-proxy.iex.ec',
      },
      requester: RICH_ADDRESS,
      tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
      trust: '0',
      volume: '1',
      workerpool: '0x0000000000000000000000000000000000000000',
      workerpoolmaxprice: '0',
    });
  });

  test('order.signApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomApp(iexec);
    const order = await iexec.order.createApporder({
      app: address,
    });

    const res = await iexec.order.signApporder(order);
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signApporder() preflightCheck TEE framework', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomApp(iexec, {
      teeFramework: TEE_FRAMEWORKS.GRAMINE,
    });
    const order = await iexec.order.createApporder({
      app: address,
    });
    await expect(iexec.order.signApporder(order)).rejects.toThrow(
      Error('Tag mismatch the TEE framework specified by app'),
    );
    await expect(
      iexec.order.signApporder({ ...order, tag: ['tee', 'scone'] }),
    ).rejects.toThrow(Error('Tag mismatch the TEE framework specified by app'));
    await expect(
      iexec.order.signApporder({ ...order, tag: ['tee', 'gramine'] }),
    ).resolves.toBeDefined();
  });

  test('order.signApporder() preflightCheck invalid tag', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createApporder({
      app: getRandomAddress(),
    });
    await expect(
      iexec.order.signApporder({ ...order, tag: ['tee'] }),
    ).rejects.toThrow(
      Error("'tee' tag must be used with a tee framework ('scone'|'gramine')"),
    );
    await expect(
      iexec.order.signApporder({ ...order, tag: ['scone'] }),
    ).rejects.toThrow(Error("'scone' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signApporder({ ...order, tag: ['gramine'] }),
    ).rejects.toThrow(Error("'gramine' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signApporder({
        ...order,
        tag: ['tee', 'scone', 'gramine'],
      }),
    ).rejects.toThrow(
      Error("tee framework tags are exclusive ('scone'|'gramine')"),
    );
  });

  test('order.signDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomDataset(iexec);
    const order = await iexec.order.createDatasetorder({
      dataset: address,
    });

    const res = await iexec.order.signDatasetorder(order, {
      preflightCheck: false,
    });
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signDatasetorder() preflightCheck dataset secret', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const { address } = await deployRandomDataset(iexec);
    const order = await iexec.order.createDatasetorder({
      dataset: address,
    });
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['tee', 'scone'] }),
    ).rejects.toThrow(
      Error(
        `Dataset encryption key is not set for dataset ${address} in the SMS. Dataset decryption will fail.`,
      ),
    );
    await iexec.dataset.pushDatasetSecret(
      address,
      iexec.dataset.generateEncryptionKey(),
    );
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['tee', 'scone'] }),
    ).resolves.toBeDefined();
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['tee', 'gramine'] }),
    ).rejects.toThrow(
      Error(
        `Dataset encryption key is not set for dataset ${address} in the SMS. Dataset decryption will fail.`,
      ),
    );
  });

  test('order.signDatasetorder() preflightCheck invalid tag', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createDatasetorder({
      dataset: getRandomAddress(),
    });
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['tee'] }),
    ).rejects.toThrow(
      Error("'tee' tag must be used with a tee framework ('scone'|'gramine')"),
    );
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['scone'] }),
    ).rejects.toThrow(Error("'scone' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signDatasetorder({ ...order, tag: ['gramine'] }),
    ).rejects.toThrow(Error("'gramine' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signDatasetorder({
        ...order,
        tag: ['tee', 'scone', 'gramine'],
      }),
    ).rejects.toThrow(
      Error("tee framework tags are exclusive ('scone'|'gramine')"),
    );
  });

  test('order.signWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const { address } = await deployRandomWorkerpool(iexec);
    const order = await iexec.order.createWorkerpoolorder({
      workerpool: address,
      category: 5,
    });

    const res = await iexec.order.signWorkerpoolorder(order);
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const order = await iexec.order.createRequestorder({
      app: getRandomAddress(),
      category: 5,
    });

    const res = await iexec.order.signRequestorder(order, {
      preflightCheck: false,
    });
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ params: JSON.stringify(order.params) },
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signRequestorder() preflightCheck invalid tag', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createRequestorder({
      app: getRandomAddress(),
      category: 5,
    });
    await expect(
      iexec.order.signRequestorder({ ...order, tag: ['tee'] }),
    ).rejects.toThrow(
      Error("'tee' tag must be used with a tee framework ('scone'|'gramine')"),
    );
    await expect(
      iexec.order.signRequestorder({ ...order, tag: ['scone'] }),
    ).rejects.toThrow(Error("'scone' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signRequestorder({ ...order, tag: ['gramine'] }),
    ).rejects.toThrow(Error("'gramine' tag must be used with 'tee' tag"));
    await expect(
      iexec.order.signRequestorder({
        ...order,
        tag: ['tee', 'scone', 'gramine'],
      }),
    ).rejects.toThrow(
      Error("tee framework tags are exclusive ('scone'|'gramine')"),
    );
  });

  test('order.signRequestorder() preflightCheck default storage', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createRequestorder({
      app: getRandomAddress(),
      category: 5,
    });

    await expect(iexec.order.signRequestorder(order)).rejects.toThrow(
      Error(
        'Requester storage token is not set for selected provider "ipfs". Result archive upload will fail.',
      ),
    );
    await iexec.storage
      .defaultStorageLogin()
      .then(iexec.storage.pushStorageToken);
    const res = await iexec.order.signRequestorder(order);
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ params: JSON.stringify(order.params) },
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signRequestorder() preflightCheck dropbox storage', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createRequestorder({
      app: getRandomAddress(),
      category: 5,
      tag: ['tee', 'scone'],
      params: {
        iexec_result_storage_provider: 'dropbox',
      },
    });

    await expect(iexec.order.signRequestorder(order)).rejects.toThrow(
      Error(
        'Requester storage token is not set for selected provider "dropbox". Result archive upload will fail.',
      ),
    );

    await iexec.storage.pushStorageToken('oops', { provider: 'dropbox' });
    const res = await iexec.order.signRequestorder(order);
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ params: JSON.stringify(order.params) },
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signRequestorder() preflightCheck result encryption', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const order = await iexec.order.createRequestorder({
      app: getRandomAddress(),
      category: 5,
      params: { iexec_result_encryption: true },
    });
    await iexec.storage
      .defaultStorageLogin()
      .then(iexec.storage.pushStorageToken);
    await expect(iexec.order.signRequestorder(order)).rejects.toThrow(
      Error(
        'Beneficiary result encryption key is not set in the SMS. Result encryption will fail.',
      ),
    );
    await iexec.result.pushResultEncryptionKey('oops');
    const res = await iexec.order.signRequestorder(order);
    expect(res.salt).toMatch(bytes32Regex);
    expect(res.sign).toMatch(signRegex);
    expect(res).toEqual({
      ...order,
      ...{ params: JSON.stringify(order.params) },
      ...{ sign: res.sign, salt: res.salt },
    });
  });

  test('order.signRequestorder() preflightCheck dataset encryption key', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexecDatasetProvider = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    const iexecDatasetConsumer = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    await iexecDatasetConsumer.storage
      .defaultStorageLogin()
      .then(iexecDatasetConsumer.storage.pushStorageToken);
    const { address: dataset } = await deployRandomDataset(
      iexecDatasetProvider,
    );

    // non tee pass
    await expect(
      iexecDatasetConsumer.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          dataset,
        })
        .then(iexecDatasetConsumer.order.signRequestorder),
    ).resolves.toBeDefined();

    // tee fail without secret
    await expect(
      iexecDatasetConsumer.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          dataset,
          tag: ['tee', 'scone'],
        })
        .then(iexecDatasetConsumer.order.signRequestorder),
    ).rejects.toThrow(
      Error(
        `Dataset encryption key is not set for dataset ${dataset} in the SMS. Dataset decryption will fail.`,
      ),
    );

    // tee pass with secret
    await iexecDatasetProvider.dataset.pushDatasetSecret(
      dataset,
      iexecDatasetProvider.dataset.generateEncryptionKey(),
    );
    await expect(
      iexecDatasetConsumer.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          dataset,
          tag: ['tee', 'scone'],
        })
        .then(iexecDatasetConsumer.order.signRequestorder),
    ).resolves.toBeDefined();
  });

  test('order.signRequestorder() preflightCheck requester secrets', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
        smsURL: smsMap,
      },
    );
    await iexec.storage
      .defaultStorageLogin()
      .then(iexec.storage.pushStorageToken);

    // non requester secret pass
    await expect(
      iexec.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          tag: ['tee', 'scone'],
        })
        .then(iexec.order.signRequestorder),
    ).resolves.toBeDefined();

    // unset secret fail
    await iexec.secrets.pushRequesterSecret('foo', 'secret');
    await expect(
      iexec.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          tag: ['tee', 'scone'],
          params: {
            iexec_secrets: {
              1: 'foo',
              2: 'bar',
            },
          },
        })
        .then(iexec.order.signRequestorder),
    ).rejects.toThrow(
      Error(
        `Requester secret "bar" is not set for requester ${wallet.address} in the SMS. Requester secret provisioning will fail.`,
      ),
    );
    // set secrets pass
    await iexec.secrets.pushRequesterSecret('bar', 'secret');
    await expect(
      iexec.order
        .createRequestorder({
          app: getRandomAddress(),
          category: 5,
          tag: ['tee', 'scone'],
          params: {
            iexec_secrets: {
              1: 'foo',
              2: 'bar',
            },
          },
        })
        .then(iexec.order.signRequestorder),
    ).resolves.toBeDefined();
  });

  test('order.hashApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await iexec.order.createApporder({
      app: KNOWN_ADDRESS,
      appprice: 1,
      volume: 15,
    });

    const res = await iexec.order.hashApporder({
      ...order,
      salt: '0x77d3087b2ff82dc336c1add5ad220a32e8b3f46201ad33a7afdb1d6442132e13',
    });
    expect(res).toMatch(bytes32Regex);
    expect(res).toBe(
      '0x20a9ac876315f0b68a393fddd78e85e4e5e43e53d29261df1801f3f8bdcf8fc7',
    );
  });

  test('order.hashDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await iexec.order.createDatasetorder({
      dataset: KNOWN_ADDRESS,
      datasetprice: 1,
      volume: 15,
    });

    const res = await iexec.order.hashDatasetorder({
      ...order,
      salt: '0x0f4c934f0fb4fa32dcef23ad90a695f94d1e5fca8147016c1c58553d3f20bf6c',
    });
    expect(res).toMatch(bytes32Regex);
    expect(res).toBe(
      '0x5c8b2f93f33ee23fb9047c43b41784ac5f5aacd2cdc374461791ebf1967a3b4f',
    );
  });

  test('order.hashWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await iexec.order.createWorkerpoolorder({
      workerpool: KNOWN_ADDRESS,
      workerpoolprice: 1,
      volume: 15,
      category: 5,
    });

    const res = await iexec.order.hashWorkerpoolorder({
      ...order,
      salt: '0x0f4c934f0fb4fa32dcef23ad90a695f94d1e5fca8147016c1c58553d3f20bf6c',
    });
    expect(res).toMatch(bytes32Regex);
    expect(res).toBe(
      '0x84579fe94e633bcf677aa104894c889cd8d68974273e22e3531793168bd2aa63',
    );
  });

  test('order.hashRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const order = await iexec.order.createRequestorder({
      app: KNOWN_ADDRESS,
      appmaxprice: 1,
      workerpoolmaxprice: 2,
      requester: RICH_ADDRESS,
      volume: 15,
      category: 5,
    });

    const res = await iexec.order.hashRequestorder({
      ...order,
      salt: '0x0f4c934f0fb4fa32dcef23ad90a695f94d1e5fca8147016c1c58553d3f20bf6c',
    });
    expect(res).toMatch(bytes32Regex);
    expect(res).toBe(
      '0x4c5fbf2897891074700b605a5407ca25c5d269f2dd3a8e314c972953fc1cdd2c',
    );
  });

  test('order.cancelApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await deployAndGetApporder(iexec);
    const res = await iexec.order.cancelApporder(order);
    expect(res.order).toEqual(order);
    expect(res.txHash).toMatch(bytes32Regex);
    await expect(iexec.order.cancelApporder(order)).rejects.toThrow(
      Error('apporder already canceled'),
    );
  });

  test('order.cancelDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await deployAndGetDatasetorder(iexec);
    const res = await iexec.order.cancelDatasetorder(order);
    expect(res.order).toEqual(order);
    expect(res.txHash).toMatch(bytes32Regex);
    await expect(iexec.order.cancelDatasetorder(order)).rejects.toThrow(
      Error('datasetorder already canceled'),
    );
  });

  test('order.cancelWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
      },
    );
    const order = await deployAndGetWorkerpoolorder(iexec);
    const res = await iexec.order.cancelWorkerpoolorder(order);
    expect(res.order).toEqual(order);
    expect(res.txHash).toMatch(bytes32Regex);
    await expect(iexec.order.cancelWorkerpoolorder(order)).rejects.toThrow(
      Error('workerpoolorder already canceled'),
    );
  });

  test('order.cancelRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const order = await iexec.order
      .createRequestorder({
        app: NULL_ADDRESS,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        volume: 1,
        category: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const res = await iexec.order.cancelRequestorder(order);
    expect(res.order).toEqual(order);
    expect(res.txHash).toMatch(bytes32Regex);
    await expect(iexec.order.cancelRequestorder(order)).rejects.toThrow(
      Error('requestorder already canceled'),
    );
  });

  test(
    'order.matchOrders()',
    async () => {
      const brokerWallet = getRandomWallet();
      const richSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        RICH_PRIVATE_KEY,
      );
      const iexecRich = new IExec(
        {
          ethProvider: richSigner,
        },
        {
          hubAddress,
          resultProxyURL: 'https://result-proxy.iex.ec',
        },
      );

      const signer = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        brokerWallet.privateKey,
      );
      const iexec = new IExec(
        {
          ethProvider: signer,
        },
        {
          hubAddress,
          resultProxyURL: 'https://result-proxy.iex.ec',
        },
      );
      const poolManagerWallet = getRandomWallet();
      const poolManagerSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        poolManagerWallet.privateKey,
      );
      const iexecPoolManager = new IExec(
        {
          ethProvider: poolManagerSigner,
        },
        {
          hubAddress,
        },
      );

      await iexecRich.wallet.sendETH('0.1 ether', brokerWallet.address);
      await iexecRich.wallet.sendETH('0.1 ether', poolManagerWallet.address);
      await iexecRich.wallet.sendRLC('10 RLC', brokerWallet.address);
      await iexecRich.wallet.sendRLC('10 RLC', poolManagerWallet.address);

      const apporderTemplate = await deployAndGetApporder(iexec);
      const datasetorderTemplate = await deployAndGetDatasetorder(iexec);
      const workerpoolorderTemplate = await deployAndGetWorkerpoolorder(
        iexecPoolManager,
      );
      const requestorderTemplate = await getMatchableRequestorder(iexec, {
        apporder: apporderTemplate,
        datasetorder: datasetorderTemplate,
        workerpoolorder: workerpoolorderTemplate,
      });

      // resource not deployed
      const fakeAddress = getRandomAddress();
      const apporderNotDeployed = { ...apporderTemplate, app: fakeAddress };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderNotDeployed,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error(`No app deployed at address ${fakeAddress}`));
      const datasetorderNotDeployed = {
        ...datasetorderTemplate,
        dataset: fakeAddress,
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderNotDeployed,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error(`No dataset deployed at address ${fakeAddress}`));
      const workerpoolorderNotDeployed = {
        ...workerpoolorderTemplate,
        workerpool: fakeAddress,
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderNotDeployed,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(`No workerpool deployed at address ${fakeAddress}`),
      );
      // invalid sign
      const apporderInvalidSign = {
        ...apporderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderInvalidSign,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('apporder invalid sign'));
      const datasetorderInvalidSign = {
        ...datasetorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderInvalidSign,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('datasetorder invalid sign'));
      const workerpoolorderInvalidSign = {
        ...workerpoolorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderInvalidSign,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('workerpoolorder invalid sign'));
      const requestorderInvalidSign = {
        ...requestorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderInvalidSign,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('requestorder invalid sign'));

      // address mismatch
      const apporderAddressMismatch = await deployAndGetApporder(iexec);
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderAddressMismatch,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `app address mismatch between requestorder (${requestorderTemplate.app}) and apporder (${apporderAddressMismatch.app})`,
        ),
      );
      const datasetorderAddressMismatch = await deployAndGetDatasetorder(iexec);
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderAddressMismatch,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `dataset address mismatch between requestorder (${requestorderTemplate.dataset}) and datasetorder (${datasetorderAddressMismatch.dataset})`,
        ),
      );
      const workerpoolorderAddressMismatch = await deployAndGetWorkerpoolorder(
        iexec,
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderAddressMismatch,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpool address mismatch between requestorder (${requestorderTemplate.workerpool}) and workerpoolorder (${workerpoolorderAddressMismatch.workerpool})`,
        ),
      );
      // category check
      const workerpoolorderCategoryMismatch =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          category: 2,
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderCategoryMismatch,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `category mismatch between requestorder (${requestorderTemplate.category}) and workerpoolorder (${workerpoolorderCategoryMismatch.category})`,
        ),
      );
      // trust check
      const workerpoolorderTrustZero =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          trust: 0,
        });
      const requestorderTrustTooHigh = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          trust: 2,
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTrustZero,
            requestorder: requestorderTrustTooHigh,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpoolorder trust is too low (expected ${requestorderTrustTooHigh.trust}, got ${workerpoolorderTrustZero.trust})`,
        ),
      );

      // workerpool tag check
      const requestorderTagTeeGpu = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          tag: utils.encodeTag(['tee', 'scone', 'gpu']),
        },
        { preflightCheck: false },
      );
      const workerpoolorderTagGpu =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          tag: utils.encodeTag(['gpu']),
        });
      const workerpoolorderTagTee =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          tag: utils.encodeTag(['tee', 'scone']),
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTagGpu,
            requestorder: requestorderTagTeeGpu,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [tee,scone] in workerpoolorder'));
      const apporderTagGpu = await iexec.order.signApporder({
        ...apporderTemplate,
        tag: utils.encodeTag(['gpu']),
      });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTagGpu,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [gpu] in workerpoolorder'));
      const datasetorderTagTeeGpu = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          tag: utils.encodeTag(['gpu', 'tee', 'scone']),
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTagTeeGpu,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [gpu] in workerpoolorder'));
      // app tag check
      const datasetorderTagTee = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          tag: utils.encodeTag(['tee', 'scone']),
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTagTee,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tag [tee] in apporder'));
      // price check
      const apporderTooExpensive = await iexec.order.signApporder({
        ...apporderTemplate,
        appprice: 1,
      });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTooExpensive,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `appmaxprice too low (expected ${apporderTooExpensive.appprice}, got ${requestorderTemplate.appmaxprice})`,
        ),
      );

      const datasetorderTooExpensive = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          datasetprice: 1,
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTooExpensive,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `datasetmaxprice too low (expected ${datasetorderTooExpensive.datasetprice}, got ${requestorderTemplate.datasetmaxprice})`,
        ),
      );

      const workerpoolorderTooExpensive =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 1,
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTooExpensive,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpoolmaxprice too low (expected ${workerpoolorderTooExpensive.workerpoolprice}, got ${requestorderTemplate.workerpoolmaxprice})`,
        ),
      );
      // volumes checks
      const apporderCanceled = await iexec.order
        .signApporder(apporderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexec.order.cancelApporder(order);
          return order;
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderCanceled,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('apporder is fully consumed'));

      const datasetorderCanceled = await iexec.order
        .signDatasetorder(datasetorderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexec.order.cancelDatasetorder(order);
          return order;
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderCanceled,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('datasetorder is fully consumed'));

      const workerpoolorderCanceled = await iexecPoolManager.order
        .signWorkerpoolorder(workerpoolorderTemplate)
        .then(async (order) => {
          await iexecPoolManager.order.cancelWorkerpoolorder(order);
          return order;
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderCanceled,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('workerpoolorder is fully consumed'));
      const requestorderCanceled = await iexec.order
        .signRequestorder(requestorderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexec.order.cancelRequestorder(order);
          return order;
        });
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderCanceled,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('requestorder is fully consumed'));

      // requester account stake check
      const balance = await iexec.account.checkBalance(
        await iexec.wallet.getAddress(),
      );
      await iexec.account.withdraw(balance.stake).catch(() => {});
      await iexec.account.deposit(5);

      const apporder3nRlc = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          appprice: 3,
        },
        { preflightCheck: false },
      );
      const datasetorder2nRlc = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          datasetprice: 2,
        },
        { preflightCheck: false },
      );
      const workerpoolorder1nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 1,
        });
      const requestorder300nRlc = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          appmaxprice: 100,
          datasetmaxprice: 100,
          workerpoolmaxprice: 100,
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporder3nRlc,
            datasetorder: datasetorder2nRlc,
            workerpoolorder: workerpoolorder1nRlc,
            requestorder: requestorder300nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "Cost per task (6) is greater than requester account stake (5). Orders can't be matched. If you are the requester, you should deposit to top up your account",
        ),
      );

      const apporder0nRlc = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          appprice: 0,
          volume: 1000,
        },
        { preflightCheck: false },
      );
      const datasetorder0nRlc = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          datasetprice: 0,
          volume: 1000,
        },
        { preflightCheck: false },
      );
      const workerpoolorder2nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 2,
          volume: 1000,
        });
      const requestorder6nRlc = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpoolmaxprice: 2,
          volume: 3,
        },
        { preflightCheck: false },
      );
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporder0nRlc,
            datasetorder: datasetorder0nRlc,
            workerpoolorder: workerpoolorder2nRlc,
            requestorder: requestorder6nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "Total cost for 3 tasks (6) is greater than requester account stake (5). Orders can't be matched. If you are the requester, you should deposit to top up your account or reduce your requestorder volume",
        ),
      );
      // workerpool owner stake check
      const workerpoolorder7nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 7,
        });
      await iexec.account.deposit(10);
      const poolManagerBalance = await iexecPoolManager.account.checkBalance(
        await iexecPoolManager.wallet.getAddress(),
      );
      await iexecPoolManager.account
        .withdraw(poolManagerBalance.stake)
        .catch(() => {});
      await iexec.wallet.sendRLC(1, await iexecPoolManager.wallet.getAddress());
      await iexecPoolManager.account.deposit(1);
      await expect(
        iexec.order.matchOrders(
          {
            apporder: apporder3nRlc,
            datasetorder: datasetorder2nRlc,
            workerpoolorder: workerpoolorder7nRlc,
            requestorder: requestorder300nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "workerpool required stake (2) is greater than workerpool owner's account stake (1). Orders can't be matched. If you are the workerpool owner, you should deposit to top up your account",
        ),
      );
      // standard case
      const res = await iexec.order.matchOrders(
        {
          apporder: apporderTemplate,
          datasetorder: datasetorderTemplate,
          workerpoolorder: workerpoolorderTemplate,
          requestorder: requestorderTemplate,
        },
        { preflightCheck: false },
      );
      expect(res.txHash).toMatch(bytes32Regex);
      expect(res.volume).toBeInstanceOf(BN);
      expect(res.volume.eq(new BN(1))).toBe(true);
      expect(res.dealid).toMatch(bytes32Regex);
    },
    DEFAULT_TIMEOUT * 2,
  );

  test(
    'order.matchOrders() (enterprise)',
    async () => {
      const requesterWallet = getRandomWallet();
      const poolManagerWallet = getRandomWallet();
      const appDevWallet = getRandomWallet();
      const datasetDevWallet = getRandomWallet();
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        requesterWallet.address,
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        poolManagerWallet.address,
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        appDevWallet.address,
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        datasetDevWallet.address,
      );
      const signer = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        RICH_PRIVATE_KEY,
      );
      const iexecRichman = new IExec(
        {
          ethProvider: signer,
          flavour: 'enterprise',
        },
        {
          hubAddress: enterpriseHubAddress,
        },
      );
      await iexecRichman.wallet.sendRLC('10 RLC', requesterWallet.address);
      await iexecRichman.wallet.sendETH('0.1 ether', requesterWallet.address);
      await iexecRichman.wallet.sendRLC('10 RLC', poolManagerWallet.address);
      await iexecRichman.wallet.sendETH('0.1 ether', poolManagerWallet.address);
      await iexecRichman.wallet.sendETH('0.1 ether', appDevWallet.address);
      await iexecRichman.wallet.sendETH('0.1 ether', datasetDevWallet.address);
      const requesterSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        requesterWallet.privateKey,
      );
      const iexecRequester = new IExec(
        {
          ethProvider: requesterSigner,
          flavour: 'enterprise',
        },
        {
          hubAddress: enterpriseHubAddress,
          resultProxyURL: 'https://result-proxy.iex.ec',
        },
      );
      const poolManagerSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        poolManagerWallet.privateKey,
      );
      const iexecPoolManager = new IExec(
        {
          ethProvider: poolManagerSigner,
          flavour: 'enterprise',
        },
        {
          hubAddress: enterpriseHubAddress,
        },
      );
      const appDevSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        appDevWallet.privateKey,
      );
      const iexecAppDev = new IExec(
        {
          ethProvider: appDevSigner,
          flavour: 'enterprise',
        },
        {
          hubAddress: enterpriseHubAddress,
        },
      );
      const datasetDevSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        datasetDevWallet.privateKey,
      );
      const iexecDatasetDev = new IExec(
        {
          ethProvider: datasetDevSigner,
          flavour: 'enterprise',
        },
        {
          hubAddress: enterpriseHubAddress,
        },
      );

      const apporderTemplate = await deployAndGetApporder(iexecAppDev);
      const datasetorderTemplate = await deployAndGetDatasetorder(
        iexecDatasetDev,
      );
      const workerpoolorderTemplate = await deployAndGetWorkerpoolorder(
        iexecPoolManager,
      );
      const requestorderTemplate = await getMatchableRequestorder(
        iexecRequester,
        {
          apporder: apporderTemplate,
          datasetorder: datasetorderTemplate,
          workerpoolorder: workerpoolorderTemplate,
        },
      );

      // resource not deployed
      const fakeAddress = getRandomAddress();
      const apporderNotDeployed = { ...apporderTemplate, app: fakeAddress };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderNotDeployed,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error(`No app deployed at address ${fakeAddress}`));
      const datasetorderNotDeployed = {
        ...datasetorderTemplate,
        dataset: fakeAddress,
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderNotDeployed,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error(`No dataset deployed at address ${fakeAddress}`));
      const workerpoolorderNotDeployed = {
        ...workerpoolorderTemplate,
        workerpool: fakeAddress,
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderNotDeployed,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(`No workerpool deployed at address ${fakeAddress}`),
      );
      // invalid sign
      const apporderInvalidSign = {
        ...apporderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderInvalidSign,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('apporder invalid sign'));
      const datasetorderInvalidSign = {
        ...datasetorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderInvalidSign,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('datasetorder invalid sign'));
      const workerpoolorderInvalidSign = {
        ...workerpoolorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderInvalidSign,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('workerpoolorder invalid sign'));
      const requestorderInvalidSign = {
        ...requestorderTemplate,
        sign: '0xa1d59ea4f4ed84ed1c2fcbdb217f22d64180d95ccaed3268bdfef796ff7f5fa50c2d4c83bf7465afbd9ca292c433495eb573d1f8bcca585cb107b047c899dcb81c',
      };
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderInvalidSign,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('requestorder invalid sign'));

      // address mismatch
      const apporderAddressMismatch = await deployAndGetApporder(
        iexecRequester,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderAddressMismatch,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `app address mismatch between requestorder (${requestorderTemplate.app}) and apporder (${apporderAddressMismatch.app})`,
        ),
      );
      const datasetorderAddressMismatch = await deployAndGetDatasetorder(
        iexecRequester,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderAddressMismatch,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `dataset address mismatch between requestorder (${requestorderTemplate.dataset}) and datasetorder (${datasetorderAddressMismatch.dataset})`,
        ),
      );
      const workerpoolorderAddressMismatch = await deployAndGetWorkerpoolorder(
        iexecRequester,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderAddressMismatch,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpool address mismatch between requestorder (${requestorderTemplate.workerpool}) and workerpoolorder (${workerpoolorderAddressMismatch.workerpool})`,
        ),
      );
      // category check
      const workerpoolorderCategoryMismatch =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          category: 2,
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderCategoryMismatch,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `category mismatch between requestorder (${requestorderTemplate.category}) and workerpoolorder (${workerpoolorderCategoryMismatch.category})`,
        ),
      );
      // trust check
      const workerpoolorderTrustZero =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          trust: 0,
        });
      // const requestorderTrustOne = await iexec.order.signRequestorder(
      //   { ...requestorderTemplate, trust: 1 },
      // );
      const requestorderTrustTooHigh =
        await iexecRequester.order.signRequestorder(
          {
            ...requestorderTemplate,
            trust: 2,
          },
          { preflightCheck: false },
        );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTrustZero,
            requestorder: requestorderTrustTooHigh,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpoolorder trust is too low (expected ${requestorderTrustTooHigh.trust}, got ${workerpoolorderTrustZero.trust})`,
        ),
      );

      // workerpool tag check
      const requestorderTagTeeGpu = await iexecRequester.order.signRequestorder(
        {
          ...requestorderTemplate,
          tag: utils.encodeTag(['tee', 'scone', 'gpu']),
        },
        { preflightCheck: false },
      );
      const workerpoolorderTagGpu =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          tag: utils.encodeTag(['gpu']),
        });
      const workerpoolorderTagTee =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          tag: utils.encodeTag(['tee', 'scone']),
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTagGpu,
            requestorder: requestorderTagTeeGpu,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [tee,scone] in workerpoolorder'));
      const apporderTagGpu = await iexecAppDev.order.signApporder(
        {
          ...apporderTemplate,
          tag: utils.encodeTag(['gpu']),
        },
        { preflightCheck: false },
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTagGpu,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [gpu] in workerpoolorder'));
      const datasetorderTagTeeGpu =
        await iexecDatasetDev.order.signDatasetorder(
          {
            ...datasetorderTemplate,
            tag: utils.encodeTag(['gpu', 'tee', 'scone']),
          },
          { preflightCheck: false },
        );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTagTeeGpu,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tags [gpu] in workerpoolorder'));
      // app tag check
      const datasetorderTagTee = await iexecDatasetDev.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          tag: utils.encodeTag(['tee', 'scone']),
        },
        { preflightCheck: false },
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTagTee,
            workerpoolorder: workerpoolorderTagTee,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('Missing tag [tee] in apporder'));
      // price check
      const apporderTooExpensive = await iexecAppDev.order.signApporder({
        ...apporderTemplate,
        appprice: 1,
      });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTooExpensive,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `appmaxprice too low (expected ${apporderTooExpensive.appprice}, got ${requestorderTemplate.appmaxprice})`,
        ),
      );

      const datasetorderTooExpensive =
        await iexecDatasetDev.order.signDatasetorder(
          {
            ...datasetorderTemplate,
            datasetprice: 1,
          },
          { preflightCheck: false },
        );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTooExpensive,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `datasetmaxprice too low (expected ${datasetorderTooExpensive.datasetprice}, got ${requestorderTemplate.datasetmaxprice})`,
        ),
      );

      const workerpoolorderTooExpensive =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 1,
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTooExpensive,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpoolmaxprice too low (expected ${workerpoolorderTooExpensive.workerpoolprice}, got ${requestorderTemplate.workerpoolmaxprice})`,
        ),
      );
      // volumes checks
      const apporderCanceled = await iexecAppDev.order
        .signApporder(apporderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexecAppDev.order.cancelApporder(order);
          return order;
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderCanceled,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('apporder is fully consumed'));

      const datasetorderCanceled = await iexecDatasetDev.order
        .signDatasetorder(datasetorderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexecDatasetDev.order.cancelDatasetorder(order);
          return order;
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderCanceled,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('datasetorder is fully consumed'));

      const workerpoolorderCanceled = await iexecPoolManager.order
        .signWorkerpoolorder(workerpoolorderTemplate)
        .then(async (order) => {
          await iexecPoolManager.order.cancelWorkerpoolorder(order);
          return order;
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderCanceled,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('workerpoolorder is fully consumed'));

      const requestorderCanceled = await iexecRequester.order
        .signRequestorder(requestorderTemplate, { preflightCheck: false })
        .then(async (order) => {
          await iexecRequester.order.cancelRequestorder(order);
          return order;
        });
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderCanceled,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(Error('requestorder is fully consumed'));

      // requester account stake check
      const balance = await iexecRequester.account.checkBalance(
        await iexecRequester.wallet.getAddress(),
      );
      await iexecRequester.account.withdraw(balance.stake).catch(() => {});
      await iexecRequester.account.deposit(5);

      const apporder3nRlc = await iexecAppDev.order.signApporder(
        {
          ...apporderTemplate,
          appprice: 3,
        },
        { preflightCheck: false },
      );
      const datasetorder2nRlc = await iexecDatasetDev.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          datasetprice: 2,
        },
        { preflightCheck: false },
      );
      const workerpoolorder1nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 1,
        });
      const requestorder300nRlc = await iexecRequester.order.signRequestorder(
        {
          ...requestorderTemplate,
          appmaxprice: 100,
          datasetmaxprice: 100,
          workerpoolmaxprice: 100,
        },
        { preflightCheck: false },
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporder3nRlc,
            datasetorder: datasetorder2nRlc,
            workerpoolorder: workerpoolorder1nRlc,
            requestorder: requestorder300nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "Cost per task (6) is greater than requester account stake (5). Orders can't be matched. If you are the requester, you should deposit to top up your account",
        ),
      );

      const apporder0nRlc = await iexecAppDev.order.signApporder(
        {
          ...apporderTemplate,
          appprice: 0,
          volume: 1000,
        },
        { preflightCheck: false },
      );
      const datasetorder0nRlc = await iexecDatasetDev.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          datasetprice: 0,
          volume: 1000,
        },
        { preflightCheck: false },
      );
      const workerpoolorder2nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 2,
          volume: 1000,
        });
      const requestorder6nRlc = await iexecRequester.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpoolmaxprice: 2,
          volume: 3,
        },
        { preflightCheck: false },
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporder0nRlc,
            datasetorder: datasetorder0nRlc,
            workerpoolorder: workerpoolorder2nRlc,
            requestorder: requestorder6nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "Total cost for 3 tasks (6) is greater than requester account stake (5). Orders can't be matched. If you are the requester, you should deposit to top up your account or reduce your requestorder volume",
        ),
      );

      // workerpool owner stake check
      const workerpoolorder7nRlc =
        await iexecPoolManager.order.signWorkerpoolorder({
          ...workerpoolorderTemplate,
          workerpoolprice: 7,
        });
      await iexecRequester.account.deposit(10);
      const poolManagerBalance = await iexecPoolManager.account.checkBalance(
        await iexecPoolManager.wallet.getAddress(),
      );
      await iexecPoolManager.account
        .withdraw(poolManagerBalance.stake)
        .catch(() => {});
      await iexecRequester.wallet.sendRLC(
        1,
        await iexecPoolManager.wallet.getAddress(),
      );
      await iexecPoolManager.account.deposit(1);
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporder3nRlc,
            datasetorder: datasetorder2nRlc,
            workerpoolorder: workerpoolorder7nRlc,
            requestorder: requestorder300nRlc,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          "workerpool required stake (2) is greater than workerpool owner's account stake (1). Orders can't be matched. If you are the workerpool owner, you should deposit to top up your account",
        ),
      );

      // requester not KYC
      await revokeKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        requesterWallet.address,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `requester ${requesterWallet.address} is not authorized to interact with eRLC`,
        ),
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        requesterWallet.address,
      );

      // app owner not KYC
      await revokeKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        appDevWallet.address,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `app owner ${appDevWallet.address} is not authorized to interact with eRLC`,
        ),
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        appDevWallet.address,
      );

      // dataset owner not KYC
      await revokeKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        datasetDevWallet.address,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `dataset owner ${datasetDevWallet.address} is not authorized to interact with eRLC`,
        ),
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        datasetDevWallet.address,
      );

      // workerpool owner not KYC
      await revokeKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        poolManagerWallet.address,
      );
      await expect(
        iexecRequester.order.matchOrders(
          {
            apporder: apporderTemplate,
            datasetorder: datasetorderTemplate,
            workerpoolorder: workerpoolorderTemplate,
            requestorder: requestorderTemplate,
          },
          { preflightCheck: false },
        ),
      ).rejects.toThrow(
        Error(
          `workerpool owner ${poolManagerWallet.address} is not authorized to interact with eRLC`,
        ),
      );
      await grantKYC(
        whitelistAdminWallet,
        enterpriseHubAddress,
        poolManagerWallet.address,
      );

      // standard case
      const res = await iexecRequester.order.matchOrders(
        {
          apporder: apporderTemplate,
          datasetorder: datasetorderTemplate,
          workerpoolorder: workerpoolorderTemplate,
          requestorder: requestorderTemplate,
        },
        { preflightCheck: false },
      );
      expect(res.txHash).toMatch(bytes32Regex);
      expect(res.volume).toBeInstanceOf(BN);
      expect(res.volume.eq(new BN(1))).toBe(true);
      expect(res.dealid).toMatch(bytes32Regex);
    },
    DEFAULT_TIMEOUT * 2,
  );

  test(
    'order.matchOrders() (preflightCheck)',
    async () => {
      const brokerWallet = getRandomWallet();
      const resourcesProviderWallet = getRandomWallet();
      const richSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        RICH_PRIVATE_KEY,
      );
      const iexecRich = new IExec(
        {
          ethProvider: richSigner,
        },
        {
          hubAddress,
          smsURL: smsMap,
          resultProxyURL,
        },
      );
      await iexecRich.wallet.sendETH('20000000000000000', brokerWallet.address);
      await iexecRich.wallet.sendETH(
        '20000000000000000',
        resourcesProviderWallet.address,
      );
      const signer = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        brokerWallet.privateKey,
      );
      const iexec = new IExec(
        {
          ethProvider: signer,
        },
        {
          hubAddress,
          smsURL: smsMap,
          resultProxyURL,
        },
      );
      const resourcesProviderSigner = utils.getSignerFromPrivateKey(
        tokenChainInstamineUrl,
        resourcesProviderWallet.privateKey,
      );
      const iexecResourcesProvider = new IExec(
        {
          ethProvider: resourcesProviderSigner,
        },
        {
          hubAddress,
        },
      );

      const apporder = await deployAndGetApporder(iexecResourcesProvider);
      const datasetorder = await deployAndGetDatasetorder(
        iexecResourcesProvider,
      );
      const workerpoolorder = await deployAndGetWorkerpoolorder(
        iexecResourcesProvider,
      );
      const requestorder = await getMatchableRequestorder(iexec, {
        apporder,
        datasetorder,
        workerpoolorder,
      });

      const teeApporder = await deployAndGetApporder(iexecResourcesProvider, {
        teeFramework: TEE_FRAMEWORKS.SCONE,
        tag: ['tee', 'scone'],
      });
      const teeDatasetorder = await deployAndGetDatasetorder(
        iexecResourcesProvider,
        { tag: ['tee', 'scone'] },
      );
      const teeWorkerpoolorder = await deployAndGetWorkerpoolorder(
        iexecResourcesProvider,
        {
          tag: ['tee', 'scone'],
        },
      );

      // trigger request check
      await expect(
        iexec.order.matchOrders({
          apporder,
          datasetorder,
          workerpoolorder,
          requestorder,
        }),
      ).rejects.toThrow(
        Error(
          'Requester storage token is not set for selected provider "ipfs". Result archive upload will fail.',
        ),
      );

      await iexec.storage
        .defaultStorageLogin()
        .then(iexec.storage.pushStorageToken);
      const res = await iexec.order.matchOrders({
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      });
      expect(res.txHash).toMatch(bytes32Regex);
      expect(res.volume).toBeInstanceOf(BN);
      expect(res.volume.eq(new BN(1))).toBe(true);
      expect(res.dealid).toMatch(bytes32Regex);

      // trigger app check
      await expect(
        iexec.order.matchOrders({
          apporder,
          datasetorder,
          workerpoolorder: teeWorkerpoolorder,
          requestorder: await getMatchableRequestorder(iexec, {
            apporder,
            datasetorder,
            workerpoolorder: teeWorkerpoolorder,
          }).then((o) =>
            iexec.order.signRequestorder(
              { ...o, tag: ['tee', 'scone'] },
              { preflightCheck: false },
            ),
          ),
        }),
      ).rejects.toThrow(
        Error('Tag mismatch the TEE framework specified by app'),
      );

      // trigger dataset check
      await expect(
        iexec.order.matchOrders({
          apporder: teeApporder,
          datasetorder: teeDatasetorder,
          workerpoolorder: teeWorkerpoolorder,
          requestorder: await getMatchableRequestorder(iexec, {
            apporder: teeApporder,
            datasetorder: teeDatasetorder,
            workerpoolorder: teeWorkerpoolorder,
          }),
        }),
      ).rejects.toThrow('Dataset encryption key is not set for dataset ');
    },
    DEFAULT_TIMEOUT * 2,
  );

  test('order.publishApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.publishApporder(apporder);
    expect(orderHash).toMatch(bytes32Regex);
  });

  test('order.publishDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.publishDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    expect(orderHash).toMatch(bytes32Regex);
  });

  // todo
  test.skip('order.publishDatasetorder() preflightCheck', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.publishDatasetorder(datasetorder);
    expect(orderHash).toMatch(bytes32Regex);
  });

  test('order.publishWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.publishWorkerpoolorder(workerpoolorder);
    expect(orderHash).toMatch(bytes32Regex);
  });

  test('order.publishRequestorder() (no preflightCheck)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    await iexec.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        requester: await iexec.wallet.getAddress(),
        app: apporder.app,
        appmaxprice: apporder.appprice,
        dataset: NULL_ADDRESS,
        datasetmaxprice: 0,
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: 0,
        category: 1,
        trust: 0,
        volume: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const orderHash = await iexec.order.publishRequestorder(requestorder, {
      preflightCheck: false,
    });
    expect(orderHash).toMatch(bytes32Regex);
  });

  test('order.publishRequestorder() (preflightCheck)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      getRandomWallet().privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        smsURL: smsMap,
        resultProxyURL,
      },
    );
    const appOwnerSigner = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexecAppOwner = new IExec(
      {
        ethProvider: appOwnerSigner,
      },
      {
        hubAddress,
        iexecGatewayURL,
        smsURL: smsMap,
        resultProxyURL,
      },
    );
    const apporder = await deployAndGetApporder(iexecAppOwner);
    await iexecAppOwner.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: apporder.appprice,
        category: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    await expect(iexec.order.publishRequestorder(requestorder)).rejects.toThrow(
      Error(
        'Requester storage token is not set for selected provider "ipfs". Result archive upload will fail.',
      ),
    );
    await iexec.storage
      .defaultStorageLogin()
      .then(iexec.storage.pushStorageToken);
    const orderHash = await iexec.order.publishRequestorder(requestorder);
    expect(orderHash).toMatch(bytes32Regex);
  });

  test('order.unpublishApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.publishApporder(apporder);
    const unpublishRes = await iexec.order.unpublishApporder(orderHash);
    expect(unpublishRes).toBe(orderHash);
    await expect(iexec.order.unpublishApporder(orderHash)).rejects.toThrow(
      Error(`API error: apporder with orderHash ${orderHash} is not published`),
    );
  });

  test('order.unpublishDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.publishDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const unpublishRes = await iexec.order.unpublishDatasetorder(orderHash);
    expect(unpublishRes).toBe(orderHash);
    await expect(iexec.order.unpublishDatasetorder(orderHash)).rejects.toThrow(
      Error(
        `API error: datasetorder with orderHash ${orderHash} is not published`,
      ),
    );
  });

  test('order.unpublishWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.publishWorkerpoolorder(workerpoolorder);
    const unpublishRes = await iexec.order.unpublishWorkerpoolorder(orderHash);
    expect(unpublishRes).toBe(orderHash);
    await expect(
      iexec.order.unpublishWorkerpoolorder(orderHash),
    ).rejects.toThrow(
      Error(
        `API error: workerpoolorder with orderHash ${orderHash} is not published`,
      ),
    );
  });

  test('order.unpublishRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    await iexec.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        requester: await iexec.wallet.getAddress(),
        app: apporder.app,
        appmaxprice: apporder.appprice,
        dataset: NULL_ADDRESS,
        datasetmaxprice: 0,
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: 0,
        category: 1,
        trust: 0,
        volume: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const orderHash = await iexec.order.publishRequestorder(requestorder, {
      preflightCheck: false,
    });
    const unpublishRes = await iexec.order.unpublishRequestorder(orderHash);
    expect(unpublishRes).toBe(orderHash);
    await expect(iexec.order.unpublishRequestorder(orderHash)).rejects.toThrow(
      Error(
        `API error: requestorder with orderHash ${orderHash} is not published`,
      ),
    );
  });

  test('order.unpublishLastApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.publishApporder(apporder);
    const lastApporder = await iexec.order.signApporder(apporder);
    const lastOrderHash = await iexec.order.publishApporder(lastApporder);
    const unpublishLastRes = await iexec.order.unpublishLastApporder(
      apporder.app,
    );
    expect(unpublishLastRes).toBe(lastOrderHash);
    const unpublishLast2Res = await iexec.order.unpublishLastApporder(
      apporder.app,
    );
    expect(unpublishLast2Res).toBe(orderHash);
    await expect(
      iexec.order.unpublishLastApporder(apporder.app),
    ).rejects.toThrow(
      Error(
        `API error: no open apporder published by signer ${RICH_ADDRESS} for app ${apporder.app}`,
      ),
    );
  });

  test('order.unpublishLastDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.publishDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const lastDatasetorder = await iexec.order.signDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const lastOrderHash = await iexec.order.publishDatasetorder(
      lastDatasetorder,
      { preflightCheck: false },
    );
    const unpublishLastRes = await iexec.order.unpublishLastDatasetorder(
      datasetorder.dataset,
    );
    expect(unpublishLastRes).toBe(lastOrderHash);
    const unpublishLast2Res = await iexec.order.unpublishLastDatasetorder(
      datasetorder.dataset,
    );
    expect(unpublishLast2Res).toBe(orderHash);
    await expect(
      iexec.order.unpublishLastDatasetorder(datasetorder.dataset),
    ).rejects.toThrow(
      Error(
        `API error: no open datasetorder published by signer ${RICH_ADDRESS} for dataset ${datasetorder.dataset}`,
      ),
    );
  });

  test('order.unpublishLastWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.publishWorkerpoolorder(workerpoolorder);
    const lastWorkerpoolorder = await iexec.order.signWorkerpoolorder(
      workerpoolorder,
    );
    const lastOrderHash = await iexec.order.publishWorkerpoolorder(
      lastWorkerpoolorder,
    );
    const unpublishLastRes = await iexec.order.unpublishLastWorkerpoolorder(
      workerpoolorder.workerpool,
    );
    expect(unpublishLastRes).toBe(lastOrderHash);
    const unpublishLast2Res = await iexec.order.unpublishLastWorkerpoolorder(
      workerpoolorder.workerpool,
    );
    expect(unpublishLast2Res).toBe(orderHash);
    await expect(
      iexec.order.unpublishLastWorkerpoolorder(workerpoolorder.workerpool),
    ).rejects.toThrow(
      Error(
        `API error: no open workerpoolorder published by signer ${RICH_ADDRESS} for workerpool ${workerpoolorder.workerpool}`,
      ),
    );
  });

  test('order.unpublishLastRequestorder()', async () => {
    const { privateKey, address } = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const appDevSigner = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexecAppDev = new IExec(
      {
        ethProvider: appDevSigner,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexecAppDev);
    await iexecAppDev.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        requester: await iexec.wallet.getAddress(),
        app: apporder.app,
        appmaxprice: apporder.appprice,
        dataset: NULL_ADDRESS,
        datasetmaxprice: 0,
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: 0,
        category: 1,
        trust: 0,
        volume: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const orderHash = await iexec.order.publishRequestorder(requestorder, {
      preflightCheck: false,
    });
    const lastRequestorder = await iexec.order.signRequestorder(requestorder, {
      preflightCheck: false,
    });
    const lastOrderHash = await iexec.order.publishRequestorder(
      lastRequestorder,
      { preflightCheck: false },
    );
    const unpublishLastRes = await iexec.order.unpublishLastRequestorder(
      requestorder.requester,
    );
    expect(unpublishLastRes).toBe(lastOrderHash);
    const unpublishLast2Res = await iexec.order.unpublishLastRequestorder(
      requestorder.requester,
    );
    expect(unpublishLast2Res).toBe(orderHash);
    await expect(
      iexec.order.unpublishLastRequestorder(requestorder.requester),
    ).rejects.toThrow(
      Error(
        `API error: no open requestorder published by signer ${address} for requester ${requestorder.requester}`,
      ),
    );
  });

  test('order.unpublishAllApporders()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.publishApporder(apporder);
    const lastApporder = await iexec.order.signApporder(apporder);
    const lastOrderHash = await iexec.order.publishApporder(lastApporder);
    const unpublishAllRes = await iexec.order.unpublishAllApporders(
      apporder.app,
    );
    expect(unpublishAllRes).toEqual(
      expect.arrayContaining([orderHash, lastOrderHash]),
    );
    expect(unpublishAllRes.length).toBe(2);
    await expect(
      iexec.order.unpublishAllApporders(apporder.app),
    ).rejects.toThrow(
      Error(
        `API error: no open apporder published by signer ${RICH_ADDRESS} for app ${apporder.app}`,
      ),
    );
  });

  test('order.unpublishAllDatasetorders()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.publishDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const lastDatasetorder = await iexec.order.signDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const lastOrderHash = await iexec.order.publishDatasetorder(
      lastDatasetorder,
      { preflightCheck: false },
    );
    const unpublishAllRes = await iexec.order.unpublishAllDatasetorders(
      datasetorder.dataset,
    );
    expect(unpublishAllRes).toEqual(
      expect.arrayContaining([orderHash, lastOrderHash]),
    );
    expect(unpublishAllRes.length).toBe(2);
    await expect(
      iexec.order.unpublishAllDatasetorders(datasetorder.dataset),
    ).rejects.toThrow(
      Error(
        `API error: no open datasetorder published by signer ${RICH_ADDRESS} for dataset ${datasetorder.dataset}`,
      ),
    );
  });

  test('order.unpublishAllWorkerpoolorders()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.publishWorkerpoolorder(workerpoolorder);
    const lastWorkerpoolorder = await iexec.order.signWorkerpoolorder(
      workerpoolorder,
    );
    const lastOrderHash = await iexec.order.publishWorkerpoolorder(
      lastWorkerpoolorder,
    );
    const unpublishAllRes = await iexec.order.unpublishAllWorkerpoolorders(
      workerpoolorder.workerpool,
    );
    expect(unpublishAllRes).toEqual(
      expect.arrayContaining([orderHash, lastOrderHash]),
    );
    expect(unpublishAllRes.length).toBe(2);
    await expect(
      iexec.order.unpublishAllWorkerpoolorders(workerpoolorder.workerpool),
    ).rejects.toThrow(
      Error(
        `API error: no open workerpoolorder published by signer ${RICH_ADDRESS} for workerpool ${workerpoolorder.workerpool}`,
      ),
    );
  });

  test('order.unpublishAllRequestorders()', async () => {
    const { privateKey, address } = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const appDevSigner = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexecAppDev = new IExec(
      {
        ethProvider: appDevSigner,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexecAppDev);
    await iexecAppDev.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        requester: await iexec.wallet.getAddress(),
        app: apporder.app,
        appmaxprice: apporder.appprice,
        dataset: NULL_ADDRESS,
        datasetmaxprice: 0,
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: 0,
        category: 1,
        trust: 0,
        volume: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const orderHash = await iexec.order.publishRequestorder(requestorder, {
      preflightCheck: false,
    });
    const lastRequestorder = await iexec.order.signRequestorder(requestorder, {
      preflightCheck: false,
    });
    const lastOrderHash = await iexec.order.publishRequestorder(
      lastRequestorder,
      { preflightCheck: false },
    );
    const unpublishAllRes = await iexec.order.unpublishAllRequestorders(
      requestorder.requester,
    );
    expect(unpublishAllRes).toEqual(
      expect.arrayContaining([orderHash, lastOrderHash]),
    );
    expect(unpublishAllRes.length).toBe(2);
    await expect(
      iexec.order.unpublishAllRequestorders(requestorder.requester),
    ).rejects.toThrow(
      Error(
        `API error: no open requestorder published by signer ${address} for requester ${requestorder.requester}`,
      ),
    );
  });
});

describe('[orderbook]', () => {
  test('orderbook.fetchApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.hashApporder(apporder);
    await expect(iexec.orderbook.fetchApporder(orderHash)).rejects.toThrow(
      Error('API error: apporder not found'),
    );
    await iexec.order.publishApporder(apporder);
    const found = await iexec.orderbook.fetchApporder(orderHash);
    expect(found.order).toLooseEqual(apporder);
    expect(found.status).toBe('open');
    expect(found.remaining).toBe(1);
    expect(found.publicationTimestamp).toBeDefined();
  });

  test('orderbook.fetchDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.hashDatasetorder(datasetorder);
    await expect(iexec.orderbook.fetchDatasetorder(orderHash)).rejects.toThrow(
      Error('API error: datasetorder not found'),
    );
    await iexec.order.publishDatasetorder(datasetorder, {
      preflightCheck: false,
    });
    const found = await iexec.orderbook.fetchDatasetorder(orderHash);
    expect(found.order).toLooseEqual(datasetorder);
    expect(found.status).toBe('open');
    expect(found.remaining).toBe(1);
    expect(found.publicationTimestamp).toBeDefined();
  });

  test('orderbook.fetchWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.hashWorkerpoolorder(workerpoolorder);
    await expect(
      iexec.orderbook.fetchWorkerpoolorder(orderHash),
    ).rejects.toThrow(Error('API error: workerpoolorder not found'));
    await iexec.order.publishWorkerpoolorder(workerpoolorder);
    const found = await iexec.orderbook.fetchWorkerpoolorder(orderHash);
    expect(found.order).toLooseEqual(workerpoolorder);
    expect(found.status).toBe('open');
    expect(found.remaining).toBe(1);
    expect(found.publicationTimestamp).toBeDefined();
  });

  test('orderbook.fetchRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    await iexec.order.publishApporder(apporder);
    const requestorder = await iexec.order
      .createRequestorder({
        requester: await iexec.wallet.getAddress(),
        app: apporder.app,
        appmaxprice: apporder.appprice,
        dataset: NULL_ADDRESS,
        datasetmaxprice: 0,
        workerpool: NULL_ADDRESS,
        workerpoolmaxprice: 0,
        category: 1,
        trust: 0,
        volume: 1,
      })
      .then((o) => iexec.order.signRequestorder(o, { preflightCheck: false }));
    const orderHash = await iexec.order.hashRequestorder(requestorder);
    await expect(iexec.orderbook.fetchRequestorder(orderHash)).rejects.toThrow(
      Error('API error: requestorder not found'),
    );
    await iexec.order.publishRequestorder(requestorder, {
      preflightCheck: false,
    });
    const found = await iexec.orderbook.fetchRequestorder(orderHash);
    expect(found.order).toLooseEqual(requestorder);
    expect(found.status).toBe('open');
    expect(found.remaining).toBe(1);
    expect(found.publicationTimestamp).toBeDefined();
  });

  test('orderbook.fetchAppOrderbook()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const appAddress = getRandomAddress();
    const res = await iexec.orderbook.fetchAppOrderbook(appAddress);
    expect(res.count).toBe(0);
    expect(res.orders).toStrictEqual([]);
    const apporder = await deployAndGetApporder(iexec);

    for (let i = 0; i < 22; i += 1) {
      await iexec.order
        .signApporder(apporder)
        .then((o) => iexec.order.publishApporder(o));
    }
    for (let i = 0; i < 2; i += 1) {
      await iexec.order
        .signApporder({ ...apporder, datasetrestrict: getRandomAddress() })
        .then((o) => iexec.order.publishApporder(o));
    }
    for (let i = 0; i < 3; i += 1) {
      await iexec.order
        .signApporder({ ...apporder, workerpoolrestrict: getRandomAddress() })
        .then((o) => iexec.order.publishApporder(o));
    }
    for (let i = 0; i < 4; i += 1) {
      await iexec.order
        .signApporder({ ...apporder, requesterrestrict: getRandomAddress() })
        .then((o) => iexec.order.publishApporder(o));
    }
    await deployAndGetApporder(iexec).then((o) =>
      iexec.order.publishApporder(o),
    );

    const res1 = await iexec.orderbook.fetchAppOrderbook(apporder.app);
    expect(res1.count).toBe(22);
    expect(res1.orders.length).toBe(20);
    expect(res1.more).toBeDefined();
    const res2 = await res1.more();
    expect(res2.count).toBe(22);
    expect(res2.orders.length).toBe(2);
    expect(res2.more).toBeUndefined();
    const res3 = await iexec.orderbook.fetchAppOrderbook(apporder.app, {
      dataset: 'any',
    });
    expect(res3.count).toBe(24);
    const res4 = await iexec.orderbook.fetchAppOrderbook(apporder.app, {
      workerpool: 'any',
    });
    expect(res4.count).toBe(25);
    const res5 = await iexec.orderbook.fetchAppOrderbook(apporder.app, {
      requester: 'any',
    });
    expect(res5.count).toBe(26);
    const res6 = await iexec.orderbook.fetchAppOrderbook(apporder.app, {
      dataset: 'any',
      requester: 'any',
      workerpool: 'any',
    });
    expect(res6.count).toBe(31);
    const res7 = await iexec.orderbook.fetchAppOrderbook('any', {
      dataset: 'any',
      requester: 'any',
      workerpool: 'any',
    });
    expect(res7.count >= 32).toBe(true);
  });

  test('orderbook.fetchDatasetOrderbook()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );

    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const datasetAddress = getRandomAddress();
    const res = await iexec.orderbook.fetchDatasetOrderbook(datasetAddress);
    expect(res.count).toBe(0);
    expect(res.orders).toStrictEqual([]);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    for (let i = 0; i < 23; i += 1) {
      await iexec.order
        .signDatasetorder(datasetorder, { preflightCheck: false })
        .then((o) =>
          iexec.order.publishDatasetorder(o, { preflightCheck: false }),
        );
    }
    for (let i = 0; i < 2; i += 1) {
      await iexec.order
        .signDatasetorder(
          { ...datasetorder, apprestrict: getRandomAddress() },
          { preflightCheck: false },
        )
        .then((o) =>
          iexec.order.publishDatasetorder(o, { preflightCheck: false }),
        );
    }
    for (let i = 0; i < 3; i += 1) {
      await iexec.order
        .signDatasetorder(
          { ...datasetorder, workerpoolrestrict: getRandomAddress() },
          { preflightCheck: false },
        )
        .then((o) =>
          iexec.order.publishDatasetorder(o, { preflightCheck: false }),
        );
    }
    for (let i = 0; i < 4; i += 1) {
      await iexec.order
        .signDatasetorder(
          { ...datasetorder, requesterrestrict: getRandomAddress() },
          { preflightCheck: false },
        )
        .then((o) =>
          iexec.order.publishDatasetorder(o, { preflightCheck: false }),
        );
    }
    await deployAndGetDatasetorder(iexec).then((o) =>
      iexec.order.publishDatasetorder(o, { preflightCheck: false }),
    );

    const res1 = await iexec.orderbook.fetchDatasetOrderbook(
      datasetorder.dataset,
    );
    expect(res1.count).toBe(23);
    expect(res1.orders.length).toBe(20);
    expect(res1.more).toBeDefined();
    const res2 = await res1.more();
    expect(res2.count).toBe(23);
    expect(res2.orders.length).toBe(3);
    expect(res2.more).toBeUndefined();
    const res3 = await iexec.orderbook.fetchDatasetOrderbook(
      datasetorder.dataset,
      { app: 'any' },
    );
    expect(res3.count).toBe(25);
    const res4 = await iexec.orderbook.fetchDatasetOrderbook(
      datasetorder.dataset,
      { workerpool: 'any' },
    );
    expect(res4.count).toBe(26);
    const res5 = await iexec.orderbook.fetchDatasetOrderbook(
      datasetorder.dataset,
      { requester: 'any' },
    );
    expect(res5.count).toBe(27);
    const res6 = await iexec.orderbook.fetchDatasetOrderbook(
      datasetorder.dataset,
      { app: 'any', workerpool: 'any', requester: 'any' },
    );
    expect(res6.count).toBe(32);
    const res7 = await iexec.orderbook.fetchDatasetOrderbook('any', {
      app: 'any',
      requester: 'any',
      workerpool: 'any',
    });
    expect(res7.count >= 33).toBe(true);
  });

  test('orderbook.fetchWorkerpoolOrderbook()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
      },
    );
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const res = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
      category: 2,
    });
    expect(res.count).toBe(0);
    expect(res.orders).toStrictEqual([]);
    for (let i = 0; i < 24; i += 1) {
      await iexec.order
        .signWorkerpoolorder(workerpoolorder)
        .then((o) => iexec.order.publishWorkerpoolorder(o));
    }
    for (let i = 0; i < 2; i += 1) {
      await iexec.order
        .signWorkerpoolorder({
          ...workerpoolorder,
          apprestrict: getRandomAddress(),
        })
        .then((o) => iexec.order.publishWorkerpoolorder(o));
    }
    for (let i = 0; i < 3; i += 1) {
      await iexec.order
        .signWorkerpoolorder({
          ...workerpoolorder,
          datasetrestrict: getRandomAddress(),
        })
        .then((o) => iexec.order.publishWorkerpoolorder(o));
    }
    for (let i = 0; i < 4; i += 1) {
      await iexec.order
        .signWorkerpoolorder({
          ...workerpoolorder,
          requesterrestrict: getRandomAddress(),
        })
        .then((o) => iexec.order.publishWorkerpoolorder(o));
    }
    const res1 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
    });
    expect(res1.count).toBe(24);
    expect(res1.orders.length).toBe(20);
    expect(res1.more).toBeDefined();
    const res2 = await res1.more();
    expect(res2.count).toBe(24);
    expect(res2.orders.length).toBe(4);
    expect(res2.more).toBeUndefined();
    const res3 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
      app: 'any',
    });
    expect(res3.count).toBe(26);
    const res4 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
      dataset: 'any',
    });
    expect(res4.count).toBe(27);
    const res5 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
      requester: 'any',
    });
    expect(res5.count).toBe(28);
    const res6 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: workerpoolorder.workerpool,
      app: 'any',
      dataset: 'any',
      requester: 'any',
    });
    expect(res6.count).toBe(33);
    const res7 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      app: 'any',
      dataset: 'any',
      requester: 'any',
    });
    const res8 = await iexec.orderbook.fetchWorkerpoolOrderbook({
      workerpool: 'any',
      app: 'any',
      dataset: 'any',
      requester: 'any',
    });
    expect(res7.count).toBe(res8.count);
  });

  test('orderbook.fetchRequestOrderbook()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
        smsURL: 'https://sms.iex.ec',
      },
    );
    const initialOrderbookRes = await iexec.orderbook.fetchRequestOrderbook({
      category: 2,
    });
    const initialAnyWorkerpoolRes = await iexec.orderbook.fetchRequestOrderbook(
      { category: 2, workerpool: 'any' },
    );
    const apporder = await deployAndGetApporder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      category: 2,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    await iexec.order.publishApporder(apporder);
    await iexec.order.publishWorkerpoolorder(workerpoolorder);
    for (let i = 0; i < 25; i += 1) {
      await iexec.order
        .signRequestorder(
          { ...requestorder, workerpool: NULL_ADDRESS },
          { preflightCheck: false },
        )
        .then((o) =>
          iexec.order.publishRequestorder(o, {
            preflightCheck: false,
          }),
        );
    }
    for (let i = 0; i < 2; i += 1) {
      await iexec.order
        .signRequestorder(
          { ...requestorder, workerpool: getRandomAddress() },
          { preflightCheck: false },
        )
        .then((o) =>
          iexec.order.publishRequestorder(o, {
            preflightCheck: false,
          }),
        );
    }
    const res1 = await iexec.orderbook.fetchRequestOrderbook({
      requester: await iexec.wallet.getAddress(),
      category: 2,
    });
    expect(res1.count).toBe(initialOrderbookRes.count + 25);
    expect(res1.orders.length).toBe(20);
    expect(res1.more).toBeDefined();
    const res2 = await res1.more();
    expect(res2.count).toBe(initialOrderbookRes.count + 25);
    expect(res2.orders.length >= 5).toBe(true);
    if (res2.orders.length < 20) {
      expect(res2.more).toBeUndefined();
    }
    const res3 = await iexec.orderbook.fetchRequestOrderbook({
      requester: await iexec.wallet.getAddress(),
      category: 2,
      workerpool: 'any',
    });
    expect(res3.count).toBe(initialAnyWorkerpoolRes.count + 27);
    const res4 = await iexec.orderbook.fetchRequestOrderbook({
      workerpool: 'any',
    });
    const res5 = await iexec.orderbook.fetchRequestOrderbook({
      requester: 'any',
      workerpool: 'any',
    });
    expect(res4.count).toBe(res5.count);
  });
});

describe('[deal]', () => {
  test('deal.fetchRequesterDeals()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const requesterAddress = await iexec.wallet.getAddress();
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const res = await iexec.deal.fetchRequesterDeals(
      await iexec.wallet.getAddress(),
    );
    expect(typeof res.count).toBe('number');
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    await sleep(5000);
    const resAfterMatch = await iexec.deal.fetchRequesterDeals(
      requesterAddress,
    );
    expect(res.count).toBe(resAfterMatch.count - 1);
    const resAppFiltered = await iexec.deal.fetchRequesterDeals(
      requesterAddress,
      {
        appAddress: apporder.app,
      },
    );
    expect(resAppFiltered.count).toBe(1);
    expect(resAppFiltered.deals[0].dealid).toBe(dealid);
    expect(resAppFiltered.deals[0].app.pointer).toBe(apporder.app);
    const resDatasetFiltered = await iexec.deal.fetchRequesterDeals(
      requesterAddress,
      {
        datasetAddress: datasetorder.dataset,
      },
    );
    expect(resDatasetFiltered.count).toBe(1);
    expect(resDatasetFiltered.deals[0].dealid).toBe(dealid);
    expect(resDatasetFiltered.deals[0].dataset.pointer).toBe(
      datasetorder.dataset,
    );
    const resWorkerpoolFiltered = await iexec.deal.fetchRequesterDeals(
      requesterAddress,
      {
        workerpoolAddress: workerpoolorder.workerpool,
      },
    );
    expect(resWorkerpoolFiltered.deals[0].dealid).toBe(dealid);
    expect(resWorkerpoolFiltered.count).toBe(1);
    expect(resWorkerpoolFiltered.deals[0].workerpool.pointer).toBe(
      workerpoolorder.workerpool,
    );
  });

  test('deal.fetchDealsByApporder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const orderHash = await iexec.order.hashApporder(apporder);
    const res = await iexec.deal.fetchDealsByApporder(orderHash);
    expect(res.count).toBe(0);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    await sleep(5000);
    const resAfterMatch = await iexec.deal.fetchDealsByApporder(orderHash);
    expect(resAfterMatch.count).toBe(1);
    expect(resAfterMatch.deals[0].dealid).toBe(dealid);
    expect(resAfterMatch.deals[0].app.pointer).toBe(apporder.app);
  });

  test('deal.fetchDealsByDatasetorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const orderHash = await iexec.order.hashDatasetorder(datasetorder);
    const res = await iexec.deal.fetchDealsByDatasetorder(orderHash);
    expect(res.count).toBe(0);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    await sleep(5000);
    const resAfterMatch = await iexec.deal.fetchDealsByDatasetorder(orderHash);
    expect(resAfterMatch.count).toBe(1);
    expect(resAfterMatch.deals[0].dealid).toBe(dealid);
    expect(resAfterMatch.deals[0].dataset.pointer).toBe(datasetorder.dataset);
  });

  test('deal.fetchDealsByWorkerpoolorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const orderHash = await iexec.order.hashWorkerpoolorder(workerpoolorder);
    const res = await iexec.deal.fetchDealsByWorkerpoolorder(orderHash);
    expect(res.count).toBe(0);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    await sleep(5000);
    const resAfterMatch = await iexec.deal.fetchDealsByWorkerpoolorder(
      orderHash,
    );
    expect(resAfterMatch.count).toBe(1);
    expect(resAfterMatch.deals[0].dealid).toBe(dealid);
    expect(resAfterMatch.deals[0].workerpool.pointer).toBe(
      workerpoolorder.workerpool,
    );
  });

  test('deal.fetchDealsByRequestorder()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        iexecGatewayURL,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const orderHash = await iexec.order.hashRequestorder(requestorder);
    const res = await iexec.deal.fetchDealsByRequestorder(orderHash);
    expect(res.count).toBe(0);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    await sleep(5000);
    const resAfterMatch = await iexec.deal.fetchDealsByRequestorder(orderHash);
    expect(resAfterMatch.count).toBe(1);
    expect(resAfterMatch.deals[0].dealid).toBe(dealid);
    expect(resAfterMatch.deals[0].requester).toBe(requestorder.requester);
  });

  test('deal.obsDeal()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const catid = await createCategory(iexec, { workClockTimeRef: 10 });
    const apporder = await deployAndGetApporder(iexec, { volume: 10 });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      category: catid,
      volume: 10,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );

    const obsDealValues = [];
    const obsDealUnsubBeforeNextValues = [];

    let unsubObsDeal;
    let unsubObsDealBeforeNext;

    await Promise.all([
      new Promise((resolve, reject) => {
        iexec.deal
          .obsDeal(dealid)
          .then((obs) => {
            unsubObsDeal = obs.subscribe({
              next: (value) => {
                obsDealValues.push(value);
              },
              error: () => reject(Error('obsDeal should not call error')),
              complete: () => reject(Error('obsDeal should not call complete')),
            });
            sleep(10000).then(resolve);
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.deal
          .obsDeal(dealid)
          .then((obs) => {
            unsubObsDealBeforeNext = obs.subscribe({
              next: (value) => {
                obsDealUnsubBeforeNextValues.push(value);
                try {
                  unsubObsDealBeforeNext();
                } catch (e) {
                  reject(e);
                }
              },
              error: () =>
                reject(
                  Error('obsDeal unsub before next should not call error'),
                ),
              complete: () =>
                reject(
                  Error('obsDeal unsub before next should not call complete'),
                ),
            });
            sleep(10000).then(resolve);
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        sleep(1000).then(() => {
          initializeTask(tokenChainWallet, hubAddress, dealid, 5)
            .then(() => {
              sleep(6000).then(() => {
                initializeTask(tokenChainWallet, hubAddress, dealid, 0)
                  .then(() => sleep(6000).then(resolve))
                  .catch(reject);
              });
            })
            .catch(reject);
        });
      }),
    ]);

    expect(unsubObsDeal).toBeInstanceOf(Function);
    expect(unsubObsDealBeforeNext).toBeInstanceOf(Function);

    unsubObsDeal();

    expect(obsDealValues.length).toBe(3);

    expect(obsDealValues[0].message).toBe('DEAL_UPDATED');
    expect(obsDealValues[0].tasksCount).toBe(10);
    expect(obsDealValues[0].completedTasksCount).toBe(0);
    expect(obsDealValues[0].failedTasksCount).toBe(0);
    expect(obsDealValues[0].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealValues[0].tasks).length).toBe(10);
    expect(obsDealValues[0].tasks[0].status).toBe(0);
    expect(obsDealValues[0].tasks[1].status).toBe(0);
    expect(obsDealValues[0].tasks[2].status).toBe(0);
    expect(obsDealValues[0].tasks[3].status).toBe(0);
    expect(obsDealValues[0].tasks[4].status).toBe(0);
    expect(obsDealValues[0].tasks[5].status).toBe(0);
    expect(obsDealValues[0].tasks[6].status).toBe(0);
    expect(obsDealValues[0].tasks[7].status).toBe(0);
    expect(obsDealValues[0].tasks[8].status).toBe(0);
    expect(obsDealValues[0].tasks[9].status).toBe(0);

    expect(obsDealValues[1].message).toBe('DEAL_UPDATED');
    expect(obsDealValues[1].tasksCount).toBe(10);
    expect(obsDealValues[1].completedTasksCount).toBe(0);
    expect(obsDealValues[1].failedTasksCount).toBe(0);
    expect(obsDealValues[1].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealValues[1].tasks).length).toBe(10);
    expect(obsDealValues[1].tasks[0].status).toBe(0);
    expect(obsDealValues[1].tasks[1].status).toBe(0);
    expect(obsDealValues[1].tasks[2].status).toBe(0);
    expect(obsDealValues[1].tasks[3].status).toBe(0);
    expect(obsDealValues[1].tasks[4].status).toBe(0);
    expect(obsDealValues[1].tasks[5].status).toBe(1);
    expect(obsDealValues[1].tasks[6].status).toBe(0);
    expect(obsDealValues[1].tasks[7].status).toBe(0);
    expect(obsDealValues[1].tasks[8].status).toBe(0);
    expect(obsDealValues[1].tasks[9].status).toBe(0);

    expect(obsDealValues[2].message).toBe('DEAL_UPDATED');
    expect(obsDealValues[2].tasksCount).toBe(10);
    expect(obsDealValues[2].completedTasksCount).toBe(0);
    expect(obsDealValues[2].failedTasksCount).toBe(0);
    expect(obsDealValues[2].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealValues[2].tasks).length).toBe(10);
    expect(obsDealValues[2].tasks[0].status).toBe(1);
    expect(obsDealValues[2].tasks[1].status).toBe(0);
    expect(obsDealValues[2].tasks[2].status).toBe(0);
    expect(obsDealValues[2].tasks[3].status).toBe(0);
    expect(obsDealValues[2].tasks[4].status).toBe(0);
    expect(obsDealValues[2].tasks[5].status).toBe(1);
    expect(obsDealValues[2].tasks[6].status).toBe(0);
    expect(obsDealValues[2].tasks[7].status).toBe(0);
    expect(obsDealValues[2].tasks[8].status).toBe(0);
    expect(obsDealValues[2].tasks[9].status).toBe(0);

    expect(obsDealUnsubBeforeNextValues.length).toBe(1);

    expect(obsDealUnsubBeforeNextValues[0].message).toBe('DEAL_UPDATED');
    expect(obsDealUnsubBeforeNextValues[0].tasksCount).toBe(10);
    expect(obsDealUnsubBeforeNextValues[0].completedTasksCount).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].failedTasksCount).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealUnsubBeforeNextValues[0].tasks).length).toBe(
      10,
    );
    expect(obsDealUnsubBeforeNextValues[0].tasks[0].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[1].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[2].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[3].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[4].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[5].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[6].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[7].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[8].status).toBe(0);
    expect(obsDealUnsubBeforeNextValues[0].tasks[9].status).toBe(0);
  });

  test('deal.obsDeal() (deal timeout)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const catid = await createCategory(iexec, { workClockTimeRef: 2 });
    const apporder = await deployAndGetApporder(iexec, { volume: 10 });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      category: catid,
      volume: 10,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );

    const obsDealCompleteValues = [];
    const obsDealWithWrongDealidValues = [];
    const obsDealUnsubBeforeCompleteValues = [];

    let unsubObsDealBeforeComplete;

    const [
      obsDealComplete,
      obsDealWithWrongDealidError,
      obsDealUnsubBeforeComplete,
    ] = await Promise.all([
      new Promise((resolve, reject) => {
        iexec.deal
          .obsDeal(dealid)
          .then((obs) => {
            obs.subscribe({
              next: (value) => {
                obsDealCompleteValues.push(value);
              },
              error: () => reject(Error('obsDeal should not call error')),
              complete: resolve,
            });
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.deal
          .obsDeal(utils.NULL_BYTES32)
          .then((obs) => {
            obs.subscribe({
              next: (value) => {
                obsDealWithWrongDealidValues.push(value);
              },
              error: resolve,
              complete: () =>
                reject(
                  Error('obsDeal with wrong dealid should not call complete'),
                ),
            });
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.deal
          .obsDeal(dealid)
          .then((obs) => {
            unsubObsDealBeforeComplete = obs.subscribe({
              next: (value) => {
                unsubObsDealBeforeComplete();
                obsDealUnsubBeforeCompleteValues.push(value);
              },
              error: () =>
                reject(
                  Error('obsDeal unsub before complete should not call error'),
                ),
              complete: () =>
                reject(
                  Error(
                    'obsDeal unsub before complete should not call complete',
                  ),
                ),
            });
            sleep(10000).then(resolve);
          })
          .catch(reject);
      }),
      sleep(5000)
        .then(() => initializeTask(tokenChainWallet, hubAddress, dealid, 5))
        .then(() => sleep(1000))
        .then(() => initializeTask(tokenChainWallet, hubAddress, dealid, 0)),
    ]);

    expect(obsDealComplete).toBeUndefined();
    expect(obsDealWithWrongDealidError).toEqual(
      new errors.ObjectNotFoundError('deal', utils.NULL_BYTES32, networkId),
    );
    expect(obsDealUnsubBeforeComplete).toBeUndefined();

    expect(obsDealCompleteValues.length).toBe(13);

    expect(obsDealCompleteValues[0].message).toBe('DEAL_UPDATED');
    expect(obsDealCompleteValues[0].tasksCount).toBe(10);
    expect(obsDealCompleteValues[0].completedTasksCount).toBe(0);
    expect(obsDealCompleteValues[0].failedTasksCount).toBe(0);
    expect(obsDealCompleteValues[0].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealCompleteValues[0].tasks).length).toBe(10);
    expect(obsDealCompleteValues[0].tasks[0].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[1].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[2].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[3].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[4].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[5].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[6].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[7].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[8].status).toBe(0);
    expect(obsDealCompleteValues[0].tasks[9].status).toBe(0);

    expect(obsDealCompleteValues[2].message).toBe('DEAL_UPDATED');
    expect(obsDealCompleteValues[2].tasksCount).toBe(10);
    expect(obsDealCompleteValues[2].completedTasksCount).toBe(0);
    expect(obsDealCompleteValues[2].failedTasksCount).toBe(0);
    expect(obsDealCompleteValues[2].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealCompleteValues[2].tasks).length).toBe(10);
    expect(obsDealCompleteValues[2].tasks[0].status).toBe(1);
    expect(obsDealCompleteValues[2].tasks[1].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[2].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[3].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[4].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[5].status).toBe(1);
    expect(obsDealCompleteValues[2].tasks[6].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[7].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[8].status).toBe(0);
    expect(obsDealCompleteValues[2].tasks[9].status).toBe(0);

    expect(obsDealCompleteValues[11].message).toBe('DEAL_UPDATED');
    expect(obsDealCompleteValues[11].tasksCount).toBe(10);
    expect(obsDealCompleteValues[11].completedTasksCount).toBe(0);
    expect(obsDealCompleteValues[11].failedTasksCount).toBe(9);
    expect(obsDealCompleteValues[11].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealCompleteValues[11].tasks).length).toBe(10);
    expect(obsDealCompleteValues[11].tasks[0].status).toBe(1);
    expect(obsDealCompleteValues[11].tasks[1].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[2].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[3].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[4].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[5].status).toBe(1);
    expect(obsDealCompleteValues[11].tasks[6].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[7].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[8].status).toBe(0);
    expect(obsDealCompleteValues[11].tasks[9].status).toBe(0);

    expect(obsDealCompleteValues[12].message).toBe('DEAL_TIMEDOUT');
    expect(obsDealCompleteValues[12].tasksCount).toBe(10);
    expect(obsDealCompleteValues[12].completedTasksCount).toBe(0);
    expect(obsDealCompleteValues[12].failedTasksCount).toBe(10);
    expect(obsDealCompleteValues[12].deal.dealid).toBe(dealid);
    expect(Object.entries(obsDealCompleteValues[12].tasks).length).toBe(10);
    expect(obsDealCompleteValues[12].tasks[0].status).toBe(1);
    expect(obsDealCompleteValues[12].tasks[1].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[2].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[3].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[4].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[5].status).toBe(1);
    expect(obsDealCompleteValues[12].tasks[6].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[7].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[8].status).toBe(0);
    expect(obsDealCompleteValues[12].tasks[9].status).toBe(0);

    expect(obsDealWithWrongDealidValues.length).toBe(0);

    expect(obsDealUnsubBeforeCompleteValues.length).toBe(1);

    expect(obsDealUnsubBeforeCompleteValues[0].message).toBe('DEAL_UPDATED');
    expect(obsDealUnsubBeforeCompleteValues[0].tasksCount).toBe(10);
    expect(obsDealUnsubBeforeCompleteValues[0].completedTasksCount).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].failedTasksCount).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].deal.dealid).toBe(dealid);
    expect(
      Object.entries(obsDealUnsubBeforeCompleteValues[0].tasks).length,
    ).toBe(10);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[0].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[1].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[2].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[3].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[4].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[5].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[6].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[7].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[8].status).toBe(0);
    expect(obsDealUnsubBeforeCompleteValues[0].tasks[9].status).toBe(0);
  });
});

describe('[task]', () => {
  test('task.obsTask()', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const catid = await createCategory(iexec, { workClockTimeRef: 10 });
    const apporder = await deployAndGetApporder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      category: catid,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    const { tasks } = await iexec.deal.show(dealid);
    const taskid = tasks[0];

    const obsTaskWithDealidValues = [];
    const obsTaskUnsubBeforeNextValues = [];
    const obsTaskAfterInitValues = [];

    let unsubObsTaskWithDealid;
    let unsubObsTaskBeforeNext;
    let unsubObsTaskAfterInit;

    await Promise.all([
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid, { dealid })
          .then((obs) => {
            unsubObsTaskWithDealid = obs.subscribe({
              next: (value) => {
                obsTaskWithDealidValues.push(value);
              },
              error: () =>
                reject(Error('obsTask with dealid should not call error')),
              complete: () =>
                reject(Error('obsTask with dealid should not call complete')),
            });
            sleep(10000).then(resolve);
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid, { dealid })
          .then((obs) => {
            unsubObsTaskBeforeNext = obs.subscribe({
              next: (value) => {
                obsTaskUnsubBeforeNextValues.push(value);
                try {
                  unsubObsTaskBeforeNext();
                } catch (e) {
                  reject(e);
                }
              },
              error: () =>
                reject(
                  Error('obsTask unsub before next should not call error'),
                ),
              complete: () =>
                reject(
                  Error('obsTask unsub before next should not call complete'),
                ),
            });
            sleep(10000).then(resolve);
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        sleep(5000).then(() => {
          iexec.task
            .obsTask(taskid)
            .then((obs) => {
              unsubObsTaskAfterInit = obs.subscribe({
                next: (value) => {
                  obsTaskAfterInitValues.push(value);
                },
                error: () =>
                  reject(Error('obsTask after init should not call error')),
                complete: () =>
                  reject(Error('obsTask after init should not call complete')),
              });
              sleep(5000).then(resolve);
            })
            .catch(reject);
        });
      }),
      sleep(1000).then(() =>
        initializeTask(tokenChainWallet, hubAddress, dealid, 0),
      ),
    ]);

    expect(unsubObsTaskWithDealid).toBeInstanceOf(Function);
    expect(unsubObsTaskBeforeNext).toBeInstanceOf(Function);
    expect(unsubObsTaskAfterInit).toBeInstanceOf(Function);

    unsubObsTaskWithDealid();
    unsubObsTaskAfterInit();

    expect(obsTaskWithDealidValues.length).toBe(2);

    expect(obsTaskWithDealidValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskWithDealidValues[0].task.taskid).toBe(taskid);
    expect(obsTaskWithDealidValues[0].task.dealid).toBe(dealid);
    expect(obsTaskWithDealidValues[0].task.status).toBe(0);
    expect(obsTaskWithDealidValues[0].task.statusName).toBe('UNSET');
    expect(obsTaskWithDealidValues[0].task.taskTimedOut).toBe(false);

    expect(obsTaskWithDealidValues[1].message).toBe('TASK_UPDATED');
    expect(obsTaskWithDealidValues[1].task.taskid).toBe(taskid);
    expect(obsTaskWithDealidValues[1].task.dealid).toBe(dealid);
    expect(obsTaskWithDealidValues[1].task.status).toBe(1);
    expect(obsTaskWithDealidValues[1].task.statusName).toBe('ACTIVE');
    expect(obsTaskWithDealidValues[1].task.taskTimedOut).toBe(false);

    expect(obsTaskUnsubBeforeNextValues.length).toBe(1);

    expect(obsTaskUnsubBeforeNextValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskUnsubBeforeNextValues[0].task.taskid).toBe(taskid);
    expect(obsTaskUnsubBeforeNextValues[0].task.dealid).toBe(dealid);
    expect(obsTaskUnsubBeforeNextValues[0].task.status).toBe(0);
    expect(obsTaskUnsubBeforeNextValues[0].task.statusName).toBe('UNSET');
    expect(obsTaskUnsubBeforeNextValues[0].task.taskTimedOut).toBe(false);

    expect(obsTaskAfterInitValues.length).toBe(1);

    expect(obsTaskAfterInitValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskAfterInitValues[0].task.taskid).toBe(taskid);
    expect(obsTaskAfterInitValues[0].task.dealid).toBe(dealid);
    expect(obsTaskAfterInitValues[0].task.status).toBe(1);
    expect(obsTaskAfterInitValues[0].task.statusName).toBe('ACTIVE');
    expect(obsTaskAfterInitValues[0].task.taskTimedOut).toBe(false);
  });

  test('task.obsTask() (task timeout)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL: 'https://result-proxy.iex.ec',
      },
    );
    const catid = await createCategory(iexec, { workClockTimeRef: 1 });
    const apporder = await deployAndGetApporder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      category: catid,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { preflightCheck: false },
    );
    const { tasks } = await iexec.deal.show(dealid);
    const taskid = tasks[0];

    const obsTaskWithDealidValues = [];
    const obsTaskWithWrongDealidValues = [];
    const obsTaskBeforeInitValues = [];
    const obsTaskAfterInitValues = [];
    const obsTaskUnsubBeforeCompleteValues = [];

    let unsubObsTaskBeforeComplete;

    const [
      obsTaskWithDealidComplete,
      obsTaskWithWrongDealidError,
      obsTaskBeforeInitError,
      obsTaskAfterInitComplete,
    ] = await Promise.all([
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid, { dealid })
          .then((obs) => {
            obs.subscribe({
              next: (value) => {
                obsTaskWithDealidValues.push(value);
              },
              error: () =>
                reject(Error('obsTask with dealid should not call error')),
              complete: resolve,
            });
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid, { dealid: utils.NULL_BYTES32 })
          .then((obs) => {
            obs.subscribe({
              next: (value) => {
                obsTaskWithWrongDealidValues.push(value);
              },
              error: resolve,
              complete: () =>
                reject(
                  Error('obsTask with wrong dealid should not call complete'),
                ),
            });
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid)
          .then((obs) => {
            obs.subscribe({
              next: (value) => {
                obsTaskBeforeInitValues.push(value);
              },
              error: resolve,
              complete: () =>
                reject(Error('obsTask before init should not call complete')),
            });
          })
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        sleep(5000).then(() => {
          iexec.task
            .obsTask(taskid)
            .then((obs) => {
              obs.subscribe({
                next: (value) => {
                  obsTaskAfterInitValues.push(value);
                },
                error: () =>
                  reject(Error('obsTask after init should not call error')),
                complete: resolve,
              });
            })
            .catch(reject);
        });
      }),
      new Promise((resolve, reject) => {
        iexec.task
          .obsTask(taskid, { dealid })
          .then((obs) => {
            unsubObsTaskBeforeComplete = obs.subscribe({
              next: (value) => {
                obsTaskUnsubBeforeCompleteValues.push(value);
              },
              error: () =>
                reject(Error('obsTask unsubscribed should nol call complete')),
              complete: () =>
                reject(Error('obsTask unsubscribed should nol call complete')),
            });
            sleep(1000).then(resolve);
          })
          .catch(reject);
      }),
      sleep(1000).then(() => {
        unsubObsTaskBeforeComplete();
        initializeTask(tokenChainWallet, hubAddress, dealid, 0);
      }),
    ]);

    expect(obsTaskWithDealidComplete).toBeUndefined();
    expect(obsTaskWithWrongDealidError).toEqual(
      new errors.ObjectNotFoundError('deal', utils.NULL_BYTES32, networkId),
    );
    expect(obsTaskBeforeInitError).toEqual(
      new errors.ObjectNotFoundError('task', taskid, networkId),
    );
    expect(obsTaskAfterInitComplete).toBeUndefined();

    expect(obsTaskWithDealidValues.length).toBe(3);

    expect(obsTaskWithDealidValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskWithDealidValues[0].task.taskid).toBe(taskid);
    expect(obsTaskWithDealidValues[0].task.dealid).toBe(dealid);
    expect(obsTaskWithDealidValues[0].task.status).toBe(0);
    expect(obsTaskWithDealidValues[0].task.statusName).toBe('UNSET');
    expect(obsTaskWithDealidValues[0].task.taskTimedOut).toBe(false);

    expect(obsTaskWithDealidValues[1].message).toBe('TASK_UPDATED');
    expect(obsTaskWithDealidValues[1].task.taskid).toBe(taskid);
    expect(obsTaskWithDealidValues[1].task.dealid).toBe(dealid);
    expect(obsTaskWithDealidValues[1].task.status).toBe(1);
    expect(obsTaskWithDealidValues[1].task.statusName).toBe('ACTIVE');
    expect(obsTaskWithDealidValues[1].task.taskTimedOut).toBe(false);

    expect(obsTaskWithDealidValues[2].message).toBe('TASK_TIMEDOUT');
    expect(obsTaskWithDealidValues[2].task.taskid).toBe(taskid);
    expect(obsTaskWithDealidValues[2].task.dealid).toBe(dealid);
    expect(obsTaskWithDealidValues[2].task.status).toBe(1);
    expect(obsTaskWithDealidValues[2].task.statusName).toBe('TIMEOUT');
    expect(obsTaskWithDealidValues[2].task.taskTimedOut).toBe(true);

    expect(obsTaskWithWrongDealidValues.length).toBe(0);

    expect(obsTaskBeforeInitValues.length).toBe(0);

    expect(obsTaskAfterInitValues.length).toBe(2);

    expect(obsTaskAfterInitValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskAfterInitValues[0].task.taskid).toBe(taskid);
    expect(obsTaskAfterInitValues[0].task.dealid).toBe(dealid);
    expect(obsTaskAfterInitValues[0].task.status).toBe(1);
    expect(obsTaskAfterInitValues[0].task.statusName).toBe('ACTIVE');
    expect(obsTaskAfterInitValues[0].task.taskTimedOut).toBe(false);

    expect(obsTaskAfterInitValues[1].message).toBe('TASK_TIMEDOUT');
    expect(obsTaskAfterInitValues[1].task.taskid).toBe(taskid);
    expect(obsTaskAfterInitValues[1].task.dealid).toBe(dealid);
    expect(obsTaskAfterInitValues[1].task.status).toBe(1);
    expect(obsTaskAfterInitValues[1].task.statusName).toBe('TIMEOUT');
    expect(obsTaskAfterInitValues[1].task.taskTimedOut).toBe(true);

    expect(obsTaskUnsubBeforeCompleteValues.length).toBe(1);

    expect(obsTaskUnsubBeforeCompleteValues[0].message).toBe('TASK_UPDATED');
    expect(obsTaskUnsubBeforeCompleteValues[0].task.taskid).toBe(taskid);
    expect(obsTaskUnsubBeforeCompleteValues[0].task.dealid).toBe(dealid);
    expect(obsTaskUnsubBeforeCompleteValues[0].task.status).toBe(0);
    expect(obsTaskUnsubBeforeCompleteValues[0].task.statusName).toBe('UNSET');
    expect(obsTaskUnsubBeforeCompleteValues[0].task.taskTimedOut).toBe(false);
  });
});

describe('[storage]', () => {
  test('storage.defaultStorageLogin()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        resultProxyURL,
      },
    );
    const token = await iexec.storage.defaultStorageLogin();
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
    const token2 = await iexec.storage.defaultStorageLogin();
    expect(token2).toBe(token);
  });

  test('storage.pushStorageToken()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.storage.pushStorageToken('oops');
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    await expect(iexec.storage.pushStorageToken('oops')).rejects.toThrow(
      Error(
        `Secret "iexec-result-iexec-ipfs-token" already exists for ${randomWallet.address}`,
      ),
    );
    const pushForTeeFramework = await iexec.storage.pushStorageToken('oops', {
      teeFramework: 'gramine',
    });
    expect(pushForTeeFramework.isPushed).toBe(true);
    expect(pushForTeeFramework.isUpdated).toBe(false);
  });

  test('storage.pushStorageToken() (provider: "default")', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.storage.pushStorageToken('oops', {
      provider: 'default',
    });
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    await expect(
      iexec.storage.pushStorageToken('oops', { provider: 'default' }),
    ).rejects.toThrow(
      Error(
        `Secret "iexec-result-iexec-ipfs-token" already exists for ${randomWallet.address}`,
      ),
    );
  });

  test('storage.pushStorageToken() (provider: "dropbox")', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.storage.pushStorageToken('oops', {
      provider: 'dropbox',
    });
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    await expect(
      iexec.storage.pushStorageToken('oops', { provider: 'dropbox' }),
    ).rejects.toThrow(
      Error(
        `Secret "iexec-result-dropbox-token" already exists for ${randomWallet.address}`,
      ),
    );
  });

  test('storage.pushStorageToken() (forceUpdate)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.storage.pushStorageToken('oops', {
      forceUpdate: true,
    });
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    const updateRes = await iexec.storage.pushStorageToken('oops', {
      forceUpdate: true,
    });
    expect(updateRes.isPushed).toBe(true);
    expect(updateRes.isUpdated).toBe(true);
  });

  test('storage.checkStorageTokenExists()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const withoutSecretRes = await iexec.storage.checkStorageTokenExists(
      randomWallet.address,
      { provider: 'dropbox' },
    );
    expect(withoutSecretRes).toBe(false);
    await iexec.storage.pushStorageToken('oops', { provider: 'dropbox' });
    const withSecretRes = await iexec.storage.checkStorageTokenExists(
      randomWallet.address,
      { provider: 'dropbox' },
    );
    expect(withSecretRes).toBe(true);
    const unsetProviderRes = await iexec.storage.checkStorageTokenExists(
      randomWallet.address,
    );
    expect(unsetProviderRes).toBe(false);
    await expect(
      iexec.storage.checkStorageTokenExists(randomWallet.address, {
        provider: 'test',
      }),
    ).rejects.toThrow(Error('"test" not supported'));
    const unsetForTeeFramework = await iexec.storage.checkStorageTokenExists(
      randomWallet.address,
      { teeFramework: 'gramine' },
    );
    expect(unsetForTeeFramework).toBe(false);
    await iexec.storage.pushStorageToken('oops', { teeFramework: 'gramine' });
    const setForTeeFramework = await iexec.storage.checkStorageTokenExists(
      randomWallet.address,
      { teeFramework: 'gramine' },
    );
    expect(setForTeeFramework).toBe(true);
  });
});

describe('[result]', () => {
  test('result.pushResultEncryptionKey()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.result.pushResultEncryptionKey('oops');
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    await expect(iexec.result.pushResultEncryptionKey('oops')).rejects.toThrow(
      Error(
        `Secret "iexec-result-encryption-public-key" already exists for ${randomWallet.address}`,
      ),
    );
    await expect(
      iexec.result.pushResultEncryptionKey('oops', {
        teeFramework: TEE_FRAMEWORKS.SCONE,
      }),
    ).rejects.toThrow(
      Error(
        `Secret "iexec-result-encryption-public-key" already exists for ${randomWallet.address}`,
      ),
    );
    const pushForTeeFrameworkRes = await iexec.result.pushResultEncryptionKey(
      'oops',
      { teeFramework: TEE_FRAMEWORKS.GRAMINE },
    );
    expect(pushForTeeFrameworkRes.isPushed).toBe(true);
    expect(pushForTeeFrameworkRes.isUpdated).toBe(false);
  });

  test('result.pushResultEncryptionKey() (forceUpdate)', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.result.pushResultEncryptionKey('Oops', {
      forceUpdate: true,
    });
    expect(pushRes.isPushed).toBe(true);
    expect(pushRes.isUpdated).toBe(false);
    const pushSameRes = await iexec.result.pushResultEncryptionKey('Oops', {
      forceUpdate: true,
    });
    expect(pushSameRes.isPushed).toBe(true);
    expect(pushSameRes.isUpdated).toBe(true);
  });

  test('result.checkResultEncryptionKeyExists()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const withoutSecretRes = await iexec.result.checkResultEncryptionKeyExists(
      randomWallet.address,
    );
    expect(withoutSecretRes).toBe(false);
    await iexec.result.pushResultEncryptionKey('oops');
    const withSecretRes = await iexec.result.checkResultEncryptionKeyExists(
      randomWallet.address,
    );
    expect(withSecretRes).toBe(true);
    const withSecretForTeeFrameworkRes =
      await iexec.result.checkResultEncryptionKeyExists(randomWallet.address, {
        teeFramework: TEE_FRAMEWORKS.SCONE,
      });
    expect(withSecretForTeeFrameworkRes).toBe(true);
    const withoutSecretForTeeFrameworkRes =
      await iexec.result.checkResultEncryptionKeyExists(randomWallet.address, {
        teeFramework: TEE_FRAMEWORKS.GRAMINE,
      });
    expect(withoutSecretForTeeFrameworkRes).toBe(false);
  });

  test('result.decryptResult()', async () => {
    const encZip = await readFile(
      join(process.cwd(), 'test/inputs/encryptedResults/encryptedResults.zip'),
    );
    const beneficiaryKey = await readFile(
      join(
        process.cwd(),
        'test/inputs/beneficiaryKeys/0x7bd4783FDCAD405A28052a0d1f11236A741da593_key',
      ),
    );
    const res = await utils.decryptResult(encZip, beneficiaryKey);
    const resContent = [];
    const resZip = await new JSZip().loadAsync(res);
    resZip.forEach((relativePath, zipEntry) => {
      resContent.push(zipEntry);
    });
    expect(resContent.length).toBe(3);
    expect(resContent[0].name).toBe('computed.json');
    expect(resContent[1].name).toBe('volume.fspf');
    expect(resContent[2].name).toBe('result.txt');
  });

  test('result.decryptResult() string key', async () => {
    const encZip = await readFile(
      join(process.cwd(), 'test/inputs/encryptedResults/encryptedResults.zip'),
    );
    const beneficiaryKey = (
      await readFile(
        join(
          process.cwd(),
          'test/inputs/beneficiaryKeys/0x7bd4783FDCAD405A28052a0d1f11236A741da593_key',
        ),
      )
    ).toString();
    const res = await utils.decryptResult(encZip, beneficiaryKey);
    const resContent = [];
    const resZip = await new JSZip().loadAsync(res);
    resZip.forEach((relativePath, zipEntry) => {
      resContent.push(zipEntry);
    });
    expect(resContent.length).toBe(3);
    expect(resContent[0].name).toBe('computed.json');
    expect(resContent[1].name).toBe('volume.fspf');
    expect(resContent[2].name).toBe('result.txt');
  });

  test('result.decryptResult() wrong key', async () => {
    const encZip = await readFile(
      join(process.cwd(), 'test/inputs/encryptedResults/encryptedResults.zip'),
    );
    const beneficiaryKey = await readFile(
      join(
        process.cwd(),
        'test/inputs/beneficiaryKeys/unexpected_0x7bd4783FDCAD405A28052a0d1f11236A741da593_key',
      ),
    );
    const err = await utils
      .decryptResult(encZip, beneficiaryKey)
      .catch((e) => e);
    expect(err).toEqual(
      new Error('Failed to decrypt results key with beneficiary key'),
    );
  });
});

describe('[secrets]', () => {
  test('secrets.pushRequesterSecret()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    const pushRes = await iexec.secrets.pushRequesterSecret('foo', 'oops');
    expect(pushRes.isPushed).toBe(true);
    await expect(
      iexec.secrets.pushRequesterSecret('foo', 'oops'),
    ).rejects.toThrow(
      Error(`Secret "foo" already exists for ${randomWallet.address}`),
    );
    const pushForTeeFrameworkRes = await iexec.secrets.pushRequesterSecret(
      'foo',
      'oops',
      { teeFramework: TEE_FRAMEWORKS.GRAMINE },
    );
    expect(pushForTeeFrameworkRes.isPushed).toBe(true);
  });

  test('result.checkRequesterSecretExists()', async () => {
    const randomWallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainOpenethereumUrl,
      randomWallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        smsURL: smsMap,
      },
    );
    await expect(
      iexec.secrets.checkRequesterSecretExists(randomWallet.address, 'foo'),
    ).resolves.toBe(false);
    await iexec.secrets.pushRequesterSecret('foo', 'oops');
    await expect(
      iexec.secrets.checkRequesterSecretExists(randomWallet.address, 'foo'),
    ).resolves.toBe(true);
    await expect(
      iexec.secrets.checkRequesterSecretExists(randomWallet.address, 'foo', {
        teeFramework: TEE_FRAMEWORKS.GRAMINE,
      }),
    ).resolves.toBe(false);
  });
});

describe('[ens]', () => {
  test('resolve ens on iExec mainnet sidechain', async () => {
    const signer = utils.getSignerFromPrivateKey(
      bellecourHost,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec({
      ethProvider: signer,
    });
    const balance = await iexec.wallet.checkBalances('core.v5.iexec.eth');
    expect(balance.wei).toBeInstanceOf(BN);
    expect(balance.nRLC).toBeInstanceOf(BN);
  });

  test("resolve ens on custom chain wallet.checkBalances('admin.iexec.eth')", async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const balance = await iexec.wallet.checkBalances('admin.iexec.eth');
    expect(balance.wei).toBeInstanceOf(BN);
    expect(balance.nRLC).toBeInstanceOf(BN);
  });

  test('ens.getOwner(name) registered names resolves to address', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.ens.getOwner('admin.iexec.eth');
    expect(res).toBe(RICH_ADDRESS);
  });

  test('ens.getOwner(name) unregistered names resolves to address zero', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.ens.getOwner('unregistered.iexec.eth');
    expect(res).toBe(NULL_ADDRESS);
  });

  test('ens.resolveName(name) known names resolves to address', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.ens.resolveName('admin.iexec.eth');
    expect(res).toBe(RICH_ADDRESS);
  });

  test('ens.resoleName(name) unknown name resolves to null', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.ens.resolveName('unknown.eth');
    expect(res).toBe(null);
  });

  test('ens.lookupAddress(address) reverse resolution configured', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    const label = `ens-${getId()}`;
    const domain = 'users.iexec.eth';
    const name = `${label}.${domain}`;
    await iexec.ens.claimName(label, domain);
    await iexec.ens.configureResolution(name);
    const res = await iexec.ens.lookupAddress(name);
    expect(res).toBe(name);
  });

  test('ens.lookupAddress(address) no reverse resolution', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const res = await iexec.ens.lookupAddress(getRandomAddress());
    expect(res).toBe(null);
  });

  test('ens.getDefaultDomain(address)', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );
    const { address: appAddress } = await deployRandomApp(iexec);
    const { address: datasetAddress } = await deployRandomDataset(iexec);
    const { address: workerpoolAddress } = await deployRandomWorkerpool(iexec);
    const appDomain = await iexec.ens.getDefaultDomain(appAddress);
    expect(appDomain).toBe('apps.iexec.eth');
    const datasetDomain = await iexec.ens.getDefaultDomain(datasetAddress);
    expect(datasetDomain).toBe('datasets.iexec.eth');
    const workerpoolDomain = await iexec.ens.getDefaultDomain(
      workerpoolAddress,
    );
    expect(workerpoolDomain).toBe('pools.iexec.eth');
    const defaultDomain = await iexec.ens.getDefaultDomain(getRandomAddress());
    expect(defaultDomain).toBe('users.iexec.eth');
  });

  test('ens.claimName(label) available name', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = `wallet-${wallet.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    const res = await iexec.ens.claimName(label);

    expect(res.registerTxHash).toMatch(bytes32Regex);
    expect(res.name).toBe(name);

    const resClaimSame = await iexec.ens.claimName(label);
    expect(resClaimSame.registerTxHash).toBeUndefined();
    expect(resClaimSame.name).toBe(name);
  });

  test('ens.claimName(label, domain) available name on domain', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = `wallet-${wallet.address.toLowerCase()}`;
    const domain = 'iexec.eth';
    const name = `${label}.${domain}`;
    const res = await iexec.ens.claimName(label, domain);

    expect(res.registerTxHash).toMatch(bytes32Regex);
    expect(res.name).toBe(name);

    const resClaimSame = await iexec.ens.claimName(label, domain);
    expect(resClaimSame.registerTxHash).toBeUndefined();
    expect(resClaimSame.name).toBe(name);
  });

  test('ens.claimName(label, domain) name not available', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = 'users';
    const domain = 'iexec.eth';
    await expect(iexec.ens.claimName(label, domain)).rejects.toThrow(
      Error(
        'users.iexec.eth is already owned by 0xFA53ad31430e4f0A4E337A9d87c01d033683fCAF',
      ),
    );
  });

  test('ens.claimName(label, domain) no registrar', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = 'test';
    const domain = 'no-registrar.iexec.eth';
    await expect(iexec.ens.claimName(label, domain)).rejects.toThrow(
      Error(
        'The base domain no-registrar.iexec.eth owner 0x0000000000000000000000000000000000000000 is not a contract',
      ),
    );
  });

  test('ens.configureResolution(name) configure to self', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = `wallet-${wallet.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureRes = await iexec.ens.configureResolution(name);
    expect(configureRes.name).toBe(name);
    expect(configureRes.address).toBe(wallet.address);
    expect(configureRes.setAddrTxHash).toMatch(bytes32Regex);
    expect(configureRes.setNameTxHash).toMatch(bytes32Regex);
    expect(configureRes.setResolverTxHash).toMatch(bytes32Regex);

    const reconfigureSameRes = await iexec.ens.configureResolution(name);
    expect(reconfigureSameRes.name).toBe(name);
    expect(reconfigureSameRes.address).toBe(wallet.address);
    expect(reconfigureSameRes.setAddrTxHash).toBeUndefined();
    expect(reconfigureSameRes.setNameTxHash).toBeUndefined();
    expect(reconfigureSameRes.setResolverTxHash).toBeUndefined();
  });

  test('ens.configureResolution(name, address) configure for address', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const app1 = await deployRandomApp(iexec);

    const label = `address-${wallet.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureRes = await iexec.ens.configureResolution(
      name,
      app1.address,
    );
    expect(configureRes.name).toBe(name);
    expect(configureRes.address).toBe(app1.address);
    expect(configureRes.setAddrTxHash).toMatch(bytes32Regex);
    expect(configureRes.setNameTxHash).toMatch(bytes32Regex);
    expect(configureRes.setResolverTxHash).toMatch(bytes32Regex);

    const reconfigureSameRes = await iexec.ens.configureResolution(
      name,
      app1.address,
    );
    expect(reconfigureSameRes.name).toBe(name);
    expect(reconfigureSameRes.address).toBe(app1.address);
    expect(reconfigureSameRes.setAddrTxHash).toBeUndefined();
    expect(reconfigureSameRes.setNameTxHash).toBeUndefined();
    expect(reconfigureSameRes.setResolverTxHash).toBeUndefined();

    const app2 = await deployRandomApp(iexec);

    const reconfigureRes = await iexec.ens.configureResolution(
      name,
      app2.address,
    );
    expect(reconfigureRes.name).toBe(name);
    expect(reconfigureRes.address).toBe(app2.address);
    expect(reconfigureRes.setAddrTxHash).toMatch(bytes32Regex);
    expect(reconfigureRes.setNameTxHash).toMatch(bytes32Regex);
    expect(reconfigureRes.setResolverTxHash).toBeUndefined();
  });

  test('ens.configureResolution(name, address) throw with name not owned', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    await expect(
      iexec.ens.configureResolution('not-owned.eth', wallet.address),
    ).rejects.toThrow(
      Error(
        `The current address ${wallet.address} is not owner of not-owned.eth`,
      ),
    );
  });

  test('ens.configureResolution(name, address) throw with target app address not owned', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const app = await deployRandomApp(iexec, { owner: getRandomAddress() });
    const label = `address-${app.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    await expect(
      iexec.ens.configureResolution(name, app.address),
    ).rejects.toThrow(
      Error(
        `${RICH_ADDRESS} is not the owner of ${app.address}, impossible to setup ENS resolution`,
      ),
    );
  });

  test('ens.configureResolution(name, address) throw with other EOA', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const address = getRandomAddress();
    const label = `address-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    await expect(iexec.ens.configureResolution(name, address)).rejects.toThrow(
      Error(
        `Target address ${address} is not a contract and don't match current wallet address ${RICH_ADDRESS}, impossible to setup ENS resolution`,
      ),
    );
  });

  test('ens.obsConfigureResolution(name) configure to self', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = `wallet-${wallet.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureMessages = [];
    const reconfigureSameMessages = [];

    const configureObs = await iexec.ens.obsConfigureResolution(name);

    await new Promise((resolve, reject) => {
      configureObs.subscribe({
        error: reject,
        next: (data) => configureMessages.push(data),
        complete: resolve,
      });
    });

    await new Promise((resolve, reject) => {
      configureObs.subscribe({
        error: reject,
        next: (data) => reconfigureSameMessages.push(data),
        complete: resolve,
      });
    });

    expect(configureMessages.length).toBe(10);
    expect(reconfigureSameMessages.length).toBe(4);
  });

  test('ens.obsConfigureResolution(name, address) configure for address', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const app1 = await deployRandomApp(iexec);

    const app2 = await deployRandomApp(iexec);

    const label = `address-${wallet.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureMessages = [];
    const reconfigureMessages = [];
    const reconfigureSameMessages = [];

    const configureObs = await iexec.ens.obsConfigureResolution(
      name,
      app1.address,
    );

    const reconfigureObs = await iexec.ens.obsConfigureResolution(
      name,
      app2.address,
    );

    await new Promise((resolve, reject) => {
      configureObs.subscribe({
        error: reject,
        next: (data) => configureMessages.push(data),
        complete: resolve,
      });
    });

    await new Promise((resolve, reject) => {
      reconfigureObs.subscribe({
        error: reject,
        next: (data) => reconfigureMessages.push(data),
        complete: resolve,
      });
    });

    await new Promise((resolve, reject) => {
      reconfigureObs.subscribe({
        error: reject,
        next: (data) => reconfigureSameMessages.push(data),
        complete: resolve,
      });
    });
    expect(configureMessages.length).toBe(10);
    expect(reconfigureMessages.length).toBe(8);
    expect(reconfigureSameMessages.length).toBe(4);
  });

  test('ens.obsConfigureResolution(name, address) throw with name not owned', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const configureObs = await iexec.ens.obsConfigureResolution(
      'not-owned.eth',
      wallet.address,
    );

    const configureMessages = [];
    let error;
    let completed = false;

    await new Promise((resolve) => {
      configureObs.subscribe({
        error: (err) => {
          error = err;
          resolve();
        },
        next: (data) => configureMessages.push(data),
        complete: () => {
          completed = true;
          resolve();
        },
      });
    });

    expect(configureMessages.length).toBe(0);
    expect(completed).toBe(false);
    expect(error).toStrictEqual(
      Error(
        `The current address ${wallet.address} is not owner of not-owned.eth`,
      ),
    );
  });

  test('ens.obsConfigureResolution(name, address) throw with target app address not owned', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const app = await deployRandomApp(iexec, {
      owner: getRandomAddress(),
    });
    const label = `address-${app.address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureObs = await iexec.ens.obsConfigureResolution(
      name,
      app.address,
    );

    const configureMessages = [];
    let error;
    let completed = false;

    await new Promise((resolve) => {
      configureObs.subscribe({
        error: (err) => {
          error = err;
          resolve();
        },
        next: (data) => configureMessages.push(data),
        complete: () => {
          completed = true;
          resolve();
        },
      });
    });

    expect(configureMessages.length).toBe(0);
    expect(completed).toBe(false);
    expect(error).toStrictEqual(
      Error(
        `${RICH_ADDRESS} is not the owner of ${app.address}, impossible to setup ENS resolution`,
      ),
    );
  });

  test('ens.obsConfigureResolution(name, address) throw with other EOA', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const address = getRandomAddress();
    const label = `address-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);

    const configureObs = await iexec.ens.obsConfigureResolution(name, address);

    const configureMessages = [];
    let error;
    let completed = false;

    await new Promise((resolve) => {
      configureObs.subscribe({
        error: (err) => {
          error = err;
          resolve();
        },
        next: (data) => configureMessages.push(data),
        complete: () => {
          completed = true;
          resolve();
        },
      });
    });

    expect(configureMessages.length).toBe(0);
    expect(completed).toBe(false);
    expect(error).toStrictEqual(
      Error(
        `Target address ${address} is not a contract and don't match current wallet address ${RICH_ADDRESS}, impossible to setup ENS resolution`,
      ),
    );
  });

  test('ens.setTextRecord(name, key, value) throw with unconfigured resolver', async () => {
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    const name = `${getId()}.users.iexec.eth`;
    await expect(iexec.ens.setTextRecord(name, 'key', 'value')).rejects.toThrow(
      Error(`No resolver is configured for ${name}`),
    );
  });

  test('ens.setTextRecord(name, key, value) throw when the name is not owned', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = getId();
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);
    await iexec.ens.configureResolution(name);

    const randomWallet = getRandomWallet();
    const signerNotOwner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      randomWallet.privateKey,
    );
    const iexecNotOwner = new IExec(
      {
        ethProvider: signerNotOwner,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    await expect(
      iexecNotOwner.ens.setTextRecord(name, 'key', 'value'),
    ).rejects.toThrow(
      Error(
        `${randomWallet.address} is not authorised to set a text record for ${name}`,
      ),
    );
  });

  test('ens.setTextRecord(name, key, value)', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const { address } = await deployRandomWorkerpool(iexec);
    const label = `workerpool-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);
    await iexec.ens.configureResolution(name, address);

    const key = `key_${getId()}`;
    const value = `value_${getId()}`;
    const res = await iexec.ens.setTextRecord(name, key, value);
    expect(res).toMatch(bytes32Regex);
  });

  test('ens.setTextRecord(name, key)', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const { address } = await deployRandomWorkerpool(iexec);
    const label = `workerpool-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);
    await iexec.ens.configureResolution(name, address);

    const key = `key_${getId()}`;
    const res = await iexec.ens.setTextRecord(name, key);
    expect(res).toMatch(bytes32Regex);
  });

  test('ens.readTextRecord(name, key) throw with unconfigured resolver', async () => {
    const iexec = new IExec(
      {
        ethProvider: tokenChainInstamineUrl,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );
    const address = getRandomAddress();
    const label = `address-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    await expect(iexec.ens.readTextRecord(name, 'key')).rejects.toThrow(
      Error(`No resolver is configured for ${name}`),
    );
  });

  test('ens.readTextRecord(name, key) record not set', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const label = getId();
    const name = `${label}.users.iexec.eth`;
    await iexec.ens.claimName(label);
    await iexec.ens.configureResolution(name);
    const res = await iexec.ens.readTextRecord(name, 'key');
    expect(res).toBe('');
  });

  test('ens.readTextRecord(name, key)', async () => {
    const wallet = getRandomWallet();
    const signer = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      wallet.privateKey,
    );
    const iexec = new IExec(
      {
        ethProvider: signer,
      },
      {
        hubAddress,
        ensRegistryAddress,
        ensPublicResolverAddress,
      },
    );

    const richSigner = utils.getSignerFromPrivateKey(
      tokenChainInstamineUrl,
      RICH_PRIVATE_KEY,
    );
    const richIexec = new IExec(
      {
        ethProvider: richSigner,
      },
      {
        hubAddress,
      },
    );
    await richIexec.wallet.sendETH('0.1 ether', wallet.address);

    const { address } = await deployRandomWorkerpool(iexec);
    const label = `workerpool-${address.toLowerCase()}`;
    const name = `${label}.users.iexec.eth`;
    const key = `key_${getId()}`;
    const value = `value_${getId()}`;
    await iexec.ens.claimName(label);
    await iexec.ens.configureResolution(name, address);
    await iexec.ens.setTextRecord(name, key, value);
    const res = await iexec.ens.readTextRecord(name, key);
    expect(res).toBe(value);
  });
});

describe('[utils]', () => {
  describe('parseEth', () => {
    test("parseEth('4.2')", () => {
      const res = utils.parseEth('4.2');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000000000000'))).toBe(true);
    });

    test('parseEth(4.2)', () => {
      const res = utils.parseEth(4.2);
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000000000000'))).toBe(true);
    });

    test('parseEth(new BN(42))', () => {
      const res = utils.parseEth(new BN(42));
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('42000000000000000000'))).toBe(true);
    });

    test("parseEth('4.2 ether')", () => {
      const res = utils.parseEth('4.2 ether');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000000000000'))).toBe(true);
    });

    test("parseEth('4.2 gwei')", () => {
      const res = utils.parseEth('4.2 gwei');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000'))).toBe(true);
    });

    test("parseEth('4.2', 'gwei')", () => {
      const res = utils.parseEth('4.2', 'gwei');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000'))).toBe(true);
    });

    test("parseEth('4.2 foo')", () => {
      expect(() => utils.parseEth('4.2 foo')).toThrow(
        Error('Invalid ether unit'),
      );
    });

    test("parseEth('4.2 wei')", () => {
      expect(() => utils.parseEth('4.2 wei')).toThrow(
        Error('Invalid ether amount'),
      );
    });
  });

  describe('parseRLC', () => {
    test("parseRLC('4.2')", () => {
      const res = utils.parseRLC('4.2');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000'))).toBe(true);
    });

    test('parseRLC(4.2)', () => {
      const res = utils.parseRLC(4.2);
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000'))).toBe(true);
    });

    test('parseRLC(new BN(42))', () => {
      const res = utils.parseRLC(new BN(42));
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('42000000000'))).toBe(true);
    });

    test("parseRLC('4.2 RLC')", () => {
      const res = utils.parseRLC('4.2 RLC');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('4200000000'))).toBe(true);
    });

    test("parseRLC('42 nRLC')", () => {
      const res = utils.parseRLC('42 nRLC');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('42'))).toBe(true);
    });

    test("parseRLC('42', 'nRLC')", () => {
      const res = utils.parseRLC('42', 'nRLC');
      expect(res instanceof BN).toBe(true);
      expect(res.eq(new BN('42'))).toBe(true);
    });

    test("parseRLC('4.2 nRLC')", () => {
      expect(() => utils.parseRLC('4.2 nRLC')).toThrow(
        Error('Invalid token amount'),
      );
    });

    test("parseRLC('4.2 foo')", () => {
      expect(() => utils.parseRLC('4.2 foo')).toThrow(
        Error('Invalid token unit'),
      );
    });
  });

  describe('formatEth', () => {
    test("formatEth('4200000000000000000')", () => {
      const res = utils.formatEth('4200000000000000000');
      expect(res).toBe('4.2');
    });

    test('formatEth(42)', () => {
      const res = utils.formatEth(42);
      expect(res).toBe('0.000000000000000042');
    });

    test("formatEth(new BN('4200000000000000000'))", () => {
      const res = utils.formatEth(new BN('4200000000000000000'));
      expect(res).toBe('4.2');
    });
  });

  describe('formatRLC', () => {
    test("formatRLC('4200000000000000000')", () => {
      const res = utils.formatRLC('4200000000000000000');
      expect(res).toBe('4200000000.0');
    });

    test('formatRLC(42)', () => {
      const res = utils.formatRLC(42);
      expect(res).toBe('0.000000042');
    });

    test("formatRLC(new BN('4200000000000000000'))", () => {
      const res = utils.formatRLC(new BN('4200000000000000000'));
      expect(res).toBe('4200000000.0');
    });
  });

  describe('encodeTag', () => {
    test("encodeTag(['tee'])", () => {
      expect(utils.encodeTag(['tee'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      );
    });

    test("encodeTag(['scone'])", () => {
      expect(utils.encodeTag(['scone'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000002',
      );
    });

    test("encodeTag(['gramine'])", () => {
      expect(utils.encodeTag(['gramine'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000004',
      );
    });

    test("encodeTag(['gpu'])", () => {
      expect(utils.encodeTag(['gpu'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000100',
      );
    });

    test("encodeTag(['gpu','tee'])", () => {
      expect(utils.encodeTag(['gpu', 'tee'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000101',
      );
    });

    test("encodeTag(['gpu','tee','gpu','tee'])", () => {
      expect(utils.encodeTag(['gpu', 'tee', 'gpu', 'tee'])).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000101',
      );
    });

    test('encodeTag unknown tag', () => {
      expect(() => utils.encodeTag(['tee', 'foo'])).toThrow('Unknown tag foo');
    });
  });

  describe('decodeTag', () => {
    test("decodeTag('0x0000000000000000000000000000000000000000000000000000000000000003')", () => {
      expect(
        utils.decodeTag(
          '0x0000000000000000000000000000000000000000000000000000000000000003',
        ),
      ).toStrictEqual(['tee', 'scone']);
    });

    test('decodeTag unknown bit tag', () => {
      expect(() =>
        utils.decodeTag(
          '0x000000000000000000000000000000000000000000000000000000000000000a',
        ),
      ).toThrow(Error('Unknown bit 3 in tag'));
    });
  });

  describe('sumTags', () => {
    test('sumTags from Bytes32', () => {
      expect(
        utils.sumTags([
          '0x0000000000000000000000000000000000000000000000000000000000000100',
          '0x0000000000000000000000000000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        ]),
      ).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000101',
      );
    });

    test('sumTags unknown bit tag', () => {
      expect(
        utils.sumTags([
          '0x0000000000000000000000000000000000000000000000000000000000000101',
          '0x0000000000000000000000000000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
        ]),
      ).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000103',
      );
    });

    test('sumTags invalid bytes32', () => {
      expect(() =>
        utils.sumTags([
          '0x000000000000000000000000000000000000000000000000000000000000000z',
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        ]),
      ).toThrow('tag must be bytes32 hex string');
    });
  });
});
