import { Effect, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { NodeServices } from '@effect/platform-node';
import { OkfError, type Operation } from '../../core/src/contracts.ts';

export interface ProcessResult { stdout: string; stderr: string; exitCode: number }
export const runProcess = (command: string, args: string[], cwd: string): Operation<ProcessResult> => Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd }));
  const [out, err, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.runCollect),
    handle.stderr.pipe(Stream.decodeText(), Stream.runCollect),
    handle.exitCode,
  ], { concurrency: 'unbounded' });
  return { stdout: Array.from(out).join(''), stderr: Array.from(err).join(''), exitCode: Number(exitCode) };
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.mapError(error => new OkfError('PROCESS_FAILED', `Could not run ${command}`, { cause: String(error) })));

export const checkedProcess = (command: string, args: string[], cwd: string): Operation<string> => runProcess(command, args, cwd).pipe(Effect.flatMap(result => result.exitCode === 0
  ? Effect.succeed(result.stdout.trimEnd())
  : Effect.fail(new OkfError('PROCESS_FAILED', `${command} exited with ${result.exitCode}`, { stderr: result.stderr, exitCode: result.exitCode }))));
