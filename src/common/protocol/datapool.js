import Debug from 'debug';
import {
  bigIntToBn,
  getEventFromLogs,
  checkSigner,
} from '../utils/utils.js';
import {
  deployDatapool,
  showDatapool,
} from './registries.js';
import {
  uint256Schema,
  throwIfMissing,
  addressSchema,
  bytes32Schema,
  datapoolSchema,
  signedApporderSchema,
  signedWorkerpoolorderSchema,
  signedRequestorderSchema,
} from '../utils/validator.js';
import { wrapCall, wrapSend, wrapWait } from '../utils/errorWrappers.js';
import {
  DATAPOOL_IMPLEMENTATION,
} from '../utils/constant.js';

const debug = Debug('iexec:protocol:datapool');

const datapoolFactoryFunctions = {
  [DATAPOOL_IMPLEMENTATION.OPEN]: (iexecContract, args, opts) => iexecContract.deployOpenDatapool(...args, opts),
  [DATAPOOL_IMPLEMENTATION.WAITINGLIST]: (iexecContract, args, opts) => iexecContract.deployWaitingListDatapool(...args, opts),
  [DATAPOOL_IMPLEMENTATION.WHITELIST]: (iexecContract, args, opts) => iexecContract.deployWhitelistedDatapool(...args, opts),
};

export const createDatapool = async (
  contracts = throwIfMissing(),
  obj = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);
    const vDatapool = await datapoolSchema().validate(obj);
    const iexecContract = contracts.getIExecContract();

    const implementationExists = Object.values(DATAPOOL_IMPLEMENTATION).includes(vDatapool.implementation);
      
      if(!implementationExists){
        throw Error(
          `Implementation ${vDatapool.implementation} does not exist, no contract to deploy.`,
        );
      }

    const args = [
      vDatapool.datapoolOwnerPrice,
      vDatapool.datasetPrice,
      vDatapool.allowedApps,
      vDatapool.allowedWorkerpools,
    ];

    if(vDatapool.implementation === DATAPOOL_IMPLEMENTATION.WHITELIST){
      args.push(vDatapool.whitelist);
    }
    
    const tx = await wrapSend(
      datapoolFactoryFunctions[vDatapool.implementation](iexecContract, args, contracts.txOptions),
    );
    const txReceipt = await wrapWait(tx.wait(contracts.confirms));
    const logs = getEventFromLogs(
      'DatapoolContractDeployed',
      txReceipt.logs,
      {
        strict: true,
      },
    ).args;

    const datapoolAddress = logs.contractAddress;

    const datapoolNft = {
      owner: datapoolAddress,
      name: vDatapool.implementation,
      multiaddr: datapoolAddress,
      checksum:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
    };

    const { address: datapoolNftAddress } = await deployDatapool(
      contracts,
      datapoolNft,
    );

    await initDatapool(
      contracts,
      datapoolNftAddress,
    );

    return { datapoolAddress, datapoolNftAddress, txHash: tx.hash };
  } catch (error) {
    debug('createDatapool()', error);
    throw error;
  }
};

const initDatapool = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const vDatapoolAddressInRegistry = await addressSchema().validate(datapoolNftAddress);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);

    const tx = await wrapCall(
      datapoolContract.initialize(vDatapoolAddressInRegistry),
    );

    const txReceipt = await wrapWait(tx.wait(contracts.confirms));
    const logs = getEventFromLogs(
      'DatapoolInitialized',
      txReceipt.logs,
      {
        strict: true,
      },
    ).args;
    const datapoolAddressInRegistry = logs.datapoolAddressInRegistry;

    const txHash = tx.hash;
    return { datapoolAddressInRegistry, txHash };
  } catch (error) {
    debug('initDatapool()', error);
    throw error;
  }
};

