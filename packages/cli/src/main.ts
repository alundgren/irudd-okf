import { Cause, Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { createStore, initializeBundle, registerBundle, resolveContext, unregisterBundle } from '../../core/src/index.ts';
import { OkfError, VERSION, type Store } from '../../core/src/contracts.ts';
import { commands, discover } from './registry.ts';
import { GitMemory } from './git.ts';
import { runProcess } from './process.ts';
import { serve } from './server.ts';
import { installSkill } from './skill.ts';

const bool = (name: string) => Flag.Boolean(name).pipe(Flag.withDefault(false));
const opt = (name: string) => Flag.String(name).pipe(Flag.optional);
const print = (value: unknown) => Console.log(JSON.stringify(value));
const scope = opt('scope');
const root = Command.make('irudd-okf').pipe(Command.withSharedFlags({
  config: opt('config'),
  bundle: Flag.String('bundle').pipe(Flag.between(0, 100)),
}), Command.withDescription('Scoped OKF memory in ordinary files. CLI output is JSON; wiki and graph run locally.'));
const withStore = <A, E, R>(f: (store: Store) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const args = yield* root;
  const explicitBundles = args.bundle.length ? args.bundle.map(value => {
    const separator = value.indexOf('=');
    if (separator < 1) throw new OkfError('INVALID_INPUT', 'Use --bundle NAME=ROOT.');
    return { name: value.slice(0, separator), root: resolve(value.slice(separator + 1)) };
  }) : undefined;
  const context = yield* resolveContext({ configPath: Option.getOrUndefined(args.config), explicitBundles });
  return yield* f(createStore(context));
});
const contextCommand = Command.make('context', {}, () => withStore(store => print(store.context)));
const initCommand = Command.make('init', { root: Argument.String('root').pipe(Argument.withDefault('.okf')) }, args => initializeBundle(resolve(args.root)).pipe(Effect.flatMap(print)));
const bundleCommand = Command.make('bundle').pipe(Command.withSubcommands([
  Command.make('list', {}, () => withStore(store => print(store.context))),
  Command.make('add', { name: Argument.String('name'), root: Argument.String('root'), activate: bool('activate') }, args => Effect.gen(function* () { const flags = yield* root; yield* registerBundle(args.name, resolve(args.root), { configPath: Option.getOrUndefined(flags.config), activate: args.activate, personal: true }).pipe(Effect.flatMap(print)); })),
  Command.make('remove', { name: Argument.String('name') }, args => Effect.gen(function* () { const flags = yield* root; yield* unregisterBundle(args.name, { configPath: Option.getOrUndefined(flags.config) }).pipe(Effect.flatMap(print)); })),
]));
const searchCommand = Command.make('search', { query: Argument.String('query'), scope, limit: Flag.Int('limit').pipe(Flag.withDefault(10)), offset: Flag.Int('offset').pipe(Flag.withDefault(0)) }, args => withStore(store => store.search(args.query, { bundle: Option.getOrUndefined(args.scope), limit: args.limit, offset: args.offset }).pipe(Effect.flatMap(print))));
const readCommand = Command.make('read', { bundle: Argument.String('bundle'), path: Argument.String('path') }, args => withStore(store => store.read(args.bundle, args.path).pipe(Effect.flatMap(print))));
const indexCommand = Command.make('index', { bundle: Argument.String('bundle'), path: Argument.String('path').pipe(Argument.optional) }, args => withStore(store => store.index(args.bundle, Option.getOrUndefined(args.path)).pipe(Effect.flatMap(print))));
const writeCommand = Command.make('write', { bundle: Argument.String('bundle'), path: Argument.String('path'), file: Flag.String('file'), expected: Flag.String('expected'), authorizePersonal: bool('authorize-personal') }, args => withStore(store => Effect.gen(function* () {
  const raw = yield* Effect.tryPromise({ try: () => readFile(resolve(args.file), 'utf8'), catch: error => new OkfError('FILE_READ_FAILED', `Could not read ${args.file}.`, { cause: String(error) }) });
  yield* store.save({ bundle: args.bundle, path: args.path, raw, expectedHash: args.expected === 'new' ? null : args.expected, authorizePersonal: args.authorizePersonal }).pipe(Effect.flatMap(print));
})));
const deleteCommand = Command.make('delete', { bundle: Argument.String('bundle'), path: Argument.String('path'), expected: Flag.String('expected'), authorizePersonal: bool('authorize-personal') }, args => withStore(store => store.remove({ bundle: args.bundle, path: args.path, expectedHash: args.expected, authorizePersonal: args.authorizePersonal }).pipe(Effect.flatMap(print))));
const renameCommand = Command.make('rename', { bundle: Argument.String('bundle'), path: Argument.String('path'), newPath: Argument.String('new-path'), expected: Flag.String('expected'), updateLinks: bool('update-links'), authorizePersonal: bool('authorize-personal') }, args => withStore(store => store.rename({ bundle: args.bundle, path: args.path, newPath: args.newPath, expectedHash: args.expected, updateLinks: args.updateLinks, authorizePersonal: args.authorizePersonal }).pipe(Effect.flatMap(print))));
const validateCommand = (lint: boolean) => Command.make(lint ? 'lint' : 'validate', { scope }, args => withStore(store => Effect.gen(function* () { const result = yield* store.validate({ bundle: Option.getOrUndefined(args.scope), lint }); yield* print(result); if (result.errors) process.exitCode = 3; })));
const graphCommand = Command.make('graph', { scope, path: opt('path'), depth: Flag.Int('depth').pipe(Flag.withDefault(1)), limit: Flag.Int('limit').pipe(Flag.withDefault(80)) }, args => withStore(store => store.graph({ bundle: Option.getOrUndefined(args.scope), path: Option.getOrUndefined(args.path), depth: args.depth, limit: args.limit }).pipe(Effect.flatMap(print))));
const serveCommand = Command.make('serve', { port: Flag.Int('port').pipe(Flag.withDefault(3210)) }, args => withStore(store => serve(store, args.port)));
const gitCommand = Command.make('git').pipe(Command.withSubcommands([
  Command.make('status', { bundle: Argument.String('bundle') }, args => withStore(store => new GitMemory(store.context).status(args.bundle).pipe(Effect.flatMap(print)))),
  Command.make('preview', { bundle: Argument.String('bundle'), paths: Flag.String('paths'), base: opt('base') }, args => withStore(store => new GitMemory(store.context).preview(args.bundle, args.paths.split(','), Option.getOrUndefined(args.base)).pipe(Effect.flatMap(print)))),
  Command.make('pr', { token: Argument.String('token'), title: Flag.String('title'), body: opt('body') }, args => withStore(store => new GitMemory(store.context).publish(args.token, args.title, Option.getOrUndefined(args.body)).pipe(Effect.flatMap(print)))),
]));
const cliCommand = Command.make('cli').pipe(Command.withSubcommands([
  Command.make('search', { query: Argument.String('query') }, args => print({ version: 1, results: discover(args.query) })),
  Command.make('schema', { command: Argument.String('command').pipe(Argument.variadic({ min: 1 })) }, args => { const name = args.command.join(' '); const item = commands.find(value => value.command === name); return item ? print({ version: 1, ...item }) : Effect.fail(new OkfError('COMMAND_NOT_FOUND', `Unknown command ${name}. Use cli search.`)); }),
]));
const skillCommand = Command.make('skill').pipe(Command.withSubcommands([Command.make('install', { directory: Argument.String('directory') }, args => installSkill(args.directory).pipe(Effect.flatMap(print)))]));
const licensesCommand = Command.make('licenses', {}, () => Effect.tryPromise({ try: async () => ({ version: 1, text: isSea() ? getAsset('licenses.txt', 'utf8') : await readFile('THIRD_PARTY_NOTICES.txt', 'utf8') }), catch: error => new OkfError('FILE_READ_FAILED', 'Could not read included license notices.', { cause: String(error) }) }).pipe(Effect.flatMap(print)));
const doctorCommand = Command.make('doctor', {}, () => withStore(store => Effect.gen(function* () {
  const git = yield* runProcess('git', ['--version'], store.context.cwd).pipe(Effect.catch(() => Effect.succeed(null)));
  const gh = yield* runProcess('gh', ['--version'], store.context.cwd).pipe(Effect.catch(() => Effect.succeed(null)));
  yield* print({ version: 1, productVersion: VERSION, node: process.version, nativeExecutable: isSea(), context: store.context, git: git?.exitCode === 0, gh: gh?.exitCode === 0, validation: yield* store.validate() });
})));
export const app = root.pipe(Command.withSubcommands([contextCommand, initCommand, bundleCommand, searchCommand, readCommand, indexCommand, writeCommand, deleteCommand, renameCommand, validateCommand(false), validateCommand(true), graphCommand, serveCommand, gitCommand, cliCommand, skillCommand, licensesCommand, doctorCommand]));
export const renderError = (error: unknown) => Effect.sync(() => {
  const value = error instanceof OkfError ? error : new OkfError('INVALID_ARGUMENTS', String(error));
  process.stderr.write(`${JSON.stringify({ version: 1, error: { code: value.code, message: value.message, details: value.details } })}\n`);
  process.exitCode = /CONFLICT/.test(value.code) ? 4 : /GIT|PR_|PROCESS|REMOTE/.test(value.code) ? 5 : 2;
});
NodeRuntime.runMain(Command.run(app, { version: VERSION, renderErrors: false }).pipe(Effect.provide(NodeServices.layer), Effect.catchCause(cause => renderError(Cause.squash(cause)))));
