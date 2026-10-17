import { spawn } from 'node:child_process';

const commands = [
  ['client', ['node_modules/vite/bin/vite.js', '--config', 'vite.config.js', '--host', '0.0.0.0']],
  ['server', ['server/index.js']],
];
const children = commands.map(([name, file]) => {
  const child = spawn(process.execPath, file, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${name} exited with code ${code}`);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