export const showDatapoolState = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const rawDatapoolState = await wrapCall(datapoolContract.showDatapool());

    const allowedAppCountDisplay = bigIntToBn(rawDatapoolState.allowedAppCount).isZero()
    ? "infinite"
    : bigIntToBn(rawDatapoolState.allowedAppCount).toString();

    const allowedWorkerpoolCountDisplay = bigIntToBn(rawDatapoolState.allowedWorkerpoolCount).isZero()
    ? "infinite"
    : bigIntToBn(rawDatapoolState.allowedWorkerpoolCount).toString();

    const formattedDatasets = rawDatapoolState.datasets.map(
      ({ dataset, isActive }) => `${dataset}: ${isActive ? 'active' : 'inactive'}`
    );
    
    const datapoolState = {
      implementation: datapoolNft.datasetName,
      datapoolOwner: rawDatapoolState.datapoolOwner,
      activeDatasetCount:  bigIntToBn(rawDatapoolState.activeDatasetCount).toString(),
      ...(datapoolNft.datasetName === DATAPOOL_IMPLEMENTATION.WHITELIST && { whitelistedDatasetCount: bigIntToBn(await wrapCall(datapoolContract.whitelistCount())).toString() }),
      minimalDatapoolOwnerPrice: bigIntToBn(rawDatapoolState.minimalDatapoolOwnerPrice).toString(),
      minimalDatasetPrice:  bigIntToBn(rawDatapoolState.minimalDatasetPrice).toString(),
      currentDatapoolOwnerPrice: bigIntToBn(rawDatapoolState.currentDatapoolOwnerPrice).toString(),
      currentDatasetPrice:  bigIntToBn(rawDatapoolState.currentDatasetPrice).toString(),
      allowedAppCount: allowedAppCountDisplay,
      allowedWorkerpoolCount: allowedWorkerpoolCountDisplay,
      datasets:  formattedDatasets,
    }

    return { datapoolContractAddress: vDatapoolAddress, datapoolState: datapoolState };
  } catch (error) {
    debug('showDatapoolState()', error);
    throw error;
  }
};

export const addDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);

    if(datapoolNft.datasetName === DATAPOOL_IMPLEMENTATION.WHITELIST){
      const { whitelistedDataset } = await isWhitelistedDataset(contracts, datapoolNftAddress, datasetAddress);
      if (!whitelistedDataset){
        throw Error(
          `This dataset is not whitelisted.`
        );
      }
    }
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.addDataset(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;

    const isWaitingList = datapoolNft.datasetName !== DATAPOOL_IMPLEMENTATION.WAITINGLIST;

    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash, isWaitingList };
  } catch (error) {
    debug('addDataset()', error);
    throw error;
  }
};

export const approveRequestToAddDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WAITINGLIST);
    
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.approveRequestToAddDataset(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;


    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('approveRequestToAddDataset()', error);
    throw error;
  }
};

export const declineRequestToAddDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WAITINGLIST);
    
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.declineRequestToAddDataset(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;


    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('declineRequestToAddDataset()', error);
    throw error;
  }
};

export const isDatasetInWaitingList = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WAITINGLIST);

    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const waitingDataset = await wrapCall(
      datapoolContract.waitingList(vDatasetAddress),
    );

    return { datapoolContractAddress: vDatapoolAddress, datapoolContractAddress: vDatapoolAddress, waitingDataset };
  } catch (error) {
    debug('isDatasetInWaitingList()', error);
    throw error;
  }
};

export const addDatasetToWhitelist = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WHITELIST);
    
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.addDatasetToWhitelist(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;


    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('addDatasetToWhitelist()', error);
    throw error;
  }
};

export const removeDatasetFromWhitelist = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WHITELIST);
    
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.removeDatasetFromWhitelist(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;


    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('removeDatasetFromWhitelist()', error);
    throw error;
  }
};

export const isWhitelistedDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    checkImplementation(datapoolNft.datasetName, DATAPOOL_IMPLEMENTATION.WHITELIST);

    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const whitelistedDataset = await wrapCall(
      datapoolContract.isWhitelisted(vDatasetAddress),
    );

    return { datapoolContractAddress: vDatapoolAddress, datapoolContractAddress: vDatapoolAddress, whitelistedDataset };
  } catch (error) {
    debug('isWhitelistedDataset()', error);
    throw error;
  }
};

export const removeDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);


    const tx = await wrapSend(datapoolContract.removeDataset(vDatasetAddress));
    const txReceipt = await wrapWait(tx.wait(contracts.confirms));
    const { dataset } = getEventFromLogs(
      'DatasetRemoved',
      txReceipt.logs,
      {
        strict: true,
      },
    ).args;
    const txHash = tx.hash;


    return { dataset, txHash };
  } catch (error) {
    debug('removeDataset()', error);
    throw error;
  }
};

export const withdrawTaskReward = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
  taskid = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);
    const vTaskid = await bytes32Schema().validate(taskid);

    const tx = await wrapSend(datapoolContract.withdrawTaskReward(vTaskid, vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;

    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, taskid: vTaskid, txHash };
  } catch (error) {
    debug('withdrawTaskReward()', error);
    throw error;
  }
};

export const withdrawAllTasksRewards = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const tx = await wrapSend(datapoolContract.withdrawAllTasksRewards(vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;

    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('withdrawAllTasksRewards()', error);
    throw error;
  }
};

export const isAppAllowed = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  app = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vApp = await addressSchema().validate(app);

    const rawDatapoolState = await wrapCall(datapoolContract.showDatapool());

    let appAllowed = bigIntToBn(rawDatapoolState.allowedAppCount).isZero();

    if (!appAllowed){
      appAllowed = await wrapCall(
        datapoolContract.allowedApps(vApp),
      );
    }
    return { datapoolContractAddress: vDatapoolAddress, appAllowed };

  } catch (error) {
    debug('isAppAllowed()', error);
    throw error;
  }
};

