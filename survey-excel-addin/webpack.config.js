const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const devCerts = require('office-addin-dev-certs');

module.exports = async (env, options) => {
  const dev = options.mode === 'development';

  // Get HTTPS certificates for development
  const httpsOptions = dev ? await devCerts.getHttpsServerOptions() : {};

  return {
    entry: {
      taskpane: './src/taskpane/taskpane.tsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[name][ext]',
          },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: 'taskpane.html',
        template: './src/taskpane/taskpane.html',
        chunks: ['taskpane'],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'assets',
            to: 'assets',
            noErrorOnMissing: true,
          },
          {
            from: 'manifest.xml',
            to: 'manifest.xml',
          },
        ],
      }),
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, 'dist'),
      },
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      server: {
        type: 'https',
        options: httpsOptions,
      },
      port: 3000,
      hot: true,
      allowedHosts: 'all',
    },
    devtool: dev ? 'source-map' : false,
    performance: {
      hints: false,
    },
  };
};
