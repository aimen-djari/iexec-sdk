const Debug = require('debug');
const BN = require('bn.js');
const {
  isBytes32,
  checkEvent,
  getEventFromLogs,
  ethersBnToBn,
  http,
  getSalt,
  checksummedAddress,
  getAuthorization,
  NULL_ADDRESS,
  NULL_BYTES32,
  ensureString,
  signTypedDatav3,
} = require('./utils');
const { throwIfMissing } = require('./utils');
const { hashEIP712 } = require('./sig-utils');

const debug = Debug('iexec:order');

const APP_ORDER = 'apporder';
const DATASET_ORDER = 'datasetorder';
const WORKERPOOL_ORDER = 'workerpoolorder';
const REQUEST_ORDER = 'requestorder';

const ORDERS_TYPES = [
  APP_ORDER,
  DATASET_ORDER,
  WORKERPOOL_ORDER,
  REQUEST_ORDER,
];

const checkOrderName = (orderName) => {
  if (!ORDERS_TYPES.includes(orderName)) throw Error(`Invalid orderName value ${orderName}`);
};

const NULL_DATASETORDER = {
  dataset: NULL_ADDRESS,
  datasetprice: 0,
  volume: 0,
  tag: NULL_BYTES32,
  apprestrict: NULL_ADDRESS,
  workerpoolrestrict: NULL_ADDRESS,
  requesterrestrict: NULL_ADDRESS,
  salt: NULL_BYTES32,
  sign: '0x',
};

