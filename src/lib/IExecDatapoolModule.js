import IExecModule from './IExecModule.js';
import {
  createDatapool,
  showDatapoolState,
  addAllowedApp,
  addAllowedWorkerpool,
  isAppAllowed,
  isWorkerpoolAllowed,
  setDatapoolOwnerPrice,
  setDatasetPrice,
  createDatapoolTask,
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
    this.addAllowedApp = async (datapoolNftAddress, appAddress) =>
    addAllowedApp(await this.config.resolveContractsClient(), datapoolNftAddress, appAddress);

    this.isWorkerpoolAllowed = async (datapoolNftAddress, workerpoolAddress) =>
    isWorkerpoolAllowed(await this.config.resolveContractsClient(), datapoolNftAddress, workerpoolAddress);
    this.addAllowedWorkerpool = async (datapoolNftAddress, workerpoolAddress) =>
    addAllowedWorkerpool(await this.config.resolveContractsClient(), datapoolNftAddress, workerpoolAddress);

    this.setDatapoolOwnerPrice = async (datapoolNftAddress, datapoolOwnerPrice) =>
    setDatapoolOwnerPrice(await this.config.resolveContractsClient(), datapoolNftAddress, datapoolOwnerPrice);
    this.setDatasetPrice = async (datapoolNftAddress, datasetPrice) =>
    setDatasetPrice(await this.config.resolveContractsClient(), datapoolNftAddress, datasetPrice);

    this.createDatapoolTask = async (datapoolNftAddress, appOrder, workerpoolOrder, requestOrder) =>
    createDatapoolTask(await this.config.resolveContractsClient(), datapoolNftAddress, appOrder, workerpoolOrder, requestOrder);
    
  }
}
