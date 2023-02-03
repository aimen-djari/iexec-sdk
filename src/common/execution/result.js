import Debug from 'debug';
import { show } from './task';
import { downloadZipApi } from '../utils/api-utils';
import { bytes32Schema, throwIfMissing } from '../utils/validator';

const debug = Debug('iexec:execution:result');

const downloadFromIpfs = async (
  ipfsAddress,
  { ipfsGatewayURL = 'https://gateway.ipfs.io' } = {},
) => {
  try {
    const res = await downloadZipApi.get({
      api: ipfsGatewayURL,
      endpoint: ipfsAddress,
    });
    return res;
  } catch (error) {
    throw Error(`Failed to download from ${ipfsGatewayURL}: ${error.message}`);
  }
};

export const fetchTaskResults = async (
  contracts = throwIfMissing(),
  taskid = throwIfMissing(),
  { ipfsGatewayURL } = {},
) => {
  try {
    const vTaskId = await bytes32Schema().validate(taskid);
    const task = await show(contracts, vTaskId);
    if (task.status !== 3) throw Error('Task is not completed');
    const { storage, location } = task.results;
    if (storage === 'none') {
      throw Error('No result uploaded for this task');
    }
    if (storage !== 'ipfs') {
      throw Error(`Task result stored on ${storage}, download not supported`);
    }
    if (!location) {
      throw Error(
        'Missing location key in task results, download not supported',
      );
    }
    const res = await downloadFromIpfs(location, { ipfsGatewayURL });
    return res;
  } catch (error) {
    debug('fetchResults()', error);
    throw error;
  }
};
