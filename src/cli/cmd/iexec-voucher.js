#!/usr/bin/env node

const Debug = require('debug');
const cli = require('commander');
const path = require('path');
const fs = require('fs-extra');
const voucherModule = require('../../common/modules/voucher');
const {
	stringifyNestedBn,
	decryptResult,
} = require('../../common/utils/utils');
const {
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
	info,
	pretty,
	createEncFolderPaths,
	privateKeyName,
} = require('../utils/cli-helper');
const { Keystore } = require('../utils/keystore');
const { loadChain, connectKeystore } = require('../utils/chains');

const debug = Debug('iexec:iexec-voucher');
const objName = 'voucher';

cli.name('iexec voucher').usage('<command> [options]');



const requestTask = cli.command('requestTask');
addGlobalOptions(requestTask);
addWalletLoadOptions(requestTask);
requestTask
	.option(...option.chain())
	.option(...option.txGasPrice())
	.option(...option.txConfirms())
	.option(...option.force())
	.option(...option.fillAppOrder())
	.option(...option.fillDatasetOrder())
	.option(...option.fillWorkerpoolOrder())
	.option(...option.fillRequestOrder())
	.option(...option.fillRequestParams())
	.option(...option.skipRequestCheck())
	.description(desc.request(objName))
	.action(async (opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);
		try {
			const walletOptions = await computeWalletLoadOptions(opts);
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
					const orderRes = await order.fetchPublishedOrderByHash(
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
				? await getOrderByHash(order.APP_ORDER, opts.app)
				: signedOrders[chain.id].apporder;
			const datasetOrder = opts.dataset
				? await getOrderByHash(order.DATASET_ORDER, opts.dataset)
				: signedOrders[chain.id].datasetorder;
			const workerpoolOrder = opts.workerpool
				? await getOrderByHash(order.WORKERPOOL_ORDER, opts.workerpool)
				: signedOrders[chain.id].workerpoolorder;
			let requestOrderInput;
			if (requestOnTheFly) {
				requestOrderInput = undefined;
			} else {
				requestOrderInput = opts.request
					? await getOrderByHash(order.REQUEST_ORDER, opts.request)
					: signedOrders[chain.id].requestorder;
			}

			const useDataset = requestOrderInput
				? requestOrderInput.dataset !== NULL_ADDRESS
				: !!datasetOrder;
			debug('useDataset', useDataset);

			if (!appOrder) throw new Error('Missing apporder');
			if (!datasetOrder && useDataset) throw new Error('Missing datasetorder');
			if (!workerpoolOrder) throw new Error('Missing workerpoolorder');

			const computeRequestOrder = async () => {
				await connectKeystore(chain, keystore, { txOptions });
				const unsignedOrder = await order.createRequestorder(
					{ contracts: chain.contracts, resultProxyURL: chain.resultProxy },
					{
						app: appOrder.app,
						appmaxprice: appOrder.appprice || undefined,
						dataset: useDataset ? datasetOrder.dataset : undefined,
						datasetmaxprice: useDataset ? datasetOrder.datasetprice : undefined,
						workerpool: workerpoolOrder.workerpool || undefined,
						workerpoolmaxprice: workerpoolOrder.workerpoolprice || undefined,
						category: workerpoolOrder.category,
						params: inputParams || undefined,
					},
				);
				if (!opts.force) {
					await prompt.signGeneratedOrder(
						order.REQUEST_ORDER,
						pretty(unsignedOrder),
					);
				}
				const signed = await order.signRequestorder(
					chain.contracts,
					unsignedOrder,
				);
				return signed;
			};

			const requestOrder = requestOrderInput || (await computeRequestOrder());
			if (!requestOrder) {
				throw new Error('Missing requestorder');
			}

			if (!opts.skipRequestCheck) {
				await checkRequestRequirements(
					{ contracts: chain.contracts, smsURL: chain.sms },
					requestOrder,
				).catch((e) => {
					throw Error(
						`Request requirements check failed: ${e.message
						} (If you consider this is not an issue, use ${option.skipRequestCheck()[0]
						} to skip request requirement check)`,
					);
				});
			}

			await connectKeystore(chain, keystore, { txOptions });
			spinner.start(info.filling(objName));
			const { dealid, volume, txHash } = await voucherModule.requestTask(
				chain.contracts,
				appOrder,
				useDataset ? datasetOrder : undefined,
				workerpoolOrder,
				requestOrder,
			);
			spinner.succeed(
				`${volume} task successfully purchased via Voucher with dealid ${dealid}`,
				{ raw: { dealid, volume: volume.toString(), txHash } },
			);
		} catch (error) {
			handleError(error, cli, opts);
		}
	});

