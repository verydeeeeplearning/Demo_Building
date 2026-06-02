import { spawn } from 'node:child_process';

const sourceRoots = [
  'agent-context/registry/part-capabilities.sources',
  'agent-context/data/render-footprints.sources',
  'agent-context/electrical/topology-templates.sources',
  'agent-context/data/capability-graph.sources'
];

for (const sourceRoot of sourceRoots) {
  await run('node', ['scripts/buildContextAggregate.mjs', sourceRoot, '--check']);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}
