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
import {
  CHARTS_PANEL_DIST_DIR,
  CHARTS_PANEL_PLUGIN_ID,
  DIST_DIR,
  NODEGRAPH_PANEL_DIST_DIR,
  NODEGRAPH_PANEL_PLUGIN_ID,
  PANEL_DIST_DIR,
  PANEL_PLUGIN_ID,
  SOURCE_DIR,
} from './constants';
import { getCPConfigVersion, getPackageJson, getPluginJson, hasReadme, isWSL } from './utils';

const pluginJson = getPluginJson();
const cpVersion = getCPConfigVersion();

// `publicPathSegment` is the plugin's directory under public/plugins/.
function makePublicPathPlugin(publicPathSegment: string) {
  return new VirtualModulesPlugin({
    'node_modules/grafana-public-path.js': `
import amdMetaModule from 'amd-module';

__webpack_public_path__ =
  amdMetaModule && amdMetaModule.uri
    ? amdMetaModule.uri.slice(0, amdMetaModule.uri.lastIndexOf('/') + 1)
    : 'public/plugins/${publicPathSegment}/';
`,
  });
}

const DS_PUBLIC_PATH = pluginJson.id;
const PANEL_PUBLIC_PATH = PANEL_PLUGIN_ID;
const NODEGRAPH_PANEL_PUBLIC_PATH = NODEGRAPH_PANEL_PLUGIN_ID;
const CHARTS_PANEL_PUBLIC_PATH = CHARTS_PANEL_PLUGIN_ID;

// The panel plugins live under src/ but ship as their own plugin directories, so
// the datasource's recursive copies must skip them.
const NESTED_SOURCE_IGNORE = ['**/panel/**', '**/panel-graph/**', '**/panel-charts/**'];

const virtualPublicPath = makePublicPathPlugin(DS_PUBLIC_PATH);
const panelVirtualPublicPath = makePublicPathPlugin(PANEL_PUBLIC_PATH);
const panelGraphVirtualPublicPath = makePublicPathPlugin(NODEGRAPH_PANEL_PUBLIC_PATH);
const panelChartsVirtualPublicPath = makePublicPathPlugin(CHARTS_PANEL_PUBLIC_PATH);

const config = async (env: Record<string, unknown>): Promise<Configuration[]> => {
  const dsConfig: Configuration = {
    name: 'datasource',

    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
    },

    context: path.join(process.cwd(), SOURCE_DIR),

    devtool: env.production ? 'source-map' : 'eval-source-map',

    // Explicit rather than globbed: a `src/**/plugin.json` glob also picks up the
    // panel manifests and would build their modules into the datasource dist too.
    entry: { module: path.resolve(process.cwd(), SOURCE_DIR, 'module.tsx') },

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
      publicPath: `public/plugins/${DS_PUBLIC_PATH}/`,
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
          { from: 'plugin.json', to: '.' },
          {
            from: hasReadme() ? 'README.md' : '../README.md',
            to: '.',
            force: true,
            noErrorOnMissing: true,
          },
          { from: '../LICENSE', to: '.', noErrorOnMissing: true },
          { from: '../CHANGELOG.md', to: '.', force: true, noErrorOnMissing: true },
          // Skip the panel sources; their manifests belong to their own plugins.
          { from: '**/*.json', to: '.', globOptions: { ignore: NESTED_SOURCE_IGNORE } },
          { from: '**/*.svg', to: '.', noErrorOnMissing: true, globOptions: { ignore: NESTED_SOURCE_IGNORE } },
          { from: '**/*.png', to: '.', noErrorOnMissing: true, globOptions: { ignore: NESTED_SOURCE_IGNORE } },
          { from: '**/*.html', to: '.', noErrorOnMissing: true, globOptions: { ignore: NESTED_SOURCE_IGNORE } },
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
    context: path.join(process.cwd(), SOURCE_DIR, 'panel'),
    entry: { module: path.resolve(process.cwd(), SOURCE_DIR, 'panel', 'module.ts') },
    output: {
      ...dsConfig.output,
      clean: false,
      path: path.resolve(process.cwd(), PANEL_DIST_DIR),
      publicPath: `public/plugins/${PANEL_PUBLIC_PATH}/`,
      uniqueName: PANEL_PLUGIN_ID,
    },
    plugins: [
      panelVirtualPublicPath,
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'panel', 'plugin.json'), to: '.' },
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'img'), to: 'img', noErrorOnMissing: true },
        ],
      }),
      ...(env.development ? [new LiveReloadPlugin()] : []),
    ],
  };

  // --- Node graph panel plugin config ---
  const panelGraphConfig: Configuration = {
    ...dsConfig,
    name: 'panel-graph',
    cache: {
      type: 'filesystem',
      name: 'panel-graph-cache',
      buildDependencies: { config: [__filename] },
    },
    context: path.join(process.cwd(), SOURCE_DIR, 'panel-graph'),
    entry: { module: path.resolve(process.cwd(), SOURCE_DIR, 'panel-graph', 'module.ts') },
    output: {
      ...dsConfig.output,
      clean: false,
      path: path.resolve(process.cwd(), NODEGRAPH_PANEL_DIST_DIR),
      publicPath: `public/plugins/${NODEGRAPH_PANEL_PUBLIC_PATH}/`,
      uniqueName: NODEGRAPH_PANEL_PLUGIN_ID,
    },
    plugins: [
      panelGraphVirtualPublicPath,
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'panel-graph', 'plugin.json'), to: '.' },
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'img'), to: 'img', noErrorOnMissing: true },
        ],
      }),
      ...(env.development ? [new LiveReloadPlugin()] : []),
    ],
  };

  // --- Charts panel plugin config ---
  const panelChartsConfig: Configuration = {
    ...dsConfig,
    name: 'panel-charts',
    cache: {
      type: 'filesystem',
      name: 'panel-charts-cache',
      buildDependencies: { config: [__filename] },
    },
    context: path.join(process.cwd(), SOURCE_DIR, 'panel-charts'),
    entry: { module: path.resolve(process.cwd(), SOURCE_DIR, 'panel-charts', 'module.ts') },
    output: {
      ...dsConfig.output,
      clean: false,
      path: path.resolve(process.cwd(), CHARTS_PANEL_DIST_DIR),
      publicPath: `public/plugins/${CHARTS_PANEL_PUBLIC_PATH}/`,
      uniqueName: CHARTS_PANEL_PLUGIN_ID,
    },
    plugins: [
      panelChartsVirtualPublicPath,
      new CopyWebpackPlugin({
        patterns: [
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'panel-charts', 'plugin.json'), to: '.' },
          { from: path.resolve(process.cwd(), SOURCE_DIR, 'img'), to: 'img', noErrorOnMissing: true },
        ],
      }),
      ...(env.development ? [new LiveReloadPlugin()] : []),
    ],
  };

  if (isWSL()) {
    const watchOptions = { poll: 3000, ignored: /node_modules/ };
    dsConfig.watchOptions = watchOptions;
    panelConfig.watchOptions = watchOptions;
    panelGraphConfig.watchOptions = watchOptions;
    panelChartsConfig.watchOptions = watchOptions;
  }

  return [dsConfig, panelConfig, panelGraphConfig, panelChartsConfig];
};

export default config;
