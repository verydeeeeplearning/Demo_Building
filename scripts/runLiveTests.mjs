import { spawnSync } from 'node:child_process';

const result = spawnSync('tsx', ['--test', 'tests/unit/*.live.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    H_EDUWARE_RUN_LIVE_TESTS: '1',
    H_EDUWARE_LIVE_CATEGORY_LIMIT: process.env.H_EDUWARE_LIVE_CATEGORY_LIMIT ?? '5',
    H_EDUWARE_LIVE_SAMPLE: process.env.H_EDUWARE_LIVE_SAMPLE ?? '4'
  }
});

process.exit(result.status ?? 1);
