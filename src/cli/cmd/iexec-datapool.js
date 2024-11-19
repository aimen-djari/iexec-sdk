#!/usr/bin/env node

import { program as cli } from 'commander';
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
  approveRequestToAddDataset,
  declineRequestToAddDataset,
  isDatasetInWaitingList,
  addDatasetToWhitelist,
  removeDatasetFromWhitelist,
  isWhitelistedDataset,
} from '../../common/protocol/datapool.js';

import {
  DATAPOOL,
  APP_ORDER,
  WORKERPOOL_ORDER,
  REQUEST_ORDER,
} from '../../common/utils/constant.js';
import {
  loadIExecConf,
  initObj,
  saveDeployedObj,
  loadDeployedObj,
  loadSignedOrders,
} from '../utils/fs.js';
import { Keystore } from '../utils/keystore.js';
import { loadChain, connectKeystore } from '../utils/chains.js';
import {
  finalizeCli,
  addGlobalOptions,
  addWalletLoadOptions,
  computeWalletLoadOptions,
  computeTxOptions,
  checkUpdate,
  handleError,
  desc,
  option,
  Spinner,
  pretty,
  info,
  isEthAddress,
  getPropertyFormChain,
  getSmsUrlFromChain,
  isBytes32,
} from '../utils/cli-helper.js';
import {
  checkRequestRequirements,
  resolveTeeFrameworkFromTag,
  checkAppRequirements,
} from '../../common/execution/order-helper.js';
import { sumTags } from '../../lib/utils.js';
import {
  requestorderSchema,
  apporderSchema,
  throwIfMissing,
} from '../../common/utils/validator.js';
import {
  fetchPublishedOrderByHash,
} from '../../common/market/marketplace.js';

const objName = DATAPOOL;

cli
  .name('iexec datapool')
  .usage('<command> [options]')
  .storeOptionsAsProperties(false);

const init = cli.command('init');
addGlobalOptions(init);
addWalletLoadOptions(init);
init
  .description(desc.initObj(objName))
  .action(async (opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const keystore = Keystore({ ...walletOptions, isSigner: false });
      const [address] = await keystore.accounts();
      const { saved, fileName } = await initObj(objName, {
        overwrite: { owner: address },
      });
      spinner.succeed(
        `Saved default datapool in "${fileName}", you can edit it:${pretty(
          saved,
        )}`,
        { raw: { datapool: saved } },
      );
    } catch (error) {
      handleError(error, cli, opts);
    }
  });


