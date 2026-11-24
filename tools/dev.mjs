import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const option = name => {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const host = option('--host');
const port = option('--port');
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, ...(host ? { HOST: host } : {}), ...(port ? { PORT: port } : {}) }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
