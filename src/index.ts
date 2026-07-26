import chalk from 'chalk';
import { execa } from 'execa';
import Listr from 'listr';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  DependenciesMap,
  PackageManager,
  VersionInfo,
  Advisory,
  DependencyResult,
  ScanReport,
  ScanCacheEntry
} from './types';
import {
  renderBanner,
  promptForCommand,
  confirmSave,
  detectPackageManager,
  parseNpmLockfile,
  parsePnpmLockfile,
  parseYarnLockfile,
  parseBunLockfile,
  parseCliArgs,
  showHelp,
  resolveTarget
} from './utils';

class Scanner {
  private baseUrl: string;
  private scanCache: Record<string, DependencyResult[]> = {};

  constructor() {
    this.baseUrl = 'https://api.deps.dev/v3alpha';
  }

  private hashString(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private getDefaultCachePath(projectPath: string = '.'): string {
    return path.resolve(projectPath, '.npm-scan-cache.json');
  }

  private getLockfileFingerprint(projectPath: string = '.'): string {
    const lockFileMap: Record<PackageManager, string> = {
      npm: 'package-lock.json',
      yarn: 'yarn.lock',
      pnpm: 'pnpm-lock.yaml',
      bun: 'bun.lockb'
    };

    const packageManager = detectPackageManager(projectPath);
    const lockFilePath = path.join(projectPath, lockFileMap[packageManager]);

    if (fs.existsSync(lockFilePath) && fs.statSync(lockFilePath).isFile()) {
      return this.hashString(fs.readFileSync(lockFilePath, 'utf8'));
    }

    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile()) {
      return this.hashString(fs.readFileSync(packageJsonPath, 'utf8'));
    }

    return this.hashString(projectPath);
  }

  async getPackageManagerVersion(projectPath: string = '.'): Promise<string> {
    const manager = detectPackageManager(projectPath);

    try {
      const result = await execa(manager, ['--version'], { cwd: projectPath });
      return `${manager} ${result.stdout.trim()}`;
    } catch {
      return `${manager} (version unknown)`;
    }
  }

  private loadCache(cachePath: string): ScanCacheEntry[] {
    if (!fs.existsSync(cachePath)) {
      return [];
    }

    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { entries?: ScanCacheEntry[] };
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch {
      return [];
    }
  }

