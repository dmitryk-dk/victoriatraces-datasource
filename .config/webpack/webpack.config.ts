import CopyWebpackPlugin from 'copy-webpack-plugin';
import ESLintPlugin from 'eslint-webpack-plugin';
import path from 'path';
import ReplaceInFileWebpackPlugin from 'replace-in-file-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { SubresourceIntegrityPlugin } from 'webpack-subresource-integrity';
import { type Configuration, BannerPlugin } from 'webpack';
import LiveReloadPlugin from 'webpack-livereload-plugin';
import VirtualModulesPlugin from 'webpack-virtual-modules';

import { BuildModeWebpackPlugin } from './BuildModeWebpackPlugin';
import { DIST_DIR, SOURCE_DIR } from './constants';
import { getCPConfigVersion, getEntries, getPackageJson, getPluginJson, hasReadme, isWSL } from './utils';

const pluginJson = getPluginJson();
const cpVersion = getCPConfigVersion();

function makePublicPathPlugin(pluginId: string) {
  return new VirtualModulesPlugin({
    'node_modules/grafana-public-path.js': `
import amdMetaModule from 'amd-module';

__webpack_public_path__ =
  amdMetaModule && amdMetaModule.uri
    ? amdMetaModule.uri.slice(0, amdMetaModule.uri.lastIndexOf('/') + 1)
    : 'public/plugins/${pluginId}/';
`,
  });
}

const virtualPublicPath = makePublicPathPlugin(pluginJson.id);
const panelVirtualPublicPath = makePublicPathPlugin('victoriatraces-panel');
const panelGraphVirtualPublicPath = makePublicPathPlugin('victoriatraces-panel-graph');