const deploy = cli.command('deploy');
addGlobalOptions(deploy);
addWalletLoadOptions(deploy);
deploy
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolImplementation())
  .option(...option.datapoolOwnerPrice())
  .option(...option.datasetPrice())
  .option(...option.appRestrict())
  .option(...option.workerpoolRestrict())
  .option(...option.whitelist())
  .description(desc.deployObj(objName))
  .action(async (opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain, iexecConf] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
        loadIExecConf(),
      ]);

      if (!iexecConf[objName]) {
        throw Error(
          `Missing datapool in "iexec.json". Did you forget to run "iexec datapool init"?`,
        );
      }

      let implementation = iexecConf[objName].name;


      if (opts.implementation !== undefined) {
        implementation = opts.implementation;
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.deploying(implementation));

      const datapoolOwnerPrice = opts.datapoolOwnerPrice === undefined ? 0 : opts.datapoolOwnerPrice;
      const datasetPrice = opts.datasetPrice === undefined ? 0 : opts.datasetPrice;
      const appRestrict = opts.appRestrict
        ? Array.isArray(opts.appRestrict)
          ? opts.appRestrict
          : opts.appRestrict.replace(/[\[\]]/g, "").split(",").map((addr) => addr.trim())
        : [];
      const workerpoolRestrict = opts.workerpoolRestrict
        ? Array.isArray(opts.workerpoolRestrict)
          ? opts.workerpoolRestrict
          : opts.workerpoolRestrict.replace(/[\[\]]/g, "").split(",").map((addr) => addr.trim())
        : [];
      const whitelist = opts.whitelist
        ? Array.isArray(opts.whitelist)
          ? opts.whitelist
          : opts.whitelist.replace(/[\[\]]/g, "").split(",").map((addr) => addr.trim())
        : [];

      const datapoolConf = {
        implementation: implementation,
        datapoolOwnerPrice: datapoolOwnerPrice,
        datasetPrice: datasetPrice,
        allowedApps: appRestrict,
        allowedWorkerpools: workerpoolRestrict,
        whitelist: whitelist,
      };

      const { datapoolAddress, datapoolNftAddress, txHash } = await createDatapool(
        chain.contracts,
        datapoolConf,
      );

      await initObj(objName, {
        overwrite: { owner: address, name: implementation, tag: DATAPOOL, multiaddr: datapoolAddress },
      });

      await saveDeployedObj(objName, chain.id, datapoolNftAddress);

      spinner.succeed(`Created new datapool contract at address ${datapoolAddress} with NFT at address ${datapoolNftAddress}`, {
        raw: { datapoolAddress, datapoolNftAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const show = cli.command('show [datapoolNftAddress]');
addGlobalOptions(show);
addWalletLoadOptions(show);
show
  .option(...option.chain())
  .option(...option.user())
  .description(desc.showObj(objName, ''))
  .action(async (cliAddress, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    //const walletOptions = computeWalletLoadOptions(opts);
    const txOptions = await computeTxOptions(opts);
    //const keystore = Keystore(walletOptions);
    try {
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        cliAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      const isAddress = isEthAddress(datapoolNftAddress, { strict: false });
      if (!isAddress) {
        throw Error(
          `argument is not an eth address`,
        );
      }

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(objName, chain.id));

      //await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.showing(objName));

      const { datapoolContractAddress, datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);

      spinner.succeed(
        `Datapool ${datapoolNftAddress} with contract address ${datapoolContractAddress} details:${pretty({
          ...datapoolState,
        })}`,
        {
          raw: { datapoolNftAddress, datapoolContractAddress, datapoolState },
        },
      );
    } catch (error) {
      handleError(error, cli, opts);
    }
  });
/*
const updatePolicy = cli.command('update-policy [address]')
  .description('Update datapool policy');
  */

const addApp = cli.command('add-allowed-app [appAddress]');
addGlobalOptions(addApp);
addWalletLoadOptions(addApp);
addApp
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.addObj(objName, 'app'))
  .action(async (app, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);

      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { appAllowed } = await isAppAllowed(
          chain.contracts,
          datapoolNftAddress,
          app,
        );
        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);

        const allowedAppCount = datapoolState.allowedAppCount;

        if (appAllowed && allowedAppCount !== 'infinite') {
          throw Error(
            `Requirements check failed: App already allowed (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        }
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await addAllowedApp(
        chain.contracts,
        datapoolNftAddress,
        app,
      );

      spinner.succeed(`Added app ${app} to datapool ${datapoolContractAddress}`, {
        raw: { app, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const checkApp = cli.command('check-allowed-app [appAddress]');
addGlobalOptions(checkApp);
addWalletLoadOptions(checkApp);
checkApp
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .description(desc.checkObj(objName, 'app'))
  .action(async (app, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      //const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      //const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      //await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, appAllowed } = await isAppAllowed(
        chain.contracts,
        datapoolNftAddress,
        app,
      );

      const message = appAllowed
        ? `App ${app} is allowed in datapool ${datapoolContractAddress}`
        : `App ${app} is restricted in datapool ${datapoolContractAddress}`;


      spinner.succeed(`${message}`, {
        raw: { app, datapoolContractAddress, appAllowed },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const addWorkerpool = cli.command('add-allowed-workerpool [workerpoolAddress]');
addGlobalOptions(addWorkerpool);
addWalletLoadOptions(addWorkerpool);
addWorkerpool
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.addObj(objName, 'workerpool'))
  .action(async (workerpool, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { workerpoolAllowed } = await isWorkerpoolAllowed(
          chain.contracts,
          datapoolNftAddress,
          workerpool,
        );

        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
        const allowedWorkerpoolCount = datapoolState.allowedWorkerpoolCount;

        if (workerpoolAllowed && allowedWorkerpoolCount !== 'infinite') {
          throw Error(
            `Requirements check failed: Workerpool already allowed (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        }
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await addAllowedWorkerpool(
        chain.contracts,
        datapoolNftAddress,
        workerpool,
      );

      spinner.succeed(`Added workerpool ${workerpool} to datapool ${datapoolContractAddress}`, {
        raw: { workerpool, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const checkWorkerpool = cli.command('check-allowed-workerpool [workerpoolAddress]');
addGlobalOptions(checkWorkerpool);
addWalletLoadOptions(checkWorkerpool);
checkWorkerpool
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .description(desc.checkObj(objName, 'workerpool'))
  .action(async (workerpool, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      //const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      //const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);

      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      //await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, workerpoolAllowed } = await isWorkerpoolAllowed(
        chain.contracts,
        datapoolNftAddress,
        workerpool,
      );

      const message = workerpoolAllowed
        ? `Workerpool ${workerpool} is allowed in datapool ${datapoolContractAddress}`
        : `Workerpool ${workerpool} is restricted in datapool ${datapoolContractAddress}`;


      spinner.succeed(`${message}`, {
        raw: { workerpool, datapoolContractAddress, workerpoolAllowed },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const setDatapoolPrice = cli.command('set-datapool-owner-price [price]');
addGlobalOptions(setDatapoolPrice);
addWalletLoadOptions(setDatapoolPrice);
setDatapoolPrice
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.setPriceObj(objName, 'datapool owner'))
  .action(async (datapoolOwnerPrice, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);

      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
        const datapoolOwner = datapoolState.datapoolOwner;

        if (datapoolOwner !== address) {
          throw Error(
            `Requirements check failed: You are not the datapool owner. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        }

      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await setDatapoolOwnerPrice(
        chain.contracts,
        datapoolNftAddress,
        datapoolOwnerPrice,
      );

      spinner.succeed(`Updated datapool owner price to ${datapoolOwnerPrice} for datapool ${datapoolContractAddress}`, {
        raw: { datapoolOwnerPrice, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const setDatasetPriceCmd = cli.command('set-dataset-price [price]');
addGlobalOptions(setDatasetPriceCmd);
addWalletLoadOptions(setDatasetPriceCmd);
setDatasetPriceCmd
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.setPriceObj(objName, 'dataset'))
  .action(async (datasetPrice, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
        const datapoolOwner = datapoolState.datapoolOwner;

        if (datapoolOwner !== address) {
          throw Error(
            `Requirements check failed: You are not the datapool owner. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        }
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await setDatasetPrice(
        chain.contracts,
        datapoolNftAddress,
        datasetPrice,
      );

      spinner.succeed(`Updated dataset price to ${datasetPrice} for datapool ${datapoolContractAddress}`, {
        raw: { datasetPrice, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const approveRequest = cli.command('approve-request-dataset [datasetAddress]');
addGlobalOptions(approveRequest);
addWalletLoadOptions(approveRequest);
approveRequest
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.approveObj(objName))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        await checkWaitingListRequirements(chain, datapoolNftAddress, address, dataset);
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await approveRequestToAddDataset(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      spinner.succeed(`Approved request of dataset ${dataset} to join datapool ${datapoolContractAddress}`, {
        raw: { dataset, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const declineRequest = cli.command('decline-request-dataset [datasetAddress]');
addGlobalOptions(declineRequest);
addWalletLoadOptions(declineRequest);
declineRequest
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.declineObj(objName))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        await checkWaitingListRequirements(chain, datapoolNftAddress, address, dataset);
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await declineRequestToAddDataset(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      spinner.succeed(`Declined request of dataset ${dataset} to join datapool ${datapoolContractAddress}`, {
        raw: { dataset, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const checkWaiting = cli.command('check-waiting-dataset [datasetAddress]');
addGlobalOptions(checkWaiting);
addWalletLoadOptions(checkWaiting);
checkWaiting
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .description(desc.checkWaitingObj(objName))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      //const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      //const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);

      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      //await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.checking(objName));

      const { datapoolContractAddress, waitingDataset } = await isDatasetInWaitingList(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      const message = waitingDataset
        ? `Dataset ${dataset} is in the waiting list of datapool ${datapoolContractAddress}`
        : `Dataset ${dataset} is not in the waiting list of datapool ${datapoolContractAddress}`;


      spinner.succeed(`${message}`, {
        raw: { dataset, datapoolContractAddress, waitingDataset },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const addWhitelist = cli.command('add-dataset-to-whitelist [datasetAddress]');
addGlobalOptions(addWhitelist);
addWalletLoadOptions(addWhitelist);
addWhitelist
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.whitelistObj(objName, 'add to'))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
        const datapoolOwner = datapoolState.datapoolOwner;

        if (datapoolOwner !== address) {
          throw Error(
            `Requirements check failed: You are not the datapool owner. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
          );
        }

        const { whitelistedDataset } = await isWhitelistedDataset(
          chain.contracts,
          datapoolNftAddress,
          dataset
        );

        if (whitelistedDataset) {
          throw Error(
            `Requirements check failed: Dataset is already in whitelist. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
          );
        }
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await addDatasetToWhitelist(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      spinner.succeed(`Added dataset ${dataset} to whitelist of datapool ${datapoolContractAddress}`, {
        raw: { dataset, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const removeWhitelist = cli.command('remove-dataset-from-whitelist [datasetAddress]');
addGlobalOptions(removeWhitelist);
addWalletLoadOptions(removeWhitelist);
removeWhitelist
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .option(...option.skipPreflightCheck())
  .description(desc.whitelistObj(objName, 'remove from'))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [address] = await keystore.accounts();
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);
      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      if (!opts.skipPreflightCheck) {
        const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
        const datapoolOwner = datapoolState.datapoolOwner;

        if (datapoolOwner !== address) {
          throw Error(
            `Requirements check failed: You are not the datapool owner. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
          );
        }

        const { whitelistedDataset } = await isWhitelistedDataset(
          chain.contracts,
          datapoolNftAddress,
          dataset
        );

        if (!whitelistedDataset) {
          throw Error(
            `Requirements check failed: Dataset is not in whitelist. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
          );
        }
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.updating(objName));

      const { datapoolContractAddress, txHash } = await removeDatasetFromWhitelist(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      spinner.succeed(`Removed dataset ${dataset} from whitelist of datapool ${datapoolContractAddress}`, {
        raw: { dataset, datapoolContractAddress, txHash },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const checkWhitelist = cli.command('check-whitelisted-dataset [datasetAddress]');
addGlobalOptions(checkWhitelist);
addWalletLoadOptions(checkWhitelist);
checkWhitelist
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.datapoolAddress())
  .description(desc.whitelistObj(objName, 'check'))
  .action(async (dataset, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      //const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      //const keystore = Keystore(walletOptions);
      const [chain] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
      ]);

      const datapoolNftAddress =
        opts.datapoolAddress ||
        (await loadDeployedObj(objName).then(
          (deployedObj) => deployedObj && deployedObj[chain.id],
        ));

      if (!datapoolNftAddress) throw Error(info.missingAddressOrDeployed(DATAPOOL, chain.id));

      //await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.checking(objName));

      const { datapoolContractAddress, whitelistedDataset } = await isWhitelistedDataset(
        chain.contracts,
        datapoolNftAddress,
        dataset,
      );

      const message = whitelistedDataset
        ? `Dataset ${dataset} is whitelisted in datapool ${datapoolContractAddress}`
        : `Dataset ${dataset} is not whitelisted in datapool ${datapoolContractAddress}`;


      spinner.succeed(`${message}`, {
        raw: { dataset, datapoolContractAddress, whitelistedDataset },
      });
    } catch (error) {
      handleError(error, cli, opts);
    }
  });


const fill = cli.command('create-task [datapoolNftAddress]');
addGlobalOptions(fill);
addWalletLoadOptions(fill);
fill
  .option(...option.chain())
  .option(...option.txGasPrice())
  .option(...option.txConfirms())
  .option(...option.force())
  .option(...option.fillAppOrder())
  .option(...option.fillWorkerpoolOrder())
  .option(...option.fillRequestOrder())
  .option(...option.fillRequestParams())
  .option(...option.skipPreflightCheck())
  .description(desc.createTaskObj(objName))
  .action(async (datapoolNftAddress, opts) => {
    await checkUpdate(opts);
    const spinner = Spinner(opts);
    try {
      const walletOptions = computeWalletLoadOptions(opts);
      const txOptions = await computeTxOptions(opts);
      const keystore = Keystore(walletOptions);
      const [chain, signedOrders] = await Promise.all([
        loadChain(opts.chain, { txOptions, spinner }),
        loadSignedOrders(),
      ]);

      const inputParams = opts.params;
      const requestOnTheFly = inputParams !== undefined;

      const getOrderByHash = async (orderName, orderHash) => {
        if (isBytes32(orderHash, { strict: false })) {
          spinner.info(
            `Fetching ${orderName} ${orderHash} from iexec marketplace`,
          );
          const orderRes = await fetchPublishedOrderByHash(
            getPropertyFormChain(chain, 'iexecGateway'),
            orderName,
            chain.id,
            orderHash,
          );
          if (!orderRes) {
            throw Error(
              `${orderName} ${orderHash} is not published on iexec marketplace`,
            );
          }
          return orderRes.order;
        }
        throw Error(`Invalid ${orderName} hash`);
      };
      const appOrder = opts.app
        ? await getOrderByHash(APP_ORDER, opts.app)
        : signedOrders[chain.id].apporder;
      const workerpoolOrder = opts.workerpool
        ? await getOrderByHash(WORKERPOOL_ORDER, opts.workerpool)
        : signedOrders[chain.id].workerpoolorder;
      let requestOrderInput;
      if (requestOnTheFly) {
        requestOrderInput = undefined;
      } else {
        requestOrderInput = opts.request
          ? await getOrderByHash(REQUEST_ORDER, opts.request)
          : signedOrders[chain.id].requestorder;
      }

      if (!appOrder) throw new Error('Missing apporder');
      if (!workerpoolOrder) throw new Error('Missing workerpoolorder');

      const requestOrder = requestOrderInput;
      if (!requestOrder) {
        throw new Error('Missing requestorder');
      }

      if (!opts.skipPreflightCheck) {
        const resolvedTag = sumTags([
          (
            await requestorderSchema()
              .label('requestorder')
              .validate(requestOrder)
          ).tag,
          (await apporderSchema().label('apporder').validate(appOrder)).tag,
        ]);
        await checkAppRequirements(
          {
            contracts: chain.contracts,
          },
          appOrder,
          { tagOverride: resolvedTag },
        ).catch((e) => {
          throw Error(
            `App requirements check failed: ${e.message
            } (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        });
        await checkRequestRequirements(
          {
            contracts: chain.contracts,
            smsURL: getSmsUrlFromChain(chain, {
              teeFramework: await resolveTeeFrameworkFromTag(resolvedTag),
            }),
          },
          requestOrder,
        ).catch((e) => {
          throw Error(
            `Request requirements check failed: ${e.message
            } (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        });

        await checkDatapoolRequirements(
          chain.contracts,
          datapoolNftAddress,
          appOrder.app,
          workerpoolOrder.workerpool,
          requestOrder,
        ).catch((e) => {
          throw Error(
            `Datapool requirements check failed: ${e.message
            } (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]
            } to skip preflight requirement check)`,
          );
        });
      }

      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.creating(`${objName} task`));

      const { taskid } = await createDatapoolTask(
        chain.contracts,
        datapoolNftAddress,
        appOrder,
        workerpoolOrder,
        requestOrder,
      );
      spinner.succeed(
        `datapool task successfully purchased with taskid ${taskid}`,
        { raw: { taskid } },
      );
    } catch (error) {
      handleError(error, cli, opts);
    }
  });

const checkDatapoolRequirements = async (
  contracts = throwIfMissing(),
  datapoolNftAddress = throwIfMissing(),
  app = throwIfMissing(),
  workerpool = throwIfMissing(),
  requestOrder = throwIfMissing(),
) => {
  const { datapoolState } = await showDatapoolState(contracts, datapoolNftAddress);
  const activeDatasetCount = datapoolState.activeDatasetCount;

  if (activeDatasetCount === '0') {
    throw Error(
      'Datapool is empty, wait for a dataset to join the datapool before creating a task.',
    );
  }

  const { appAllowed } = await isAppAllowed(
    contracts,
    datapoolNftAddress,
    app,
  );

  if (!appAllowed) {
    throw Error(
      'App is not allowed for this datapool.',
    );
  }

  const { workerpoolAllowed } = await isWorkerpoolAllowed(
    contracts,
    datapoolNftAddress,
    workerpool,
  );

  if (!workerpoolAllowed) {
    throw Error(
      'Workerpool is not allowed for this datapool.',
    );
  }

  if (requestOrder.dataset !== datapoolNftAddress) {
    throw Error(
      'Dataset in request order does not match the datapool NFT address.',
    );
  }

  const price = parseInt(activeDatasetCount) * parseInt(datapoolState.currentDatasetPrice) + parseInt(datapoolState.currentDatapoolOwnerPrice);
  if (requestOrder.datasetmaxprice < price) {
    throw Error(
      `Dataset max price in request order is lower than datapool price (${requestOrder.datasetmaxprice} < ${price}).`,
    );
  }
};

async function checkWaitingListRequirements(chain, datapoolNftAddress, address, dataset) {
  const { datapoolState } = await showDatapoolState(chain.contracts, datapoolNftAddress);
  const datapoolOwner = datapoolState.datapoolOwner;

  if (datapoolOwner !== address) {
    throw Error(
      `Requirements check failed: You are not the datapool owner. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
    );
  }

  const { waitingDataset } = await isDatasetInWaitingList(
    chain.contracts,
    datapoolNftAddress,
    dataset
  );

  if (!waitingDataset) {
    throw Error(
      `Requirements check failed: Dataset is not in waiting list. (If you consider this is not an issue, use ${option.skipPreflightCheck()[0]} to skip preflight requirement check)`
    );
  }
};

finalizeCli(cli);