const deposit = cli.command('deposit <address>');
addGlobalOptions(deposit);
addWalletLoadOptions(deposit);
deposit
	.option(...option.chain())
	.option(...option.amount())
	.description(desc.depositVoucher(objName))
	.action(async (address, opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);

		try {


			if (!(opts.amount)) {
				throw new Error(
					'No amount specified, you should specify amount with --amount',
				);
			}

			let amount = opts.amount;

			const walletOptions = await computeWalletLoadOptions(opts);
			const keystore = Keystore(walletOptions);
			const txOptions = await computeTxOptions(opts);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });

			spinner.start(info.showing(objName));
			const txHash = await voucherModule.deposit(chain.contracts, address, amount);
			spinner.succeed(`Voucher deposit of ${amount} xRLC to ${address}: ${txHash}`);
		} catch (error) {
			handleError(error, cli, opts);
		}
	});

const show = cli.command('show <address>');
addGlobalOptions(show);
addWalletLoadOptions(show);
show
	.option(...option.chain())
	.description(desc.showBalance(objName))
	.action(async (address, opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);

		try {
			const walletOptions = await computeWalletLoadOptions(opts);
			const keystore = Keystore(walletOptions);
			const txOptions = await computeTxOptions(opts);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });

			spinner.start(info.showing(objName));
			const success = {};
			const failed = [];

			try {
				const txHash = await voucherModule.show(chain.contracts, address);
				spinner.succeed(`Voucher balance of ${address}: ${txHash} xRLC`);
				Object.assign(success, { number: txHash });
			} catch (error) {
				failed.push(`show: ${error.message}`);
			}

			if (failed.length === 0) {
				spinner.succeed('Successfully shown', {
					raw: success,
				});
			} else {
				spinner.fail(`Failed to show: ${pretty(failed)}`, {
					raw: { ...success, fail: failed },
				});
			}
		} catch (error) {
			handleError(error, cli, opts);
		}
	});

const count = cli.command('count');
addGlobalOptions(count);
addWalletLoadOptions(count);
count
	.option(...option.chain())
	.option(...option.countAppCharacteristics())
	.option(...option.countDatasetCharacteristics())
	.option(...option.countWorkerpoolCharacteristics())
	.description(desc.count(objName))
	.action(async (opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);
		try {
			if (!(opts.app || opts.dataset || opts.workerpool)) {
				throw new Error(
					'No option specified, you should choose one (--app | --dataset | --workerpool)',
				);
			}
			const walletOptions = await computeWalletLoadOptions(opts);
			const txOptions = await computeTxOptions(opts);
			const keystore = Keystore(walletOptions);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });
			const success = {};
			const failed = [];

			const countCharacteristic = async (characteristicName) => {
				try {
					spinner.start(`Counting ${characteristicName}`);
					let number;
					switch (characteristicName) {
						case voucherModule.APP:
							number = (
								await voucherModule.countApps(chain.contracts)
							);
							break;
						case voucherModule.DATASET:
							number = (
								await voucherModule.countDatasets(chain.contracts)
							);
							break;
						case voucherModule.WORKERPOOL:
							number = (
								await voucherModule.countWorkerpools(chain.contracts)
							);
							break;
						default:
					}

					spinner.info(`${characteristicName} successfully counted with number (${number})`);
					Object.assign(success, { number: number});
				} catch (error) {
					failed.push(`${characteristicName}: ${error.message}`);
				}
			};

			if (opts.app) await countCharacteristic(voucherModule.APP);
			if (opts.dataset) await countCharacteristic(voucherModule.DATASET);
			if (opts.workerpool) await countCharacteristic(voucherModule.WORKERPOOL);

			if (failed.length === 0) {
				spinner.succeed('Successfully counted', {
					raw: success,
				});
			} else {
				spinner.fail(`Failed to count: ${pretty(failed)}`, {
					raw: { ...success, fail: failed },
				});
			}
		} catch (error) {
			handleError(error, cli, opts);
		}
	});

