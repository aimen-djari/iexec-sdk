export * from '../common/types.js';

import IExecConfig from './IExecConfig.js';
import IExecModule from './IExecModule.js';
import {
  Address,
  Addressish,
  BN,
  TxHash,
  Bytes32,
} from '../common/types.js';

export interface DatapoolDeploymentArgs {
  /**
   * Address of the implementation contract
   */
  implementation: string;
  /**
   * Minimum price set by the datapool owner
   */
  datapoolOwnerPrice: BN;
  /**
   * Price per dataset
   */
  datasetPrice: BN;
  /**
   * List of allowed application addresses
   */
  allowedApps: Addressish[];
  /**
   * List of allowed workerpool addresses
   */
  allowedWorkerpools: Addressish[];
  /**
   * Whitelist of addresses (optional)
   */
  whitelist?: Addressish[];
}

export interface DatapoolDataset {
  /**
   * Address of the dataset
   */
  datasetAddress: Addressish;
  /**
   * Indicates if the dataset is active
   */
  isActive: boolean;
}

export interface DatapoolState {
  /**
   * Address of the datapool owner
   */
  datapoolOwner: Addressish;
  /**
   * Count of active datasets in the datapool
   */
  activeDatasetCount: string;
  /**
   * Minimal price set by the datapool owner
   */
  minimalDatapoolOwnerPrice: string;
  /**
   * Minimal price for a dataset
   */
  minimalDatasetPrice: string;
  /**
   * Current price set by the datapool owner
   */
  currentDatapoolOwnerPrice: string;
  /**
   * Current price for a dataset
   */
  currentDatasetPrice: string;
  /**
   * Count of allowed application addresses
   */
  allowedAppCount: string;
  /**
   * Count of allowed workerpool addresses
   */
  allowedWorkerpoolCount: string;
  /**
   * List of datasets in the datapool
   */
  datasets: DatapoolDataset[];
}

/**
 * Module exposing datapool-related methods
 */
export default class IExecDatapoolModule extends IExecModule {
  /**
   * **SIGNER REQUIRED**
   *
   * Create and deploy a datapool contract on the blockchain
   *
   * @example
   * ```js
   * const { address } = await deployDatapool({
   *   owner: userAddress,
   *   ownerPrice: '1000',
   *   datasetPrice: '500',
   * });
   * console.log('Deployed at', address);
   * ```
   */
  createDatapool(
    datapool: DatapoolDeploymentArgs,
  ): Promise<{ address: Address; txHash: TxHash }>;

  /**
   * Show a deployed datapool's state
   *
   * @example
   * ```js
   * const state = await showDatapoolState(datapoolAddress);
   * console.log('Datapool state:', state);
   * ```
   */
  showDatapoolState(datapoolAddress: Addressish): Promise<DatapoolState>;

  /**
   * Add an allowed app to the datapool
   *
   * @example
   * ```js
   * const success = await addAllowedApp(datapoolAddress, appAddress);
   * console.log('App allowed:', success);
   * ```
   */
  addAllowedApp(
    datapoolAddress: Addressish,
    appAddress: Addressish,
  ): Promise<boolean>;

  /**
   * Check if an app is allowed in the datapool
   *
   * @example
   * ```js
   * const isAllowed = await isAppAllowed(datapoolAddress, appAddress);
   * console.log('App is allowed:', isAllowed);
   * ```
   */
  isAppAllowed(
    datapoolAddress: Addressish,
    appAddress: Addressish,
  ): Promise<boolean>;

  /**
   * Add an allowed workerpool to the datapool
   *
   * @example
   * ```js
   * const success = await addAllowedWorkerpool(datapoolAddress, workerpoolAddress);
   * console.log('Workerpool allowed:', success);
   * ```
   */
  addAllowedWorkerpool(
    datapoolAddress: Addressish,
    workerpoolAddress: Addressish,
  ): Promise<boolean>;

  /**
   * Check if a workerpool is allowed in the datapool
   *
   * @example
   * ```js
   * const isAllowed = await isWorkerpoolAllowed(datapoolAddress, workerpoolAddress);
   * console.log('Workerpool is allowed:', isAllowed);
   * ```
   */
  isWorkerpoolAllowed(
    datapoolAddress: Addressish,
    workerpoolAddress: Addressish,
  ): Promise<boolean>;

  /**
   * Set the datapool owner's price for tasks
   *
   * @example
   * ```js
   * const updated = await setDatapoolOwnerPrice(datapoolAddress, '2000');
   * console.log('Owner price updated:', updated);
   * ```
   */
  setDatapoolOwnerPrice(
    datapoolAddress: Addressish,
    ownerPrice: BN,
  ): Promise<boolean>;

  /**
   * Set the dataset price for tasks in the datapool
   *
   * @example
   * ```js
   * const updated = await setDatasetPrice(datapoolAddress, '300');
   * console.log('Dataset price updated:', updated);
   * ```
   */
  setDatasetPrice(
    datapoolAddress: Addressish,
    datasetPrice: BN,
  ): Promise<boolean>;

  /**
   * Create a task using the datapool
   *
   * @example
   * ```js
   * const task = await createDatapoolTask(datapoolAddress, appOrder, workerpoolOrder, requestOrder);
   * console.log('Task created:', task);
   * ```
   */
  createDatapoolTask(
    datapoolAddress: Addressish,
    appOrder: any,
    workerpoolOrder: any,
    requestOrder: any,
  ): Promise<{ taskId: Bytes32; txHash: TxHash }>;

  /**
   * Create an `IExecDatapoolModule` instance using an `IExecConfig` instance
   */
  static fromConfig(config: IExecConfig): IExecDatapoolModule;
}