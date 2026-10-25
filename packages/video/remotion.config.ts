import { Config } from '@remotion/cli/config';

// For `remotion studio`; renders go through src/render.ts, which applies the same settings.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: { ...config.resolve, extensionAlias: { '.js': ['.tsx', '.ts', '.js'] } },
}));
if (process.env['POKEVIDGEN_BROWSER']) Config.setBrowserExecutable(process.env['POKEVIDGEN_BROWSER']);
