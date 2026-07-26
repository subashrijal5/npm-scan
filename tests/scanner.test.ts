import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Scanner from '../src/index';
import type { DependencyResult } from '../src/types';

describe('Scanner', () => {
  let tmpDir: string;
  let scanner: Scanner;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-scan-scanner-test-'));
    scanner = new Scanner();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('getDependencies', () => {
    test('reads and merges dependencies and devDependencies from package.json', () => {
      const packageJson = {
        name: 'sample-app',
        dependencies: { chalk: '^5.0.0' },
        devDependencies: { typescript: '^5.0.0' }
      };
      const pkgPath = path.join(tmpDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));

      const deps = scanner.getDependencies(pkgPath);
      expect(deps).toEqual({
        chalk: '^5.0.0',
        typescript: '^5.0.0'
      });
    });

    test('throws error if package.json does not exist', () => {
      expect(() => {
        scanner.getDependencies(path.join(tmpDir, 'non-existent.json'));
      }).toThrow();
    });
  });

  describe('getAllInstalledPackages', () => {
    test('reads lockfile packages if lockfile exists', () => {
      const packageJson = {
        name: 'sample-app',
        dependencies: { chalk: '^5.0.0' }
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

      const lockfile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'sample-app' },
          'node_modules/chalk': { version: '5.3.0' },
          'node_modules/ansi-styles': { version: '6.2.1' }
        }
      };
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify(lockfile));

      const installed = scanner.getAllInstalledPackages(tmpDir);
      expect(installed).toEqual({
        chalk: '5.3.0',
        'ansi-styles': '6.2.1'
      });
    });

    test('falls back to package.json if lockfile is missing', () => {
      const packageJson = {
        name: 'sample-app',
        dependencies: { chalk: '5.3.0' }
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

      const installed = scanner.getAllInstalledPackages(tmpDir);
      expect(installed).toEqual({ chalk: '5.3.0' });
    });
  });

  describe('getDependencyTypes', () => {
    test('correctly identifies direct and transitive dependencies', () => {
      const packageJson = {
        name: 'sample-app',
        dependencies: { chalk: '5.3.0' }
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

      const lockfile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'sample-app' },
          'node_modules/chalk': { version: '5.3.0' },
          'node_modules/ansi-styles': { version: '6.2.1' }
        }
      };
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify(lockfile));

      const types = scanner.getDependencyTypes(path.join(tmpDir, 'package.json'));
      expect(types).toEqual({
        chalk: 'direct',
        'ansi-styles': 'transitive'
      });
    });
  });

  describe('filterReportResults', () => {
    test('filters results to include only vulnerable packages', () => {
      const sampleResults: DependencyResult[] = [
        {
          package: 'safe-pkg',
          currentVersion: '1.0.0',
          dependencyType: 'direct',
          publishedAt: '2023-01-01',
          isDefault: true,
          vulnerabilities: [],
          vulnerabilityCount: 0
        },
        {
          package: 'vuln-pkg',
          currentVersion: '2.0.0',
          dependencyType: 'transitive',
          publishedAt: '2022-05-05',
          isDefault: true,
          vulnerabilities: [
            { id: 'GHSA-1234', title: 'Critical flaw', severity: 'high', cvss: 8.5, summary: 'Bad bug' }
          ],
          vulnerabilityCount: 1
        }
      ];

      const filtered = scanner.filterReportResults(sampleResults);
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.package).toBe('vuln-pkg');
    });
  });

  describe('saveResults', () => {
    test('saves scan report to a structured JSON file', () => {
      const sampleResults: DependencyResult[] = [
        {
          package: 'chalk',
          currentVersion: '5.3.0',
          dependencyType: 'direct',
          publishedAt: '2023-01-01',
          isDefault: true,
          vulnerabilities: [],
          vulnerabilityCount: 0
        }
      ];

      const outputFile = path.join(tmpDir, 'test-report.json');
      scanner.saveResults(sampleResults, outputFile);

      expect(fs.existsSync(outputFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

      expect(content.summary.totalPackages).toBe(1);
      expect(content.summary.directDependencies).toBe(1);
      expect(content.summary.transitiveDependencies).toBe(0);
      expect(content.summary.vulnerablePackages).toBe(0);
      expect(content.results).toEqual(sampleResults);
    });
  });

  describe('API integration methods with mock fetch', () => {
    test('getVersionInfo fetches version data from API', async () => {
      global.fetch = mock(async (..._args: Parameters<typeof fetch>) => {
        return {
          ok: true,
          json: async () => ({ publishedAt: '2023-06-15T00:00:00Z', isDefault: true })
        } as Response;
      }) as unknown as typeof fetch;

      const info = await scanner.getVersionInfo('chalk', '5.3.0');
      expect(info).toEqual({ publishedAt: '2023-06-15T00:00:00Z', isDefault: true });
    });

    test('getVulnerabilities processes advisories from API', async () => {
      global.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/versions/')) {
          return {
            ok: true,
            json: async () => ({ advisoryKeys: [{ id: 'GHSA-TEST-1234' }] })
          } as Response;
        } else if (urlStr.includes('/advisories/')) {
          return {
            ok: true,
            json: async () => ({
              title: 'Test Vulnerability',
              severity: 'high',
              cvss3Score: 7.5,
              overview: 'Overview details'
            })
          } as Response;
        }
        return { ok: false } as Response;
      }) as unknown as typeof fetch;

      const vulnerabilities = await scanner.getVulnerabilities('test-pkg', '1.0.0');
      expect(vulnerabilities.length).toBe(1);
      expect(vulnerabilities[0]).toEqual({
        id: 'GHSA-TEST-1234',
        title: 'Test Vulnerability',
        severity: 'high',
        cvss: 7.5,
        summary: 'Overview details'
      });
    });

    test('getAllVersions fetches version list', async () => {
      global.fetch = mock(async (..._args: Parameters<typeof fetch>) => {
        return {
          ok: true,
          json: async () => ({ versions: ['1.0.0', '2.0.0', '3.0.0'] })
        } as Response;
      }) as unknown as typeof fetch;

      const versions = await scanner.getAllVersions('chalk');
      expect(versions).toEqual(['1.0.0', '2.0.0', '3.0.0']);
    });
  });
});
