import { describe, test, expect } from 'bun:test';
import { execa } from 'execa';
import path from 'path';

describe('CLI Integration', () => {
  const binPath = path.resolve(__dirname, '../bin/npm-scan.js');

  test('runs help command via CLI entry point', async () => {
    const result = await execa('node', [binPath, 'help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('npm-scan');
    expect(result.stdout).toContain('Usage: npm-scan');
    expect(result.stdout).toContain('scan');
    expect(result.stdout).toContain('all-installed');
    expect(result.stdout).toContain('generate-report');
  });

  test('handles unknown command with error exit code 1', async () => {
    try {
      await execa('node', [binPath, 'unknown-xyz-command']);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.exitCode).toBe(1);
      expect(error.stderr || error.stdout).toContain('Unknown command: unknown-xyz-command');
    }
  });

  test('runs --help flag via CLI entry point', async () => {
    const result = await execa('node', [binPath, '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: npm-scan');
  });

  // This scans npm-scan's own package.json and does a live network lookup
  // per dependency, so the default 5s test timeout is too tight now that
  // the project has more (dev)dependencies (eslint/prettier tooling, etc).
  const SCAN_TEST_TIMEOUT_MS = 20000;

  test(
    'scans specified local target directory via --url option',
    async () => {
      const projectDir = path.resolve(__dirname, '..');
      const result = await execa('node', [binPath, 'scan', '--url', projectDir, '--direct-only']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Scanning dependencies');
      expect(result.stdout).toContain('Dependency Scan Report');
    },
    SCAN_TEST_TIMEOUT_MS,
  );
});
