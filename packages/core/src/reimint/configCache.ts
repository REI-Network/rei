import { FunctionalBufferMap } from '@rei-network/utils';
import { Block } from '@rei-network/structure';
import { ConfigValues } from './types';
import { ReimintEngine } from './engine';

const maxConfigCacheSize = 128;

export class ConfigCache {
  private cache = new FunctionalBufferMap<ConfigValues>();
  private roots: Buffer[] = [];

  constructor(private engine: ReimintEngine) {}

  /**
   * Set new config values to cache
   * @param root - State root
   * @param values - Config values
   */
  set(root: Buffer, values: ConfigValues) {
    this.roots.push(root);
    this.cache.set(root, values);
    while (this.roots.length > maxConfigCacheSize) {
      this.cache.delete(this.roots.shift()!);
    }
  }

  /**
   * Get config values by state root
   * @param root - State root
   * @returns Config values
   */
  async get(root: Buffer, block: Block) {
    let configValues = this.cache.get(root);
    if (configValues) {
      return configValues;
    }
    const vm = await this.engine.node.getVM(root, block._common);
    configValues = await this.engine.getConfig(vm, block).getConfigValue();
    this.set(root, configValues);
    return configValues;
  }
}