const config = async (env: Record<string, unknown>): Promise<Configuration[]> => {
  const dsConfig: Configuration = {
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
    },

    context: path.join(process.cwd(), SOURCE_DIR),

    devtool: env.production ? 'source-map' : 'eval-source-map',

    entry: await getEntries(),

    externals: [
      { 'amd-module': 'module' },
      'lodash',
      'jquery',
      'moment',
      'slate',
      'emotion',
      '@emotion/react',
      '@emotion/css',
      'prismjs',
      'slate-plain-serializer',
      '@grafana/slate-react',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-redux',
      'redux',
      'rxjs',
      'react-router',
      'react-router-dom',
      'd3',
      'angular',
      /^@grafana\/ui/i,
      /^@grafana\/runtime/i,
      /^@grafana\/data/i,
      ({ request }: { request?: string }, callback: (err?: Error, result?: string) => void) => {
        const prefix = 'grafana/';
        if (request && request.indexOf(prefix) === 0) {
          return callback(undefined, request.substr(prefix.length));
        }
        callback();
      },
    ],

    experiments: {
      asyncWebAssembly: true,
    },

    mode: env.production ? 'production' : 'development',

    module: {
      rules: [
        {
          test: /src\/(?:.*\/)?module\.tsx?$/,
          use: [
            {
              loader: 'imports-loader',
              options: {
                imports: `side-effects grafana-public-path`,
              },
            },
          ],
        },
        {
          exclude: /(node_modules)/,
          test: /\.[tj]sx?$/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                baseUrl: path.resolve(process.cwd(), SOURCE_DIR),
                target: 'es2015',
                loose: false,
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                  decorators: false,
                  dynamicImport: true,
                },
              },
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.s[ac]ss$/,
          use: ['style-loader', 'css-loader', 'sass-loader'],
        },
        {
          test: /\.(png|jpe?g|gif|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: Boolean(env.production) ? '[hash][ext]' : '[file]',
          },
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)(\?v=\d+\.\d+\.\d+)?$/,
          type: 'asset/resource',
          generator: {
            filename: Boolean(env.production) ? '[hash][ext]' : '[file]',
          },
        },
      ],
    },

    optimization: {
      minimize: Boolean(env.production),
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: (_: unknown, { type, value }: { type: string; value: string }) =>
                type === 'comment2' && value.trim().startsWith('[create-plugin]'),
            },
            compress: {
              drop_console: ['log', 'info'],
            },
          },
        }),
      ],
    },

    output: {
      clean: {
        keep: new RegExp(`(.*?_(amd64|arm(64)?)(.exe)?|go_plugin_build_manifest)`),
      },
      filename: '[name].js',
      chunkFilename: env.production ? '[name].js?_cache=[contenthash]' : '[name].js',
      library: {
        type: 'amd',
      },
      path: path.resolve(process.cwd(), DIST_DIR),
      publicPath: `public/plugins/${pluginJson.id}/`,
      uniqueName: pluginJson.id,
      crossOriginLoading: 'anonymous',
    },

    plugins: [
      new BuildModeWebpackPlugin(),
      virtualPublicPath,
      new BannerPlugin({
        banner: '/* [create-plugin] version: ' + cpVersion + ' */',
        raw: true,
        entryOnly: true,
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: hasReadme() ? 'README.md' : '../README.md', to: '.', force: true, noErrorOnMissing: true },
          { from: 'plugin.json', to: '.' },
          { from: '../LICENSE', to: '.', noErrorOnMissing: true },
          { from: '../CHANGELOG.md', to: '.', force: true, noErrorOnMissing: true },
          { from: '**/*.json', to: '.' },
          { from: '**/*.svg', to: '.', noErrorOnMissing: true },
          { from: '**/*.png', to: '.', noErrorOnMissing: true },
          { from: '**/*.html', to: '.', noErrorOnMissing: true },
          { from: 'img/**/*', to: '.', noErrorOnMissing: true },
          { from: 'static/**/*', to: '.', noErrorOnMissing: true },
        ],
      }),
      new ReplaceInFileWebpackPlugin([
        {
          dir: DIST_DIR,
          files: ['plugin.json', 'README.md'],
          rules: [
            { search: /\%VERSION\%/g, replace: getPackageJson().version },
            { search: /\%TODAY\%/g, replace: new Date().toISOString().substring(0, 10) },
            { search: /\%PLUGIN_ID\%/g, replace: pluginJson.id },
          ],
        },
      ]),
      new SubresourceIntegrityPlugin({
        hashFuncNames: ['sha256'],
      }),
      ...(env.development
        ? [
            new LiveReloadPlugin(),
            new ESLintPlugin({
              extensions: ['.ts', '.tsx'],
              lintDirtyModulesOnly: Boolean(env.development),
            }),
          ]
        : []),
    ],

    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      modules: [path.resolve(process.cwd(), 'src'), 'node_modules'],
      unsafeCache: true,
    },
  };

  // --- Panel plugin config ---
  const panelConfig: Configuration = {
    ...dsConfig,
    name: 'panel',
    cache: {
      type: 'filesystem',
      name: 'panel-cache',
      buildDependencies: { config: [__filename] },
    },
    context: path.join(process.cwd(), 'src', 'panel'),
    entry: { module: path.resolve(process.cwd(), 'src', 'panel', 'module.ts') },
    output: {
      ...dsConfig.output,
      clean: false,
      path: path.resolve(process.cwd(), 'plugins', 'victoriatraces-panel'),
      publicPath: `public/plugins/victoriatraces-panel/`,
      uniqueName: 'victoriatraces-panel',
    },
    plugins: [
      panelVirtualPublicPath,
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(process.cwd(), 'src', 'panel', 'plugin.json'), to: '.' },
          { from: path.resolve(process.cwd(), 'plugins', 'victoriatraces-datasource', 'img'), to: 'img', noErrorOnMissing: true },
        ],
      }),
      ...(env.development ? [new LiveReloadPlugin()] : []),
    ],
  };

  // --- Panel-graph plugin config ---
  const panelGraphConfig: Configuration = {
    ...dsConfig,
    name: 'panel-graph',
    cache: {
      type: 'filesystem',
      name: 'panel-graph-cache',
      buildDependencies: { config: [__filename] },
    },
    context: path.join(process.cwd(), 'src', 'panel-graph'),
    entry: { module: path.resolve(process.cwd(), 'src', 'panel-graph', 'module.ts') },
    output: {
      ...dsConfig.output,
      clean: false,
      path: path.resolve(process.cwd(), 'plugins', 'victoriatraces-panel-graph'),
      publicPath: `public/plugins/victoriatraces-panel-graph/`,
      uniqueName: 'victoriatraces-panel-graph',
    },
    plugins: [
      panelGraphVirtualPublicPath,
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(process.cwd(), 'src', 'panel-graph', 'plugin.json'), to: '.' },
          { from: path.resolve(process.cwd(), 'plugins', 'victoriatraces-datasource', 'img'), to: 'img', noErrorOnMissing: true },
        ],
      }),
      ...(env.development ? [new LiveReloadPlugin()] : []),
    ],
  };

  if (isWSL()) {
    dsConfig.watchOptions = { poll: 3000, ignored: /node_modules/ };
    panelConfig.watchOptions = { poll: 3000, ignored: /node_modules/ };
    panelGraphConfig.watchOptions = { poll: 3000, ignored: /node_modules/ };
  }

  return [dsConfig, panelConfig, panelGraphConfig];
};

export default config;
