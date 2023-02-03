import IExecModule from './IExecModule';
import {
  createCategory,
  showCategory,
  countCategory,
} from '../common/protocol/category';
import { getTimeoutRatio } from '../common/protocol/configuration';

export default class IExecHubModule extends IExecModule {
  constructor(...args) {
    super(...args);

    this.createCategory = async (category) =>
      createCategory(await this.config.resolveContractsClient(), category);
    this.showCategory = async (index) =>
      showCategory(await this.config.resolveContractsClient(), index);
    this.countCategory = async () =>
      countCategory(await this.config.resolveContractsClient());
    this.getTimeoutRatio = async () =>
      getTimeoutRatio(await this.config.resolveContractsClient());
  }
}
