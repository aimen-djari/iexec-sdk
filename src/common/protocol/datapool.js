import Debug from 'debug';
import {
  bigIntToBn,
  getEventFromLogs,
  checkSigner,
} from '../utils/utils.js';
import {
  deployDataset,
  showDataset,
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
import { dataset } from '../../cli/utils/templates.js';

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
        '0x36b5d1729e99a9beaeec4bd1eac62b8ed6306bfa7b7c06cf91f64a65a0ca5b87',
    };

    const { address: datapoolNftAddress } = await deployDataset(
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

    const allowedAppCountDisplay = bigIntToBn(rawDatapoolState.allowedAppsCount).isZero()
    ? "infinite"
    : bigIntToBn(rawDatapoolState.allowedAppsCount).toString();

    const allowedWorkerpoolCountDisplay = bigIntToBn(rawDatapoolState.allowedWorkerpoolsCount).isZero()
    ? "infinite"
    : bigIntToBn(rawDatapoolState.allowedWorkerpoolsCount).toString();

    const formattedDatasets = rawDatapoolState.datasets.map(
      ({ dataset, isActive }) => `${dataset}: ${isActive ? 'active' : 'inactive'}`
    );
    
    const datapoolState = {
      implementation: datapoolNft.datasetName,
      datapoolOwner: rawDatapoolState.owner,
      version: {
        id: bigIntToBn(rawDatapoolState.version).toString(),
        timestamp: bigIntToBn(rawDatapoolState.versionTimestamp).toString(),
        datasetCount: bigIntToBn(rawDatapoolState.versionDatasetCount).toString(),
      },
      activeDatasetCount:  bigIntToBn(rawDatapoolState.currentDatasetCount).toString(),
      ...(datapoolNft.datasetName === DATAPOOL_IMPLEMENTATION.WHITELIST && { whitelistedDatasetCount: bigIntToBn(await wrapCall(datapoolContract.whitelistCount())).toString() }),
      pricingPolicy: {
        minimalDatapoolOwnerPrice: bigIntToBn(rawDatapoolState.minimalDatapoolOwnerPrice).toString(),
        minimalDatasetPrice:  bigIntToBn(rawDatapoolState.minimalDatasetPrice).toString(),
        currentDatapoolOwnerPrice: bigIntToBn(rawDatapoolState.currentDatapoolOwnerPrice).toString(),
        currentDatasetPrice:  bigIntToBn(rawDatapoolState.currentDatasetPrice).toString(),
      },
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

    let appAllowed = bigIntToBn(rawDatapoolState.allowedAppsCount).isZero();

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

    let workerpoolAllowed = bigIntToBn(rawDatapoolState.allowedWorkerpoolsCount).isZero();

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

export const createDatapoolOrder = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  app = throwIfMissing(),
  workerpool = throwIfMissing(),
  volume = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);

    const [vApp, vWorkerpool, vVolume] =
      await Promise.all([
        addressSchema().validate(app),
        addressSchema().validate(workerpool),
        uint256Schema().validate(volume),
      ]);

      
    const tx = await wrapSend(
      datapoolContract.createSignedDatapoolOrder(vApp, vWorkerpool, vVolume),
    );
    const txReceipt = await wrapWait(tx.wait(contracts.confirms));
    const logs = getEventFromLogs(
      'DatapoolOrderCreated',
      txReceipt.logs,
      {
        strict: true,
      },
    ).args;
    
    const datapoolorder = {
      dataset: logs.datapoolorder.dataset,
		  datasetprice: bigIntToBn(logs.datapoolorder.datasetprice).toString(),
		  volume: bigIntToBn(logs.datapoolorder.volume).toString(),
		  tag: logs.datapoolorder.tag,
		  apprestrict: logs.datapoolorder.apprestrict,
      workerpoolrestrict: logs.datapoolorder.workerpoolrestrict,
      requesterrestrict: logs.datapoolorder.requesterrestrict,
		  deadline: bigIntToBn(logs.datapoolorder.deadline).toString(),
		  salt: logs.datapoolorder.salt,
		  sign: logs.datapoolorder.sign,
    }

    return { datapoolContractAddress: vDatapoolAddress, datapoolorder };
  } catch (error) {
    debug('createDatapoolOrder()', error);
    throw error;
  }
};

export const withdrawVersionReward = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
  versionid = throwIfMissing(),
) => {
  try {
    checkSigner(contracts);

    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);
    const vVersionId = await uint256Schema().validate(versionid);

    const tx = await wrapSend(datapoolContract.withdrawVersionReward(vVersionId, vDatasetAddress));
    await wrapWait(tx.wait(contracts.confirms));
    const txHash = tx.hash;

    return { dataset: vDatasetAddress, datapoolContractAddress: vDatapoolAddress, versionid: vVersionId, txHash };
  } catch (error) {
    debug('withdrawVersionReward()', error);
    throw error;
  }
};

export const showVersionReward = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  versionid = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const vVersionid = await uint256Schema().validate(versionid);
    const vDatasetAddress = await addressSchema().validate(datasetAddress);
    const version = await wrapCall(datapoolContract.versions(vVersionid));
    const versionRewardClaimed = await wrapCall(datapoolContract.versionRewardClaimed(vVersionid, vDatasetAddress));
    
    const reward = bigIntToBn(version.accumulatedReward).toString();
    const claimable = (bigIntToBn(version.accumulatedReward) - bigIntToBn(versionRewardClaimed)).toString();

    return { datapoolContractAddress: vDatapoolAddress, reward, claimable };
  } catch (error) {
    debug('showVersionReward()', error);
    throw error;
  }
};

export const showAllVersionsRewards = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  datasetAddress = throwIfMissing(),
) => {
  try {
    const datapoolNft = await showDatapoolNft(contracts, datapoolNftAddress);
    const vDatapoolAddress = await addressSchema().validate(datapoolNft.datasetMultiaddr);
    const datapoolContract = contracts.getContract(datapoolNft.datasetName, vDatapoolAddress);
    const currentVersionid = await wrapCall(datapoolContract.versionid());

    const result = {};
    for (let versionid = 1; versionid <= bigIntToBn(currentVersionid); versionid++) {
      const { reward, claimable } = await showVersionReward(contracts, datapoolNftAddress, versionid, datasetAddress);

      result[versionid] = {
          reward: reward,
          claimable: claimable
      };
    }
    

    return { datapoolContractAddress: vDatapoolAddress, result };
  } catch (error) {
    debug('showAllVersionsRewards()', error);
    throw error;
  }
};

const showDatapoolNft = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
) => {
  try {
    const {dataset: datapoolNft} = await showDataset(contracts, datapoolNftAddress);

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

