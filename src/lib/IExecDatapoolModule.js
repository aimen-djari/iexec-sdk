import IExecModule from './IExecModule.js';
import {
  createDatapool,
  showDatapoolState,
  isAppAllowed,
  isWorkerpoolAllowed,
  setDatapoolOwnerPrice,
  setDatasetPrice,
  createDatapoolOrder,
  approveRequestToAddDataset,
  declineRequestToAddDataset,
  isDatasetInWaitingList,
  addDatasetToWhitelist,
  removeDatasetFromWhitelist,
  isWhitelistedDataset,
} from '../common/protocol/datapool.js';

export default class IExecDatapoolModule extends IExecModule {
  constructor(...args) {
    super(...args);

    this.createDatapool = async (obj) =>
    createDatapool(await this.config.resolveContractsClient(), obj);

    this.showDatapoolState = async (datapoolNftAddress) =>
    showDatapoolState(await this.config.resolveContractsClient(), datapoolNftAddress);

    this.isAppAllowed = async (datapoolNftAddress, appAddress) =>
    isAppAllowed(await this.config.resolveContractsClient(), datapoolNftAddress, appAddress);

    this.isWorkerpoolAllowed = async (datapoolNftAddress, workerpoolAddress) =>
    isWorkerpoolAllowed(await this.config.resolveContractsClient(), datapoolNftAddress, workerpoolAddress);

    this.setDatapoolOwnerPrice = async (datapoolNftAddress, datapoolOwnerPrice) =>
    setDatapoolOwnerPrice(await this.config.resolveContractsClient(), datapoolNftAddress, datapoolOwnerPrice);
    this.setDatasetPrice = async (datapoolNftAddress, datasetPrice) =>
    setDatasetPrice(await this.config.resolveContractsClient(), datapoolNftAddress, datasetPrice);

    this.createDatapoolOrder = async (datapoolNftAddress, app, workerpool, volume) =>
    createDatapoolOrder(await this.config.resolveContractsClient(), datapoolNftAddress, app, workerpool, volume);

    this.approveRequestToAddDataset = async (datapoolNftAddress, datasetAddress) =>
    approveRequestToAddDataset(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);
    this.declineRequestToAddDataset = async (datapoolNftAddress, datasetAddress) =>
    declineRequestToAddDataset(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);
    this.isDatasetInWaitingList = async (datapoolNftAddress, datasetAddress) =>
    isDatasetInWaitingList(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);

    this.addDatasetToWhitelist = async (datapoolNftAddress, datasetAddress) =>
    addDatasetToWhitelist(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);
    this.removeDatasetFromWhitelist = async (datapoolNftAddress, datasetAddress) =>
    removeDatasetFromWhitelist(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);
    this.isWhitelistedDataset = async (datapoolNftAddress, datasetAddress) =>
    isWhitelistedDataset(await this.config.resolveContractsClient(), datapoolNftAddress, datasetAddress);
  }
}