const view = cli.command('view');
addGlobalOptions(view);
addWalletLoadOptions(view);
view
	.option(...option.chain())
	.option(...option.viewAppCharacteristics())
	.option(...option.viewDatasetCharacteristics())
	.option(...option.viewWorkerpoolCharacteristics())
	.description(desc.view(objName))
	.action(async (opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);
		try {
			if (!(opts.app || opts.dataset || opts.workerpool)) {
				throw new Error(
					'No option specified, you should choose one (--app | --dataset | --workerpool)',
				);
			}
			const walletOptions = await computeWalletLoadOptions(opts);
			const txOptions = await computeTxOptions(opts);
			const keystore = Keystore(walletOptions);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });
			const success = {};
			const failed = [];

			const viewCharacteristic = async (characteristicName) => {
				try {
					spinner.start(`Viewing ${characteristicName}`);
					let address;
					switch (characteristicName) {
						case voucherModule.APP:
							address = (
								await voucherModule.viewApp(chain.contracts, opts.app)
							);
							break;
						case voucherModule.DATASET:
							address = (
								await voucherModule.viewDataset(chain.contracts, opts.dataset)
							);
							break;
						case voucherModule.WORKERPOOL:
							address = (
								await voucherModule.viewWorkerpool(chain.contracts, opts.workerpool)
							);
							break;
						default:
					}

					spinner.info(`${characteristicName} successfully viewed with address (${address})`);
					Object.assign(success, { address: address });
				} catch (error) {
					failed.push(`${characteristicName}: ${error.message}`);
				}
			};

			if (opts.app) await viewCharacteristic(voucherModule.APP);
			if (opts.dataset) await viewCharacteristic(voucherModule.DATASET);
			if (opts.workerpool) await viewCharacteristic(voucherModule.WORKERPOOL);

			if (failed.length === 0) {
				spinner.succeed('Successfully viewed', {
					raw: success,
				});
			} else {
				spinner.fail(`Failed to view: ${pretty(failed)}`, {
					raw: { ...success, fail: failed },
				});
			}
		} catch (error) {
			handleError(error, cli, opts);
		}
	});