const objDesc = {
  EIP712Domain: {
    primaryType: 'EIP712Domain',
    structMembers: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
  },
  [APP_ORDER]: {
    primaryType: 'AppOrder',
    structMembers: [
      { name: 'app', type: 'address' },
      { name: 'appprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'datasetrestrict', type: 'address' },
      { name: 'workerpoolrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    contractPropName: 'app',
    contractName: 'app',
    cancelMethode: 'cancelAppOrder',
    cancelEvent: 'ClosedAppOrder',
    apiEndpoint: 'apporders',
    dealField: 'appHash',
  },
  [DATASET_ORDER]: {
    primaryType: 'DatasetOrder',
    structMembers: [
      { name: 'dataset', type: 'address' },
      { name: 'datasetprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'apprestrict', type: 'address' },
      { name: 'workerpoolrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    contractPropName: 'dataset',
    contractName: 'dataset',
    cancelMethode: 'cancelDatasetOrder',
    cancelEvent: 'ClosedDatasetOrder',
    apiEndpoint: 'datasetorders',
    dealField: 'datasetHash',
  },
  [WORKERPOOL_ORDER]: {
    primaryType: 'WorkerpoolOrder',
    structMembers: [
      { name: 'workerpool', type: 'address' },
      { name: 'workerpoolprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'category', type: 'uint256' },
      { name: 'trust', type: 'uint256' },
      { name: 'apprestrict', type: 'address' },
      { name: 'datasetrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    contractPropName: 'workerpool',
    contractName: 'workerpool',
    cancelMethode: 'cancelWorkerpoolOrder',
    cancelEvent: 'ClosedWorkerpoolOrder',
    apiEndpoint: 'workerpoolorders',
    dealField: 'workerpoolHash',
  },
  [REQUEST_ORDER]: {
    primaryType: 'RequestOrder',
    structMembers: [
      { name: 'app', type: 'address' },
      { name: 'appmaxprice', type: 'uint256' },
      { name: 'dataset', type: 'address' },
      { name: 'datasetmaxprice', type: 'uint256' },
      { name: 'workerpool', type: 'address' },
      { name: 'workerpoolmaxprice', type: 'uint256' },
      { name: 'requester', type: 'address' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'category', type: 'uint256' },
      { name: 'trust', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'callback', type: 'address' },
      { name: 'params', type: 'string' },
      { name: 'salt', type: 'bytes32' },
    ],
    cancelMethode: 'cancelRequestOrder',
    cancelEvent: 'ClosedRequestOrder',
    apiEndpoint: 'requestorders',
    dealField: 'requestHash',
  },
};

const objToStructArray = (objName, obj) => {
  const reducer = (total, current) => total.concat([obj[current.name]]);
  const struct = objDesc[objName].structMembers.reduce(reducer, []);
  return struct;
};

const signedOrderToStruct = (orderName, orderObj) => {
  const unsigned = objToStructArray(orderName, orderObj);
  const signed = unsigned.concat([orderObj.sign]);
  return signed;
};

const getEIP712Domain = (chainId, verifyingContract) => ({
  name: 'iExecODB',
  version: '3.0-alpha',
  chainId,
  verifyingContract,
});

const getContractOwner = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  orderObj = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    if (orderName === REQUEST_ORDER) throw Error('Invalid orderName');
    const contractAddress = orderObj[objDesc[orderName].contractPropName];
    const contract = contracts.getContract(objDesc[orderName].contractName)({
      at: contractAddress,
    });
    const owner = checksummedAddress(await contract.owner());
    return owner;
  } catch (error) {
    debug('getContractOwner()', error);
    throw error;
  }
};

const computeOrderHash = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  order = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);

    const clerkAddress = await contracts.fetchClerkAddress();
    const domainObj = getEIP712Domain(contracts.chainId, clerkAddress);

    const types = {};
    types.EIP712Domain = objDesc.EIP712Domain.structMembers;
    types[objDesc[orderName].primaryType] = objDesc[orderName].structMembers;

    const typedData = {
      types,
      domain: domainObj,
      primaryType: objDesc[orderName].primaryType,
      message: order,
    };
    return hashEIP712(typedData);
  } catch (error) {
    debug('computeOrderHash()', error);
    throw error;
  }
};

const getRemainingVolume = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  order = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    const initial = new BN(order.volume);
    const orderHash = await computeOrderHash(contracts, orderName, order);
    const clerkAddress = await contracts.fetchClerkAddress();
    const clerkContract = contracts.getClerkContract({
      at: clerkAddress,
    });
    const cons = await clerkContract.viewConsumed(orderHash);
    const consumed = ethersBnToBn(cons);
    const remain = initial.sub(consumed);
    return remain;
  } catch (error) {
    debug('getRemainingVolume()', error);
    throw error;
  }
};

const signOrder = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  orderObj = throwIfMissing(),
  address = throwIfMissing(),
) => {
  checkOrderName(orderName);
  const signerAddress = orderName === REQUEST_ORDER
    ? orderObj.requester
    : await getContractOwner(contracts, orderName, orderObj);
  if (signerAddress.toLowerCase() !== address.toLowerCase()) {
    throw Error(
      `Invalid order signer, must be the ${
        orderName === REQUEST_ORDER ? 'requester' : 'resource owner'
      }`,
    );
  }

  const clerkAddress = await contracts.fetchClerkAddress();
  const domainObj = getEIP712Domain(contracts.chainId, clerkAddress);

  const salt = getSalt();
  const saltedOrderObj = Object.assign(orderObj, { salt });

  const order = objDesc[orderName].structMembers;

  const types = {};
  types.EIP712Domain = objDesc.EIP712Domain.structMembers;
  types[objDesc[orderName].primaryType] = order;

  const message = orderObj;

  const typedData = {
    types,
    domain: domainObj,
    primaryType: objDesc[orderName].primaryType,
    message,
  };

  const sign = await signTypedDatav3(contracts.ethProvider, address, typedData);
  const signedOrder = Object.assign(saltedOrderObj, { sign });
  return signedOrder;
};

const signApporder = async (
  contracts = throwIfMissing(),
  apporder = throwIfMissing(),
  signerAddress = throwIfMissing(),
) => signOrder(contracts, APP_ORDER, apporder, signerAddress);

const signDatasetorder = async (
  contracts = throwIfMissing(),
  datasetorder = throwIfMissing(),
  signerAddress = throwIfMissing(),
) => signOrder(contracts, DATASET_ORDER, datasetorder, signerAddress);

const signWorkerpoolorder = async (
  contracts = throwIfMissing(),
  workerpoolorder = throwIfMissing(),
  signerAddress = throwIfMissing(),
) => signOrder(contracts, WORKERPOOL_ORDER, workerpoolorder, signerAddress);

const signRequestorder = async (
  contracts = throwIfMissing(),
  requestorder = throwIfMissing(),
  signerAddress = throwIfMissing(),
) => signOrder(contracts, REQUEST_ORDER, requestorder, signerAddress);

const cancelOrder = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  orderObj = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    const args = signedOrderToStruct(orderName, orderObj);
    const clerkAddress = await contracts.fetchClerkAddress();
    const clerkContact = contracts.getClerkContract({ at: clerkAddress });
    const tx = await clerkContact[objDesc[orderName].cancelMethode](args);
    const txReceipt = await tx.wait();
    if (!checkEvent(objDesc[orderName].cancelEvent, txReceipt.events)) throw Error(`${objDesc[orderName].cancelEvent} not confirmed`);
    return true;
  } catch (error) {
    debug('cancelOrder()', error);
    throw error;
  }
};

