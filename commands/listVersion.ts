import { version } from '../package.json';

const version_cache = version;

export function listVersion() {
  console.log('Current version: ', version_cache);
}