const authorize = cli.command('authorize');
addGlobalOptions(authorize);
addWalletLoadOptions(authorize);
authorize
	.option(...option.chain())
	.option(...option.authorizeApp())
	.option(...option.authorizeDataset())
	.option(...option.authorizeWorkerpool())
	.description(desc.authorize(objName))
	.action(async (opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);
		try {
			if (!(opts.app || opts.dataset || opts.workerpool)) {
				throw new Error(
					'No option specified, you should choose one (--app | --dataset | --workerpool)',
				);
			}
			
			console.log(opts.app);
			console.log(opts.dataset);
			console.log(opts.workerpool);
			
			const walletOptions = await computeWalletLoadOptions(opts);
			const txOptions = await computeTxOptions(opts);
			const keystore = Keystore(walletOptions);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });
			const success = {};
			const failed = [];

			const authorizeCharacteristic = async (characteristicName) => {
				try {
					spinner.start(`Authorizing ${characteristicName}`);
					let id;
					switch (characteristicName) {
						case voucherModule.APP:
							id = (
								await voucherModule.addApp(chain.contracts, opts.app)
							);
							break;
						case voucherModule.DATASET:
							id = (
								await voucherModule.addDataset(chain.contracts, opts.dataset)
							);
							break;
						case voucherModule.WORKERPOOL:
							id = (
								await voucherModule.addWorkerpool(chain.contracts, opts.workerpool)
							);
							break;
						default:
					}

					spinner.info(`${characteristicName} successfully authorized with id (${id})`);
					Object.assign(success, { [characteristicName]: { id: id } });
				} catch (error) {
					failed.push(`${characteristicName}: ${error.message}`);
				}
			};

			if (opts.app) await authorizeCharacteristic(voucherModule.APP);
			if (opts.dataset) await authorizeCharacteristic(voucherModule.DATASET);
			if (opts.workerpool) await authorizeCharacteristic(voucherModule.WORKERPOOL);

			if (failed.length === 0) {
				spinner.succeed('Successfully authorized', {
					raw: success,
				});
			} else {
				spinner.fail(`Failed to authorize: ${pretty(failed)}`, {
					raw: { ...success, fail: failed },
				});
			}
		} catch (error) {
			handleError(error, cli, opts);
		}
	});


const unauthorize = cli.command('unauthorize');
addGlobalOptions(unauthorize);
addWalletLoadOptions(unauthorize);
unauthorize
	.option(...option.chain())
	.option(...option.unauthorizeApp())
	.option(...option.unauthorizeDataset())
	.option(...option.unauthorizeWorkerpool())
	.description(desc.unauthorize(objName))
	.action(async (opts) => {
		await checkUpdate(opts);
		const spinner = Spinner(opts);
		try {
			if (!(opts.app || opts.dataset || opts.workerpool)) {
				throw new Error(
					'No option specified, you should choose one (--app | --dataset | --workerpool)',
				);
			}
			const walletOptions = await computeWalletLoadOptions(opts);
			const txOptions = await computeTxOptions(opts);
			const keystore = Keystore(walletOptions);
			const chain = await loadChain(opts.chain, { txOptions, spinner });
			await connectKeystore(chain, keystore, { txOptions });
			const success = {};
			const failed = [];

			const unauthorizeCharacteristic = async (characteristicName) => {
				try {
					spinner.start(`Unauthorizing ${characteristicName}`);
					let id;
					switch (characteristicName) {
						case voucherModule.APP:
							id = (
								await voucherModule.removeApp(chain.contracts, opts.app)
							).id;
							break;
						case voucherModule.DATASET:
							id = (
								await voucherModule.removeDataset(chain.contracts, opts.dataset)
							).id;
							break;
						case voucherModule.WORKERPOOL:
							id = (
								await voucherModule.removeWorkerpool(chain.contracts, opts.workerpool)
							).id;
							break;
						default:
					}

					spinner.info(`${characteristicName} successfully unauthorized with id (${id})`);
					Object.assign(success, { [characteristicName]: { id: id } });
				} catch (error) {
					failed.push(`${characteristicName}: ${error.message}`);
				}
			};

			if (opts.app) await unauthorizeCharacteristic(voucherModule.APP);
			if (opts.dataset) await unauthorizeCharacteristic(voucherModule.DATASET);
			if (opts.workerpool) await unauthorizeCharacteristic(voucherModule.WORKERPOOL);

			if (failed.length === 0) {
				spinner.succeed('Successfully unauthorized', {
					raw: success,
				});
			} else {
				spinner.fail(`Failed to unauthorize: ${pretty(failed)}`, {
					raw: { ...success, fail: failed },
				});
			}
		} catch (error) {
			handleError(error, cli, opts);
		}
	});

finalizeCli(cli);