  private saveCache(cachePath: string, entries: ScanCacheEntry[]): void {
    const data = { entries };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private clearCacheFile(cachePath: string): void {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
    this.scanCache = {};
  }

  private getCachedResults(cacheKey: string, fingerprint: string, cachePath: string): DependencyResult[] | null {
    if (this.scanCache[cacheKey]) {
      return this.scanCache[cacheKey];
    }

    const entries = this.loadCache(cachePath);
    const entry = entries.find(e => e.cacheKey === cacheKey && e.fingerprint === fingerprint);
    if (!entry) {
      return null;
    }

    this.scanCache[cacheKey] = entry.results;
    return entry.results;
  }

  private setCacheEntry(
    cacheKey: string,
    fingerprint: string,
    results: DependencyResult[],
    cachePath: string,
    packageJsonPath: string,
    includeTransitive: boolean
  ): void {
    const entries = this.loadCache(cachePath).filter(e => e.cacheKey !== cacheKey);
    entries.push({
      cacheKey,
      fingerprint,
      results,
      packageJsonPath,
      includeTransitive,
      updatedAt: new Date().toISOString()
    });

    this.saveCache(cachePath, entries);
    this.scanCache[cacheKey] = results;
  }

  getDependencies(packageJsonPath: string = './package.json'): DependenciesMap {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
    } catch (error) {
      throw new Error(`Failed to read package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getAllInstalledPackages(baseDir: string = '.'): DependenciesMap {
    try {
      const packageManager = detectPackageManager(baseDir);
      let lockFilePath: string;
      let allPackages: DependenciesMap = {};

      switch (packageManager) {
        case 'npm':
          lockFilePath = path.join(baseDir, 'package-lock.json');
          if (fs.existsSync(lockFilePath)) {
            allPackages = parseNpmLockfile(lockFilePath);
          }
          break;

        case 'yarn':
          lockFilePath = path.join(baseDir, 'yarn.lock');
          if (fs.existsSync(lockFilePath)) {
            allPackages = parseYarnLockfile(lockFilePath);
          }
          break;

        case 'pnpm':
          lockFilePath = path.join(baseDir, 'pnpm-lock.yaml');
          if (fs.existsSync(lockFilePath)) {
            allPackages = parsePnpmLockfile(lockFilePath);
          }
          break;

        case 'bun':
          lockFilePath = path.join(baseDir, 'bun.lockb');
          if (fs.existsSync(lockFilePath)) {
            allPackages = parseBunLockfile(lockFilePath);
          }
          break;
      }

      if (Object.keys(allPackages).length === 0) {
        console.warn(`Warning: Could not parse ${packageManager} lock file. Falling back to package.json dependencies only`);
        return this.getDependencies(path.join(baseDir, 'package.json'));
      }

      return allPackages;
    } catch (error) {
      console.warn(`Warning: Could not read lock file: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('Falling back to package.json dependencies only');
      return this.getDependencies(path.join(baseDir, 'package.json'));
    }
  }

  getDependencyTypes(packageJsonPath: string = './package.json'): { [key: string]: 'direct' | 'transitive' } {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const directDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      const projectPath = path.dirname(packageJsonPath);
      const allDeps = this.getAllInstalledPackages(projectPath);
      const dependencyTypes: { [key: string]: 'direct' | 'transitive' } = {};

      for (const [packageName] of Object.entries(allDeps)) {
        dependencyTypes[packageName] = directDeps[packageName] ? 'direct' : 'transitive';
      }

      return dependencyTypes;
    } catch (error) {
      throw new Error(`Failed to analyze dependency types: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getVersionInfo(packageName: string, version: string): Promise<VersionInfo | null> {
    const cleanVersion = version.replace(/^[\^~]/, '');
    const url = `${this.baseUrl}/systems/npm/packages/${encodeURIComponent(packageName)}/versions/${encodeURIComponent(cleanVersion)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json() as VersionInfo;
    } catch (error) {
      console.error(`Failed to get version info for ${packageName}@${version}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async getVulnerabilities(packageName: string, version: string): Promise<Advisory[]> {
    const cleanVersion = version.replace(/^[\^~]/, '');

    try {
      const versionInfo = await this.getVersionInfo(packageName, version);
      const advisoryKeys = (versionInfo as any)?.advisoryKeys as Array<{ id: string }> | undefined;

      if (!Array.isArray(advisoryKeys) || advisoryKeys.length === 0) {
        return [];
      }

      const advisories: Advisory[] = [];
      for (const advisory of advisoryKeys) {
        if (!advisory?.id) continue;

        const url = `${this.baseUrl}/advisories/${encodeURIComponent(advisory.id)}`;
        const response = await fetch(url);
        if (!response.ok) {
          continue;
        }

        const advisoryData = await response.json() as any;
        const advisoryInfo = advisoryData?.advisoryKey ? advisoryData : advisoryData;

        const cvssScore = advisoryInfo.cvss3Score ?? 0;
        const normalizedSeverity = advisoryInfo.severity
          || (cvssScore >= 7 ? 'high'
          : cvssScore >= 4 ? 'medium'
          : cvssScore > 0 ? 'low'
          : 'unknown');

        advisories.push({
          id: advisory.id,
          title: advisoryInfo.title || 'Unknown advisory',
          severity: normalizedSeverity,
          cvss: cvssScore,
          summary: advisoryInfo.overview || advisoryInfo.summary || advisoryInfo.url || ''
        });
      }

      return advisories;
    } catch (error) {
      console.error(`Failed to get vulnerabilities for ${packageName}@${version}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async getAllVersions(packageName: string): Promise<string[]> {
    const url = `${this.baseUrl}/systems/npm/packages/${encodeURIComponent(packageName)}/versions`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json() as { versions?: string[] };
      return data.versions || [];
    } catch (error) {
      console.error(`Failed to get versions for ${packageName}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async scanDependencies(
    packageJsonPath: string = './package.json',
    includeTransitive: boolean = true,
    options?: { cacheFilePath?: string; clearCache?: boolean }
  ): Promise<DependencyResult[]> {
    const projectPath = path.dirname(packageJsonPath);
    const cachePath = options?.cacheFilePath
      ? path.resolve(options.cacheFilePath)
      : this.getDefaultCachePath(projectPath);
    const fingerprint = this.getLockfileFingerprint(projectPath);
    const cacheKey = `${path.resolve(packageJsonPath)}:${includeTransitive}`;

    if (options?.clearCache) {
      this.clearCacheFile(cachePath);
      console.log('Cache invalidated. Re-scanning dependencies.');
    }

    const cachedResults = this.getCachedResults(cacheKey, fingerprint, cachePath);
    if (cachedResults) {
      return cachedResults;
    }

    const dependencies = includeTransitive
      ? this.getAllInstalledPackages(projectPath)
      : this.getDependencies(packageJsonPath);

    const dependencyTypes = includeTransitive ? this.getDependencyTypes(packageJsonPath) : {};
    const results: DependencyResult[] = [];

    for (const [packageName, version] of Object.entries(dependencies)) {
      const versionInfo = await this.getVersionInfo(packageName, version);
      const vulnerabilities = await this.getVulnerabilities(packageName, version);

      const result: DependencyResult = {
        package: packageName,
        currentVersion: version,
        dependencyType: (dependencyTypes[packageName] as 'direct' | 'transitive') || 'direct',
        publishedAt: versionInfo?.publishedAt || 'Unknown',
        isDefault: versionInfo?.isDefault || false,
        vulnerabilities: vulnerabilities.map(vuln => ({
          id: vuln.id,
          title: vuln.title,
          severity: vuln.severity,
          cvss: vuln.cvss,
          summary: vuln.summary
        })),
        vulnerabilityCount: vulnerabilities.length
      };

      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.setCacheEntry(cacheKey, fingerprint, results, cachePath, packageJsonPath, includeTransitive);
    return results;
  }

  public filterReportResults(results: DependencyResult[]): DependencyResult[] {
    return results.filter(r => r.vulnerabilityCount > 0);
  }

  generateReport(results: DependencyResult[], options?: { onlyVulnerable?: boolean }): void {
    const reportResults = options?.onlyVulnerable ? this.filterReportResults(results) : results;
    const vulnerablePackages = reportResults.filter(r => r.vulnerabilityCount > 0);
    const directPackages = reportResults.filter(r => r.dependencyType === 'direct');
    const transitivePackages = reportResults.filter(r => r.dependencyType === 'transitive');
    const vulnerableDirect = vulnerablePackages.filter(r => r.dependencyType === 'direct');
    const vulnerableTransitive = vulnerablePackages.filter(r => r.dependencyType === 'transitive');

    console.log(chalk.bold(chalk.cyan('\n🔎 Dependency Scan Report')));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.green(`• Total packages reviewed: ${reportResults.length}`));
    console.log(`• Direct dependencies: ${directPackages.length}`);
    console.log(`• Transitive dependencies: ${transitivePackages.length}`);
    console.log(chalk.yellow(`• Packages with vulnerabilities: ${vulnerablePackages.length}`));

    if (vulnerablePackages.length > 0) {
      console.log(chalk.redBright('\n⚠️  Vulnerable packages'));
      vulnerablePackages.forEach(pkg => {
        const depType = pkg.dependencyType === 'direct' ? '🎯 Direct' : '🔗 Transitive';
        console.log(chalk.cyan(`\n📦 ${pkg.package}@${pkg.currentVersion} (${depType})`));
        console.log(chalk.gray(`   • Published: ${pkg.publishedAt}`));
        console.log(chalk.gray(`   • Findings: ${pkg.vulnerabilityCount}`));

        pkg.vulnerabilities.forEach(vuln => {
          console.log(chalk.red(`   - ${vuln.title}`));
          console.log(chalk.gray(`     Severity: ${vuln.severity || 'Unknown severity'}`));
          if (vuln.summary) {
            const summary = vuln.summary.length > 120 ? `${vuln.summary.substring(0, 117)}...` : vuln.summary;
            console.log(chalk.gray(`     Details: ${summary}`));
          }
        });
      });
    } else {
      console.log(chalk.greenBright('\n✅ No vulnerable dependencies were found.'));
    }

    if (transitivePackages.length > 0) {
      console.log(chalk.magenta('\n📊 Vulnerability breakdown'));
      console.log(`   • Direct dependencies affected: ${vulnerableDirect.length}/${directPackages.length}`);
      console.log(`   • Transitive dependencies affected: ${vulnerableTransitive.length}/${transitivePackages.length}`);
    }

    const sortedByDate = reportResults
      .filter(r => r.publishedAt !== 'Unknown')
      .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

    if (sortedByDate.length > 0) {
      console.log(chalk.blue('\n📅 Oldest published dependencies'));
      sortedByDate.slice(0, 5).forEach(pkg => {
        const depType = pkg.dependencyType === 'direct' ? '🎯' : '🔗';
        console.log(`   ${depType} ${pkg.package}@${pkg.currentVersion} — published ${pkg.publishedAt}`);
      });
    }

    console.log(chalk.dim('─'.repeat(60)));
  }

  saveResults(results: DependencyResult[], filename: string = 'dependency-scan.json'): void {
    const vulnerablePackages = results.filter(r => r.vulnerabilityCount > 0);
    const directPackages = results.filter(r => r.dependencyType === 'direct');
    const transitivePackages = results.filter(r => r.dependencyType === 'transitive');

    const report: ScanReport = {
      scanDate: new Date().toISOString(),
      summary: {
        totalPackages: results.length,
        directDependencies: directPackages.length,
        transitiveDependencies: transitivePackages.length,
        vulnerablePackages: vulnerablePackages.length,
        vulnerableDirect: vulnerablePackages.filter(r => r.dependencyType === 'direct').length,
        vulnerableTransitive: vulnerablePackages.filter(r => r.dependencyType === 'transitive').length
      },
      results,
    };

    fs.writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\nResults saved to ${filename}`));
  }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  renderBanner();
  const hasArgs = argv.length > 0;
  const { command, flags } = hasArgs ? parseCliArgs(argv) : await promptForCommand();
  const scanner = new Scanner();

  if (flags.help) {
    showHelp();
    return;
  }

  try {
    const scanOptions = {
      cacheFilePath: typeof flags['cache-file'] === 'string' ? flags['cache-file'] : undefined,
      clearCache: Boolean(flags['clear-cache'])
    };

    const targetInput = typeof flags.url === 'string' ? flags.url : undefined;
    const targetCtx = await resolveTarget(targetInput);

    try {
      const packageJsonPath = path.join(targetCtx.projectPath, 'package.json');

      switch (command) {
        case 'scan': {
          const includeTransitive = Boolean(!flags['direct-only']);
          let results: DependencyResult[] = [];

          await new Listr([
            {
              title: `Scanning dependencies for ${targetCtx.projectPath}`,
              task: async () => {
                results = await scanner.scanDependencies(packageJsonPath, includeTransitive, scanOptions);
              }
            }
          ]).run();

          scanner.generateReport(results);

          if (flags.save) {
            const filename = typeof flags.save === 'string' ? flags.save : 'security-scan.json';
            if (await confirmSave(filename)) {
              scanner.saveResults(results, filename);
            } else {
              console.log(chalk.yellow('Save canceled.'));
            }
          }
          break;
        }

        case 'all-installed': {
          let results: DependencyResult[] = [];

          await new Listr([
            {
              title: `Scanning all installed packages for ${targetCtx.projectPath}`,
              task: async () => {
                results = await scanner.scanDependencies(packageJsonPath, true, scanOptions);
              }
            }
          ]).run();

          console.log(chalk.blue(`Total installed packages: ${results.length}`));
          results.forEach(pkg => console.log(chalk.gray(`${pkg.package}@${pkg.currentVersion}`)));

          if (flags.save) {
            const filename = typeof flags.save === 'string' ? flags.save : 'all-installed-report.json';
            if (await confirmSave(filename)) {
              scanner.saveResults(results, filename);
            } else {
              console.log(chalk.yellow('Save canceled.'));
            }
          }
          break;
        }

        case 'generate-report': {
          let results: DependencyResult[] = [];
          let filteredResults: DependencyResult[] = [];

          await new Listr([
            {
              title: `Scanning dependencies for report (${targetCtx.projectPath})`,
              task: async () => {
                results = await scanner.scanDependencies(packageJsonPath, true, scanOptions);
              }
            },
            {
              title: 'Preparing vulnerable report',
              task: () => {
                filteredResults = scanner.filterReportResults(results);
              }
            }
          ]).run();

          scanner.generateReport(filteredResults, { onlyVulnerable: true });

          if (flags.save) {
            const filename = typeof flags.save === 'string' ? flags.save : 'security-scan.json';
            if (await confirmSave(filename)) {
              scanner.saveResults(filteredResults, filename);
            } else {
              console.log(chalk.yellow('Save canceled.'));
            }
          }
          break;
        }

        case 'help':
          showHelp();
          break;

        default:
          console.error(chalk.red(`Unknown command: ${command}`));
          showHelp();
          process.exit(1);
      }
    } finally {
      targetCtx.cleanup();
    }
  } catch (error) {
    console.error(chalk.red('Command failed:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}


export { main };
export default Scanner;
