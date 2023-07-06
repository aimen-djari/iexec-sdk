const Debug = require('debug');
const { Buffer } = require('buffer');
const {
	checkEvent,
	bnifyNestedEthersBn,
	cleanRPC,
	NULL_BYTES32,
	NULL_BYTES,
} = require('../utils/utils');
const { bytes32Schema, uint256Schema, throwIfMissing } = require('../utils/validator');
const { ObjectNotFoundError } = require('../utils/errors');
const { wrapCall, wrapSend, wrapWait } = require('../utils/errorWrappers');

const debug = Debug('iexec:task');
const objName = 'task';

const TASK_STATUS_MAP = {
	0: 'UNSET',
	1: 'ACTIVE',
	2: 'REVEALING',
	3: 'COMPLETED',
	4: 'FAILED',
	5: 'INTERRUPTED',
	timeout: 'TIMEOUT',
};

const decodeTaskResult = (results) => {
	try {
		if (results !== NULL_BYTES) {
			const json = JSON.parse(
				Buffer.from(results.substr(2), 'hex').toString('utf8'),
			);
			return json;
		}
	} catch (e) {
		// nothing to do
	}
	return { storage: 'none' };
};

const show = async (
	contracts = throwIfMissing(),
	taskid = throwIfMissing(),
) => {
	try {
		const vTaskId = await bytes32Schema().validate(taskid);
		const { chainId } = contracts;
		const iexecContract = contracts.getIExecContract();
		const task = bnifyNestedEthersBn(
			cleanRPC(await wrapCall(iexecContract.viewTask(vTaskId))),
		);
		if (task.dealid === NULL_BYTES32) {
			throw new ObjectNotFoundError('task', vTaskId, chainId);
		}

		const now = Math.floor(Date.now() / 1000);
		const consensusTimeout = parseInt(task.finalDeadline, 10);
		const taskTimedOut = task.status !== 3 && now >= consensusTimeout;
		const decodedResult = decodeTaskResult(task.results);
		return {
			taskid: vTaskId,
			...task,
			statusName:
				task.status < 3 && taskTimedOut
					? TASK_STATUS_MAP.timeout
					: TASK_STATUS_MAP[task.status],
			taskTimedOut,
			results: decodedResult,
		};
	} catch (error) {
		debug('show()', error);
		throw error;
	}
};

const claim = async (
	contracts = throwIfMissing(),
	taskid = throwIfMissing(),
) => {
	try {
		const vTaskId = await bytes32Schema().validate(taskid);
		const task = await show(contracts, vTaskId);
		const taskStatus = task.status;

		if ([3, 4].includes(taskStatus)) {
			throw Error(
				`Cannot claim a ${objName} having status ${TASK_STATUS_MAP[taskStatus.toString()]
				}`,
			);
		}

		if (!task.taskTimedOut) {
			throw Error(
				`Cannot claim a ${objName} before reaching the consensus deadline date: ${new Date(
					1000 * parseInt(task.finalDeadline, 10),
				)}`,
			);
		}

		const iexecContract = contracts.getIExecContract();
		const claimTx = await wrapSend(
			iexecContract.claim(taskid, contracts.txOptions),
		);

		const claimTxReceipt = await wrapWait(claimTx.wait(contracts.confirms));
		if (!checkEvent('TaskClaimed', claimTxReceipt.events))
			throw Error('TaskClaimed not confirmed');

		return claimTx.hash;
	} catch (error) {
		debug('claim()', error);
		throw error;
	}
};

const extend = async (
	contracts = throwIfMissing(),
	taskid = throwIfMissing(),
	duration = throwIfMissing(),
) => {
	try {
		const vTaskId = await bytes32Schema().validate(taskid);
		const vDuration = await uint256Schema().validate(duration);
		const task = await show(contracts, vTaskId);
		const taskStatus = task.status;

		if ([2, 3, 4].includes(taskStatus)) {
			throw Error(
				`Cannot extend a ${objName} having status ${TASK_STATUS_MAP[taskStatus.toString()]
				}`,
			);
		}

		if (task.taskTimedOut) {
			throw Error(
				`Cannot extend a ${objName} that reached the consensus deadline date: ${new Date(
					1000 * parseInt(task.finalDeadline, 10),
				)}`,
			);
		}

		const iexecContract = contracts.getIExecContract();
		const extendTx = await wrapSend(
			iexecContract.extend(taskid, vDuration, contracts.txOptions),
		);

		const extendTxReceipt = await wrapWait(extendTx.wait(contracts.confirms));
		if (!checkEvent('TaskExtended', extendTxReceipt.events))
			throw Error('TaskExtended not confirmed');

		return extendTx.hash;
	} catch (error) {
		debug('extend()', error);
		throw error;
	}
};

const interrupt = async (
	contracts = throwIfMissing(),
	taskid = throwIfMissing(),
) => {
	try {
		const vTaskId = await bytes32Schema().validate(taskid);
		const task = await show(contracts, vTaskId);
		const taskStatus = task.status;

		if ([2, 3, 4].includes(taskStatus)) {
			throw Error(
				`Cannot interrupt a ${objName} having status ${TASK_STATUS_MAP[taskStatus.toString()]
				}`,
			);
		}

		if (task.taskTimedOut) {
			throw Error(
				`Cannot interrupt a ${objName} that reached the consensus deadline date: ${new Date(
					1000 * parseInt(task.finalDeadline, 10),
				)}`,
			);
		}

		const iexecContract = contracts.getIExecContract();
		const interruptTx = await wrapSend(
			iexecContract.interrupt(taskid, contracts.txOptions),
		);

		const interruptTxReceipt = await wrapWait(interruptTx.wait(contracts.confirms));
		if (!checkEvent('TaskInterrupt', interruptTxReceipt.events))
			throw Error('TaskInterrupt not confirmed');

		return interruptTx.hash;
	} catch (error) {
		debug('interrupt()', error);
		throw error;
	}
};

module.exports = {
	TASK_STATUS_MAP,
	show,
	claim,
	extend,
	interrupt,
};