const cancelApporder = async (
  contracts = throwIfMissing(),
  apporder = throwIfMissing(),
) => cancelOrder(contracts, APP_ORDER, apporder);

const cancelDatasetorder = async (
  contracts = throwIfMissing(),
  datasetorder = throwIfMissing(),
) => cancelOrder(contracts, DATASET_ORDER, datasetorder);

const cancelWorkerpoolorder = async (
  contracts = throwIfMissing(),
  workerpoolorder = throwIfMissing(),
) => cancelOrder(contracts, WORKERPOOL_ORDER, workerpoolorder);

const cancelRequestorder = async (
  contracts = throwIfMissing(),
  requestorder = throwIfMissing(),
) => cancelOrder(contracts, REQUEST_ORDER, requestorder);

const publishOrder = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  chainId = throwIfMissing(),
  signedOrder = throwIfMissing(),
  address = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    const endpoint = objDesc[orderName].apiEndpoint.concat('/publish');
    const body = { chainId: ensureString(chainId), order: signedOrder };
    const authorization = await getAuthorization(
      chainId,
      address,
      contracts.ethProvider,
    );
    const response = await http.post(endpoint, body, { authorization });
    if (response.ok && response.saved && response.saved.orderHash) {
      return response.saved.orderHash;
    }
    throw new Error('An error occured while publishing order');
  } catch (error) {
    debug('publishOrder()', error);
    throw error;
  }
};

const unpublishOrder = async (
  contracts = throwIfMissing(),
  orderName = throwIfMissing(),
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
  address = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    const endpoint = objDesc[orderName].apiEndpoint.concat('/unpublish');
    const body = { chainId: ensureString(chainId), orderHash };
    const authorization = await getAuthorization(
      chainId,
      address,
      contracts.ethProvider,
    );
    const response = await http.post(endpoint, body, { authorization });
    if (response.ok && response.unpublished) {
      return response.unpublished;
    }
    throw new Error('An error occured while unpublishing order');
  } catch (error) {
    debug('publishOrder()', error);
    throw error;
  }
};

const fetchPublishedOrderByHash = async (
  orderName = throwIfMissing(),
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    isBytes32(orderHash);
    const endpoint = objDesc[orderName].apiEndpoint;
    if (!endpoint) throw Error(`Unsuported orderName ${orderName}`);
    const body = {
      chainId: ensureString(chainId),
      sort: {
        publicationTimestamp: -1,
      },
      limit: 1,
      find: { orderHash },
    };
    const response = await http.post(endpoint, body);
    if (response.ok && response.orders) {
      return response.orders[0] || null;
    }
    throw Error('An error occured while getting order');
  } catch (error) {
    debug('fetchPublishedOrderByHash()', error);
    throw error;
  }
};

const fetchDealsByOrderHash = async (
  orderName = throwIfMissing(),
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
) => {
  try {
    checkOrderName(orderName);
    isBytes32(orderHash);
    const hashFiedName = objDesc[orderName].dealField;
    const endpoint = 'deals';
    const body = {
      chainId: ensureString(chainId),
      sort: {
        publicationTimestamp: -1,
      },
      limit: 1,
      find: { [hashFiedName]: orderHash },
    };
    const response = await http.post(endpoint, body);
    if (response.ok && response.deals) {
      return { count: response.count, deals: response.deals };
    }
    throw Error('An error occured while getting deals');
  } catch (error) {
    debug('fetchDealsByOrderHash()', error);
    throw error;
  }
};

