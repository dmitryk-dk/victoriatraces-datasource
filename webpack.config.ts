import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig from './.config/webpack/webpack.config';

const config = async (env: Record<string, unknown>): Promise<Configuration[]> => {
  const configs = await grafanaConfig(env);

  // Apply the Go backend binary keep-pattern override only to the datasource config (first entry)
  const [dsConfig, ...rest] = configs;

  const mergedDsConfig = merge(dsConfig, {
    output: {
      ...dsConfig.output,
      // Preserve Go backend binaries when webpack cleans the dist directory.
      clean: {
        keep: new RegExp(`(.*?_(amd64|arm(64)?|s390x)(.exe)?|go_plugin_build_manifest)`),
      },
    },
  });

  return [mergedDsConfig, ...rest];
};

export default config;
