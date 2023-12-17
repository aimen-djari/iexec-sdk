const Debug = require('debug');
const { Buffer } = require('buffer');
const BN = require('bn.js');
const {
	ethersBnToBn,
	checkEvent,
	bnifyNestedEthersBn,
	getEventFromLogs,
	cleanRPC,
	NULL_BYTES32,
	NULL_BYTES,
} = require('../utils/utils');
const {
	addressSchema,
	uint256Schema,
	bytes32Schema,
	signedApporderSchema,
	signedDatasetorderSchema,
	signedWorkerpoolorderSchema,
	signedRequestorderSchema,
	throwIfMissing
} = require('../utils/validator');
const { ObjectNotFoundError } = require('../utils/errors');
const { wrapCall, wrapSend, wrapWait } = require('../utils/errorWrappers');
const order = require('./order');

const debug = Debug('voucher');
const objName = 'voucher';

const APP = 'app';
const DATASET = 'dataset';
const WORKERPOOL = 'workerpool';


const deposit = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
	amount = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const vAmount = await uint256Schema().validate(amount);
		const iexecContract = contracts.getIExecContract();
		const tx = await wrapSend(
			iexecContract.depositVoucherFor(
				vAddress,
				vAmount,
				contracts.txOptions,
			),
		);
		const txReceipt = await wrapWait(tx.wait(contracts.confirms));
		const depositEvent = 'Deposit';
		if (!checkEvent(depositEvent, txReceipt.events))
			throw Error(`${depositEvent} not confirmed`);
		const { beneficiary, transferredAmount } = getEventFromLogs(
			depositEvent,
			txReceipt.events,
		).args;
		return { beneficiary, transferredAmount: transferredAmount, txHash: tx.hash };

	} catch (error) {
		debug('deposit()', error);
		throw error;
	}
};

const requestTask = async (
	contracts = throwIfMissing(),
	appOrder = throwIfMissing(),
	datasetOrder = NULL_DATASETORDER,
	workerpoolOrder = throwIfMissing(),
	requestOrder = throwIfMissing(),
) => {
	try {
		const [vAppOrder, vDatasetOrder, vWorkerpoolOrder, vRequestOrder] =
			await Promise.all([
				signedApporderSchema().validate(appOrder),
				signedDatasetorderSchema().validate(datasetOrder),
				signedWorkerpoolorderSchema().validate(workerpoolOrder),
				signedRequestorderSchema().validate(requestOrder),
			]);

		// check matchability
		const matchableVolume = await order.getMatchableVolume(
			contracts,
			vAppOrder,
			vDatasetOrder,
			vWorkerpoolOrder,
			vRequestOrder,
		);

		const workerpoolPrice = new BN(vWorkerpoolOrder.workerpoolprice);
		const appPrice = new BN(vAppOrder.appprice);
		const datasetPrice = new BN(vDatasetOrder.datasetprice);

		// account stake check
		const checkRequesterSolvabilityAsync = async () => {
			const costPerTask = appPrice.add(datasetPrice).add(workerpoolPrice);
			const totalCost = costPerTask.mul(matchableVolume);
			const balance = await show(contracts, vRequestOrder.requester);
			if (balance.lt(costPerTask)) {
				throw new Error(
					`Cost per task (${costPerTask}) is greather than requester account stake (${balance}). Orders can't be matched. If you are the requester, you should deposit to top up your account`,
				);
			}
			if (balance.lt(totalCost)) {
				throw new Error(
					`Total cost for ${matchableVolume} tasks (${totalCost}) is greather than requester account stake (${balance}). Orders can't be matched. If you are the requester, you should deposit to top up your account or reduce your requestorder volume`,
				);
			}
		};

		await checkRequesterSolvabilityAsync();

		const appOrderStruct = order.signedOrderToStruct(order.APP_ORDER, vAppOrder);
		const datasetOrderStruct = order.signedOrderToStruct(
			order.DATASET_ORDER,
			vDatasetOrder,
		);
		const workerpoolOrderStruct = order.signedOrderToStruct(
			order.WORKERPOOL_ORDER,
			vWorkerpoolOrder,
		);
		const requestOrderStruct = order.signedOrderToStruct(
			order.REQUEST_ORDER,
			vRequestOrder,
		);
		
		console.log(appOrderStruct);
		console.log(datasetOrderStruct);
		console.log(workerpoolOrderStruct);
		console.log(requestOrderStruct);
		
		const iexecContract = contracts.getIExecContract();
		const tx = await wrapSend(
			iexecContract.requestTask(
				appOrderStruct,
				datasetOrderStruct,
				workerpoolOrderStruct,
				requestOrderStruct,
				contracts.txOptions
			),
		);
		const txReceipt = await wrapWait(tx.wait(contracts.confirms));


		const matchEvent = 'OrdersMatched';
		const taskRequested = 'TaskRequested';
		if (!checkEvent(taskRequested, txReceipt.events))
			throw Error(`${taskRequested} not confirmed`);

		if (!checkEvent(matchEvent, txReceipt.events))
			throw Error(`${matchEvent} not confirmed`);
		const { dealid, volume } = getEventFromLogs(
			matchEvent,
			txReceipt.events,
		).args;

		return { dealid, volume: ethersBnToBn(volume), txHash: tx.hash };
	} catch (error) {
		debug('requestTask() error', error);
		throw error;
	}
};


