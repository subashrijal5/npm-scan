import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  detectPackageManager,
  parseNpmLockfile,
  parsePnpmLockfile,
  parseYarnLockfile,
  parseBunLockfile,
  parseCliArgs,
  isGithubUrl,
  normalizeGithubUrl,
  resolveTarget
} from '../src/utils';

describe('utils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-scan-utils-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('isGithubUrl & normalizeGithubUrl', () => {
    test('identifies GitHub repository URLs correctly', () => {
      expect(isGithubUrl('https://github.com/owner/repo')).toBe(true);
      expect(isGithubUrl('https://github.com/owner/repo.git')).toBe(true);
      expect(isGithubUrl('git@github.com:owner/repo.git')).toBe(true);
      expect(isGithubUrl('github.com/owner/repo')).toBe(true);

      expect(isGithubUrl('file:///path/to/project')).toBe(false);
      expect(isGithubUrl('/path/to/project')).toBe(false);
      expect(isGithubUrl('./relative/path')).toBe(false);
    });

    test('normalizes GitHub URLs', () => {
      expect(normalizeGithubUrl('github.com/owner/repo')).toBe('https://github.com/owner/repo');
      expect(normalizeGithubUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
      expect(normalizeGithubUrl('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git');
    });
  });

  describe('resolveTarget', () => {
    test('resolves local directory path with package.json', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

      const ctx = await resolveTarget(tmpDir);
      expect(ctx.isTemporary).toBe(false);
      expect(ctx.projectPath).toBe(path.resolve(tmpDir));
      ctx.cleanup();
    });

    test('resolves file:// URL correctly', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

      const fileUrl = `file://${tmpDir}`;
      const ctx = await resolveTarget(fileUrl);
      expect(ctx.isTemporary).toBe(false);
      expect(ctx.projectPath).toBe(path.resolve(tmpDir));
      ctx.cleanup();
    });

    test('throws error if local directory does not exist', async () => {
      const nonExistentPath = path.join(tmpDir, 'does-not-exist');
      expect(resolveTarget(nonExistentPath)).rejects.toThrow('Local directory does not exist');
    });

    test('throws error if path is a file, not a directory', async () => {
      const filePath = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(filePath, 'hello');
      expect(resolveTarget(filePath)).rejects.toThrow('Path is not a directory');
    });

    test('throws error if directory does not contain package.json', async () => {
      const emptySubDir = path.join(tmpDir, 'empty-dir');
      fs.mkdirSync(emptySubDir);
      expect(resolveTarget(emptySubDir)).rejects.toThrow('No package.json found in directory');
    });
  });

  describe('detectPackageManager', () => {
    test('detects npm when package-lock.json exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
      expect(detectPackageManager(tmpDir)).toBe('npm');
    });

    test('detects yarn when yarn.lock exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
      expect(detectPackageManager(tmpDir)).toBe('yarn');
    });

    test('detects pnpm when pnpm-lock.yaml exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(tmpDir)).toBe('pnpm');
    });

    test('detects bun when bun.lockb exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
      expect(detectPackageManager(tmpDir)).toBe('bun');
    });

    test('defaults to npm when no lockfile exists', () => {
      expect(detectPackageManager(tmpDir)).toBe('npm');
    });
  });

  describe('parseNpmLockfile', () => {
    test('parses v2/v3 npm package-lock.json correctly', () => {
      const lockfileContent = JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': { name: 'test-project', version: '1.0.0' },
          'node_modules/chalk': { version: '5.3.0' },
          'node_modules/@types/node': { version: '20.0.0' }
        }
      });
      const lockfilePath = path.join(tmpDir, 'package-lock.json');
      fs.writeFileSync(lockfilePath, lockfileContent);

      const result = parseNpmLockfile(lockfilePath);
      expect(result).toEqual({
        chalk: '5.3.0',
        '@types/node': '20.0.0'
      });
    });

    test('parses v1 npm package-lock.json fallback correctly', () => {
      const lockfileContent = JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        lockfileVersion: 1,
        dependencies: {
          express: { version: '4.18.2' },
          lodash: { version: '4.17.21' }
        }
      });
      const lockfilePath = path.join(tmpDir, 'package-lock.json');
      fs.writeFileSync(lockfilePath, lockfileContent);

      const result = parseNpmLockfile(lockfilePath);
      expect(result).toEqual({
        express: '4.18.2',
        lodash: '4.17.21'
      });
    });
  });

  describe('parsePnpmLockfile', () => {
    test('parses pnpm-lock.yaml entries correctly', () => {
      const lockfileContent = `
lockfileVersion: '6.0'
packages:
  /chalk@5.3.0:
    resolution: {integrity: sha512-...}
  /lodash@4.17.21:
    resolution: {integrity: sha512-...}
`;
      const lockfilePath = path.join(tmpDir, 'pnpm-lock.yaml');
      fs.writeFileSync(lockfilePath, lockfileContent);

      const result = parsePnpmLockfile(lockfilePath);
      expect(result).toEqual({
        chalk: '5.3.0',
        lodash: '4.17.21'
      });
    });

    test('handles empty or malformed pnpm-lock.yaml gracefully', () => {
      const lockfilePath = path.join(tmpDir, 'pnpm-lock.yaml');
      fs.writeFileSync(lockfilePath, 'invalid yaml');

      const result = parsePnpmLockfile(lockfilePath);
      expect(result).toEqual({});
    });
  });

  describe('parseYarnLockfile', () => {
    test('parses yarn.lock entries correctly', () => {
      const lockfileContent = `
# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
"chalk@^5.0.0":
  version "5.3.0"
  resolved "https://registry.npmjs.org/chalk/-/chalk-5.3.0.tgz"

"lodash@^4.17.0":
  version "4.17.21"
  resolved "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"
`;
      const lockfilePath = path.join(tmpDir, 'yarn.lock');
      fs.writeFileSync(lockfilePath, lockfileContent);

      const result = parseYarnLockfile(lockfilePath);
      expect(result).toEqual({
        chalk: '5.3.0',
        lodash: '4.17.21'
      });
    });

    test('handles non-existent yarn.lock file gracefully', () => {
      const result = parseYarnLockfile(path.join(tmpDir, 'non-existent.lock'));
      expect(result).toEqual({});
    });
  });

  describe('parseBunLockfile', () => {
    test('returns empty object with warning for bun.lockb', () => {
      const result = parseBunLockfile('dummy-path');
      expect(result).toEqual({});
    });
  });

  describe('parseCliArgs', () => {
    test('parses default command when no arguments provided', () => {
      const result = parseCliArgs([]);
      expect(result.command).toBe('scan');
      expect(result.flags).toEqual({});
    });

    test('parses subcommand correctly', () => {
      const result = parseCliArgs(['all-installed']);
      expect(result.command).toBe('all-installed');
      expect(result.flags).toEqual({});
    });

    test('parses --url and -u flags correctly', () => {
      const result1 = parseCliArgs(['scan', '--url', 'https://github.com/facebook/react']);
      expect(result1.command).toBe('scan');
      expect(result1.flags.url).toBe('https://github.com/facebook/react');

      const result2 = parseCliArgs(['scan', '-u', '/path/to/repo']);
      expect(result2.command).toBe('scan');
      expect(result2.flags.url).toBe('/path/to/repo');
    });

    test('parses positional GitHub URL as scan command target', () => {
      const result = parseCliArgs(['https://github.com/facebook/react']);
      expect(result.command).toBe('scan');
      expect(result.flags.url).toBe('https://github.com/facebook/react');
    });

    test('parses --direct-only and --full flags', () => {
      const result1 = parseCliArgs(['scan', '--direct-only']);
      expect(result1.command).toBe('scan');
      expect(result1.flags['direct-only']).toBe(true);

      const result2 = parseCliArgs(['scan', '--full']);
      expect(result2.command).toBe('scan');
      expect(result2.flags['full']).toBe(true);
    });

    test('parses --clear-cache and --invalidate-cache flags', () => {
      const result1 = parseCliArgs(['scan', '--clear-cache']);
      expect(result1.flags['clear-cache']).toBe(true);

      const result2 = parseCliArgs(['scan', '--invalidate-cache']);
      expect(result2.flags['clear-cache']).toBe(true);
    });

    test('parses --cache-file flag with space and equal syntax', () => {
      const result1 = parseCliArgs(['scan', '--cache-file', 'custom-cache.json']);
      expect(result1.flags['cache-file']).toBe('custom-cache.json');

      const result2 = parseCliArgs(['scan', '--cache-file=custom-cache.json']);
      expect(result2.flags['cache-file']).toBe('custom-cache.json');
    });

    test('parses --save flag with default and custom filenames', () => {
      const result1 = parseCliArgs(['generate-report', '--save']);
      expect(result1.flags.save).toBe('security-scan.json');

      const result2 = parseCliArgs(['generate-report', '--save', 'output.json']);
      expect(result2.flags.save).toBe('output.json');

      const result3 = parseCliArgs(['generate-report', '--save=custom.json']);
      expect(result3.flags.save).toBe('custom.json');
    });

    test('parses --help and -h flags', () => {
      const result1 = parseCliArgs(['--help']);
      expect(result1.flags.help).toBe(true);

      const result2 = parseCliArgs(['help']);
      expect(result2.command).toBe('help');
    });
  });
});