const matchOrders = async (
  contracts = throwIfMissing(),
  appOrder = throwIfMissing(),
  datasetOrder = NULL_DATASETORDER,
  workerpoolOrder = throwIfMissing(),
  requestOrder = throwIfMissing(),
) => {
  try {
    const appOrderStruct = signedOrderToStruct(APP_ORDER, appOrder);
    const datasetOrderStruct = signedOrderToStruct(DATASET_ORDER, datasetOrder);
    const workerpoolOrderStruct = signedOrderToStruct(
      WORKERPOOL_ORDER,
      workerpoolOrder,
    );
    const requestOrderStruct = signedOrderToStruct(REQUEST_ORDER, requestOrder);

    const clerkAddress = await contracts.fetchClerkAddress();
    const clerkContract = contracts.getClerkContract({ at: clerkAddress });
    const tx = await clerkContract.matchOrders(
      appOrderStruct,
      datasetOrderStruct,
      workerpoolOrderStruct,
      requestOrderStruct,
    );
    const txReceipt = await tx.wait();
    const matchEvent = 'OrdersMatched';
    if (!checkEvent(matchEvent, txReceipt.events)) throw Error(`${matchEvent} not confirmed`);
    const { dealid, volume } = getEventFromLogs(
      matchEvent,
      txReceipt.events,
    ).args;
    return { dealid, volume: ethersBnToBn(volume) };
  } catch (error) {
    debug('matchOrders() error', error);
    throw error;
  }
};

const createApporder = ({
  app = throwIfMissing(),
  appprice = throwIfMissing(),
  volume = throwIfMissing(),
  tag = NULL_BYTES32,
  datasetrestrict = NULL_ADDRESS,
  workerpoolrestrict = NULL_ADDRESS,
  requesterrestrict = NULL_ADDRESS,
} = {}) => ({
  app,
  appprice,
  volume,
  tag,
  datasetrestrict,
  workerpoolrestrict,
  requesterrestrict,
});

const createDatasetorder = ({
  dataset = throwIfMissing(),
  datasetprice = throwIfMissing(),
  volume = throwIfMissing(),
  tag = NULL_BYTES32,
  apprestrict = NULL_ADDRESS,
  workerpoolrestrict = NULL_ADDRESS,
  requesterrestrict = NULL_ADDRESS,
} = {}) => ({
  dataset,
  datasetprice,
  volume,
  tag,
  apprestrict,
  workerpoolrestrict,
  requesterrestrict,
});

const createWorkerpoolorder = ({
  workerpool = throwIfMissing(),
  workerpoolprice = throwIfMissing(),
  volume = throwIfMissing(),
  category = throwIfMissing(),
  trust = '0',
  tag = NULL_BYTES32,
  apprestrict = NULL_ADDRESS,
  datasetrestrict = NULL_ADDRESS,
  requesterrestrict = NULL_ADDRESS,
} = {}) => ({
  workerpool,
  workerpoolprice,
  volume,
  category,
  trust,
  tag,
  apprestrict,
  datasetrestrict,
  requesterrestrict,
});

const createRequestorder = ({
  app = throwIfMissing(),
  appmaxprice = throwIfMissing(),
  workerpoolmaxprice = throwIfMissing(),
  requester = throwIfMissing(),
  volume = throwIfMissing(),
  category = throwIfMissing(),
  workerpool = NULL_ADDRESS,
  dataset = NULL_ADDRESS,
  datasetmaxprice = '0',
  beneficiary,
  params = '',
  callback = NULL_ADDRESS,
  trust = '0',
  tag = NULL_BYTES32,
} = {}) => ({
  app,
  appmaxprice,
  dataset,
  datasetmaxprice,
  workerpool,
  workerpoolmaxprice,
  requester,
  beneficiary: beneficiary || requester,
  volume,
  params,
  callback,
  category,
  trust,
  tag,
});

module.exports = {
  computeOrderHash,
  getContractOwner,
  getRemainingVolume,
  createApporder,
  createDatasetorder,
  createWorkerpoolorder,
  createRequestorder,
  signApporder,
  signDatasetorder,
  signWorkerpoolorder,
  signRequestorder,
  signOrder, // deprecated
  cancelApporder,
  cancelDatasetorder,
  cancelWorkerpoolorder,
  cancelRequestorder,
  cancelOrder, // deprecated
  publishOrder,
  unpublishOrder,
  matchOrders,
  fetchPublishedOrderByHash,
  fetchDealsByOrderHash,
  APP_ORDER,
  DATASET_ORDER,
  WORKERPOOL_ORDER,
  REQUEST_ORDER,
  NULL_DATASETORDER,
};