const show = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const balance = await wrapCall(iexecContract.voucherBalanceOf(vAddress));

		return ethersBnToBn(balance);
	} catch (error) {
		debug('show()', error);
		throw error;
	}
};

const countApps = async (
	contracts = throwIfMissing(),
) => {
	try {
		const iexecContract = contracts.getIExecContract();
		const apps = await wrapCall(iexecContract.countAuthorizedApps());

		return ethersBnToBn(apps);
	} catch (error) {
		debug('countApps()', error);
		throw error;
	}
};

const countDatasets = async (
	contracts = throwIfMissing(),
) => {
	try {
		const iexecContract = contracts.getIExecContract();
		const datasets = await wrapCall(iexecContract.countAuthorizedDatasets());

		return ethersBnToBn(datasets);
	} catch (error) {
		debug('countDatasets()', error);
		throw error;
	}
};

const countWorkerpools = async (
	contracts = throwIfMissing(),
) => {
	try {
		const iexecContract = contracts.getIExecContract();
		const workerpools = await wrapCall(iexecContract.countAuthorizedWorkerpools());

		return ethersBnToBn(workerpools);
	} catch (error) {
		debug('countWorkerpools()', error);
		throw error;
	}
};

const viewApp = async (
	contracts = throwIfMissing(),
	id = throwIfMissing(),
) => {
	try {
		const vId = await uint256Schema().validate(id);
		const iexecContract = contracts.getIExecContract();
		const address = await wrapCall(iexecContract.viewAuthorizedApp(vId));

		return address;
	} catch (error) {
		debug('viewApp()', error);
		throw error;
	}
};

const viewDataset = async (
	contracts = throwIfMissing(),
	id = throwIfMissing(),
) => {
	try {
		const vId = await uint256Schema().validate(id);
		const iexecContract = contracts.getIExecContract();
		const address = await wrapCall(iexecContract.viewAuthorizedDataset(vId));

		return address;
	} catch (error) {
		debug('viewDataset()', error);
		throw error;
	}
};

const viewWorkerpool = async (
	contracts = throwIfMissing(),
	id = throwIfMissing(),
) => {
	try {
		const vId = await uint256Schema().validate(id);
		const iexecContract = contracts.getIExecContract();
		const address = await wrapCall(iexecContract.viewAuthorizedWorkerpool(vId));

		return address;
	} catch (error) {
		debug('viewWorkerpool()', error);
		throw error;
	}
};

const addApp = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		console.log(vAddress);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.authorizeApp(vAddress));

		return {
			id: id,
		};
	} catch (error) {
		debug('addApp()', error);
		throw error;
	}
};

const addDataset = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.authorizeDataset(vAddress));

		return {
			id: id,
		};
	} catch (error) {
		debug('addDataset()', error);
		throw error;
	}
};

const addWorkerpool = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.authorizeWorkerpool(vAddress));

		return {
			id: id,
		};
	} catch (error) {
		debug('addWorkerpool()', error);
		throw error;
	}
};


const removeApp = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.unAuthorizeApp(vAddress));

		return id;
	} catch (error) {
		debug('removeApp()', error);
		throw error;
	}
};

const removeDataset = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.unAuthorizeDataset(vAddress));

		return id;
	} catch (error) {
		debug('removeDataset()', error);
		throw error;
	}
};

const removeWorkerpool = async (
	contracts = throwIfMissing(),
	address = throwIfMissing(),
) => {
	try {
		const vAddress = await addressSchema().validate(address);
		const iexecContract = contracts.getIExecContract();
		const id = await wrapCall(iexecContract.unAuthorizeWorkerpool(vAddress));

		return id;
	} catch (error) {
		debug('removeWorkerpool()', error);
		throw error;
	}
};
module.exports = {
	deposit,
	requestTask,
	show,
	countApps,
	countDatasets,
	countWorkerpools,
	viewApp,
	viewDataset,
	viewWorkerpool,
	addApp,
	addDataset,
	addWorkerpool,
	removeApp,
	removeDataset,
	removeWorkerpool,
	APP,
	DATASET,
	WORKERPOOL,
};