export const addAllowedApp = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  app = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    
    const vApp = await addressSchema().validate(app);

    const tx = await wrapCall(
      datapoolContract.addAllowedApp(vApp),
    );
    await wrapWait(tx.wait(contracts.confirms));

    const txHash = tx.hash;
    return { datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('addAllowedApp()', error);
    throw error;
  }
};

export const isWorkerpoolAllowed = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  workerpool = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vWorkerpool = await addressSchema().validate(workerpool);

    const rawDatapoolState = await wrapCall(datapoolContract.showDatapool());

    let workerpoolAllowed = bigIntToBn(rawDatapoolState.allowedWorkerpoolCount).isZero();

    if (!workerpoolAllowed){
      workerpoolAllowed = await wrapCall(
        datapoolContract.allowedWorkerpools(vWorkerpool),
      );
    }
    
    return { datapoolContractAddress: vDatapoolAddress, workerpoolAllowed };

  } catch (error) {
    debug('isWorkerpoolAllowed()', error);
    throw error;
  }
};

export const addAllowedWorkerpool = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  workerpool = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vWorkerpool = await addressSchema().validate(workerpool);

    const tx = await wrapCall(
      datapoolContract.addAllowedWorkerpool(vWorkerpool),
    );
    await wrapWait(tx.wait(contracts.confirms));

    const txHash = tx.hash;
    return { datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('addAllowedWorkerpool()', error);
    throw error;
  }
};

export const setDatapoolOwnerPrice = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datapoolOwnerPrice = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatapoolOwnerPrice = await uint256Schema().validate(datapoolOwnerPrice);

    const tx = await wrapCall(
      datapoolContract.setDatapoolOwnerPrice(vDatapoolOwnerPrice),
    );
    await wrapWait(tx.wait(contracts.confirms));

    const txHash = tx.hash;
    return { datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('setDatapoolOwnerPrice()', error);
    throw error;
  }
};

export const setDatasetPrice = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetPrice = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetPrice = await uint256Schema().validate(datasetPrice);

    const tx = await wrapCall(
      datapoolContract.setDatasetPrice(vDatasetPrice),
    );
    await wrapWait(tx.wait(contracts.confirms));

    const txHash = tx.hash;
    return { datapoolContractAddress: vDatapoolAddress, txHash };
  } catch (error) {
    debug('setDatasetPrice()', error);
    throw error;
  }
};

export const isActiveDataset = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);

    const activeDataset = await wrapCall(
      datapoolContract.isActiveDataset(vDatasetAddress),
    );

    return { datapoolContractAddress: vDatapoolAddress, activeDataset };
  } catch (error) {
    debug('isActiveDataset()', error);
    throw error;
  }
};

export const getActiveDatasetsInDatapoolForTask = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  taskid = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vTaskid = await bytes32Schema().validate(taskid);

    const activeDatasets = await wrapCall(
      datapoolContract.getActiveDatasetsForTask(vTaskid),
    );

    return { datapoolContractAddress: vDatapoolAddress, activeDatasets };
  } catch (error) {
    debug('getActiveDatasetsInDatapoolForTask()', error);
    throw error;
  }
};

export const createDatapoolTask = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  appOrder = throwIfMissing(),
  workerpoolOrder = throwIfMissing(),
  requestOrder = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);

    const [vAppOrder, vWorkerpoolOrder, vRequestOrder] =
      await Promise.all([
        signedApporderSchema().validate(appOrder),
        signedWorkerpoolorderSchema().validate(workerpoolOrder),
        signedRequestorderSchema().validate(requestOrder),
      ]);

      
    const tx = await wrapSend(
      datapoolContract.createTask(vAppOrder, vWorkerpoolOrder, vRequestOrder),
    );
    const txReceipt = await wrapWait(tx.wait(contracts.confirms));
    const logs = getEventFromLogs(
      'DatapoolTaskCreated',
      txReceipt.logs,
      {
        strict: true,
      },
    ).args;
    const taskid = logs.taskid;

    return { datapoolContractAddress: vDatapoolAddress, taskid };
  } catch (error) {
    debug('createTask()', error);
    throw error;
  }
};

const showDatapoolNft = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
) => {
  try {
    const {dataset: datapoolNft} = await showDatapool(contracts, datapoolNftAddress);

    return datapoolNft;
  } catch (error) {
    debug('showDatapoolNft()', error);
    throw error;
  }
};
function checkImplementation(implementation, obj) {
  if (implementation !== obj) {
    throw Error(
      `This function is only for ${obj} contracts.`
    );
  }
}

