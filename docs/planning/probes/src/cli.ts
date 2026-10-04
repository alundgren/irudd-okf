import { Console, Effect } from 'effect';
import { Command } from 'effect/cli';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { getAsset, isSea } from 'node:sea';
import { readFileSync } from 'node:fs';

const asset = () => isSea()
  ? getAsset('viewer.html', 'utf8')
  : readFileSync('web-dist/index.html', 'utf8');
const context = Command.make('context', {}, () =>
  Console.log(JSON.stringify({ probe: true, effect: '4.0.0', embeddedViewer: asset().includes('Foldkit feasibility') })),
);
const root = Command.make('okf-feasibility').pipe(Command.withSubcommands([context]));
NodeRuntime.runMain(Command.run(root, { version: '0.0.0-probe' }).pipe(Effect.provide(NodeServices.layer)));
