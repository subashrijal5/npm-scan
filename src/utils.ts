import chalk from 'chalk';
import figlet from 'figlet';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import type { DependenciesMap, PackageManager, TargetContext } from './types';


type PromptCommand = 'scan' | 'all-installed' | 'generate-report' | 'help';

interface PromptAnswers {
  command: PromptCommand;
  target?: string;
  clearCache?: boolean;
  directOnly?: boolean;
  saveReport?: boolean;
  saveFile?: string;
}

export function isGithubUrl(target: string): boolean {
  if (!target || typeof target !== 'string') return false;
  const trimmed = target.trim();
  if (trimmed.startsWith('file://')) return false;
  if (/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(trimmed)) return true;
  if (/^git@github\.com:[\w.-]+\/[\w.-]+(\.git)?$/i.test(trimmed)) return true;
  return false;
}

export function normalizeGithubUrl(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('git@github.com:')) {
    return trimmed;
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export async function resolveTarget(target?: string): Promise<TargetContext> {
  const targetStr = (target || '.').trim();

  if (isGithubUrl(targetStr)) {
    const gitUrl = normalizeGithubUrl(targetStr);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-scan-repo-'));
    console.log(chalk.blue(`Cloning GitHub repository ${gitUrl}...`));

    try {
      await execa('git', ['clone', '--depth', '1', gitUrl, tempDir]);
    } catch (error) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      throw new Error(`Failed to clone GitHub repository from ${gitUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const packageJsonPath = path.join(tempDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      throw new Error(`No package.json found in cloned repository: ${gitUrl}`);
    }

    return {
      projectPath: tempDir,
      isTemporary: true,
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
          console.warn(`Warning: Could not remove temporary directory ${tempDir}: ${err}`);
        }
      }
    };
  }

  let localPath = targetStr;
  if (localPath.startsWith('file://')) {
    try {
      localPath = fileURLToPath(localPath);
    } catch (err) {
      throw new Error(`Invalid file URL '${targetStr}': ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (localPath.startsWith('~')) {
    localPath = path.join(os.homedir(), localPath.slice(1));
  }

  const resolvedPath = path.resolve(localPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Local directory does not exist: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }

  const packageJsonPath = path.join(resolvedPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in directory: ${resolvedPath}`);
  }

  return {
    projectPath: resolvedPath,
    isTemporary: false,
    cleanup: () => {}
  };
}

export function renderBanner(): void {
  const banner = figlet.textSync('npm-scan', { horizontalLayout: 'default' });
  console.log(chalk.cyanBright(banner));
  console.log(chalk.gray('Interactive dependency security scanner\n'));
}

export async function promptForCommand(): Promise<{ command: string; flags: Record<string, string | boolean> }> {
  const questions = [
    {
      type: 'select' as const,
      name: 'command' as const,
      message: 'Choose a command',
      choices: [
        { name: 'Scan dependencies', value: 'scan' as PromptCommand },
        { name: 'List all installed packages and report', value: 'all-installed' as PromptCommand },
        { name: 'Generate report for vulnerable packages', value: 'generate-report' as PromptCommand },
        { name: 'Show help', value: 'help' as PromptCommand }
      ]
    },
    {
      type: 'input' as const,
      name: 'target' as const,
      message: 'Enter GitHub repository URL or local project directory path (leave empty for current directory):',
      default: '.',
      when: (answers: PromptAnswers) => answers.command !== 'help'
    },
    {
      type: 'confirm' as const,
      name: 'clearCache' as const,
      message: 'Clear previous cache before scanning?',
      default: false,
      when: (answers: PromptAnswers) => answers.command !== 'help'
    },
    {
      type: 'confirm' as const,
      name: 'directOnly' as const,
      message: 'Scan direct dependencies only?',
      default: false,
      when: (answers: PromptAnswers) => answers.command === 'scan'
    },
    {
      type: 'confirm' as const,
      name: 'saveReport' as const,
      message: (answers: PromptAnswers) =>
        answers.command === 'all-installed'
          ? 'Save a full installed package report to disk?'
          : 'Save the report to disk?',
      default: false,
      when: (answers: PromptAnswers) => answers.command !== 'help'
    },
    {
      type: 'input' as const,
      name: 'saveFile' as const,
      message: (answers: PromptAnswers) =>
        answers.command === 'all-installed'
          ? 'Enter filename for the installed package report'
          : 'Enter filename for the report',
      default: (answers: PromptAnswers) =>
        answers.command === 'all-installed'
          ? 'all-installed-report.json'
          : 'security-scan.json',
      when: (answers: PromptAnswers) => answers.saveReport === true
    }
  ] as const;

  const answers = await inquirer.prompt<PromptAnswers>(questions as unknown as any);

  const flags: Record<string, string | boolean> = {};
  if (answers.target && answers.target.trim() !== '.' && answers.target.trim() !== '') {
    flags.url = answers.target.trim();
  }
  if (answers.clearCache) flags['clear-cache'] = true;
  if (answers.directOnly) flags['direct-only'] = true;
  if (answers.saveReport) flags.save = answers.saveFile || (answers.command === 'all-installed' ? 'all-installed-report.json' : 'security-scan.json');

  return { command: answers.command, flags };
}

export async function confirmSave(filename: string): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmSave',
      message: `Confirm save report as ${filename}?`,
      default: true
    }
  ]);

  return Boolean(answer.confirmSave);
}

export function detectPackageManager(projectPath: string = '.'): PackageManager {
  const lockFiles: { [key in PackageManager]: string } = {
    npm: 'package-lock.json',
    yarn: 'yarn.lock',
    pnpm: 'pnpm-lock.yaml',
    bun: 'bun.lockb'
  };

  for (const [manager, lockFile] of Object.entries(lockFiles)) {
    const lockFilePath = path.join(projectPath, lockFile);
    if (fs.existsSync(lockFilePath)) {
      return manager as PackageManager;
    }
  }

  return 'npm';
}

export function parseNpmLockfile(lockFilePath: string): DependenciesMap {
  const packageLock: { packages?: Record<string, any> } = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
  const allPackages: DependenciesMap = {};

  if (packageLock.packages && Object.keys(packageLock.packages).length > 0) {
    for (const [packagePath, packageInfo] of Object.entries(packageLock.packages || {})) {
      if (packagePath === '') continue;

      const packageName = packagePath.replace('node_modules/', '');
      const normalizedName = packageName.includes('/') && !packageName.startsWith('@')
        ? packageName.split('/').pop()
        : packageName;

      if (packageInfo.version && normalizedName) {
        allPackages[normalizedName] = packageInfo.version;
      }
    }
    return allPackages;
  }

  const traverseDeps = (deps: Record<string, any>) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== 'object') continue;
      if (info.version) {
        allPackages[name] = info.version;
      }
      if (info.dependencies) {
        traverseDeps(info.dependencies);
      }
    }
  };

  traverseDeps((packageLock as any).dependencies || {});
  return allPackages;
}

export function parsePnpmLockfile(lockFilePath: string): DependenciesMap {
  try {
    const content = fs.readFileSync(lockFilePath, 'utf8');
    const allPackages: DependenciesMap = {};

    const packagesMatch = content.match(/packages:\s*\n([\s\S]*?)(?=\n[^\s#]|\s*$)/);
    if (!packagesMatch?.[1]) {
      return allPackages;
    }

    const packagesSection = packagesMatch[1];
    const packageLines = packagesSection.match(/^  \/[^\n]+/gm) || [];

    packageLines.forEach(line => {
      const match = line.match(/\/([^@]+)@([^:]+):/);
      if (match?.[1] && match?.[2]) {
        const packageName = match[1];
        const version = match[2];
        allPackages[packageName] = version;
      }
    });

    return allPackages;
  } catch (error) {
    console.warn(`Warning: Could not parse pnpm-lock.yaml: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function parseYarnLockfile(lockFilePath: string): DependenciesMap {
  try {
    const content = fs.readFileSync(lockFilePath, 'utf8');
    const allPackages: DependenciesMap = {};

    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]?.trim();
      if (!line) {
        i++;
        continue;
      }

      if (line.startsWith('"') && line.includes('@')) {
        const match = line.match(/"([^"@]+)@([^\"]+)":/);
        if (match?.[1] && match?.[2]) {
          const packageName = match[1];
          let resolvedVersion = match[2];
          let j = i + 1;

          while (j < lines.length) {
            const nextLine = lines[j]?.trim();
            if (!nextLine || nextLine.startsWith('"')) {
              break;
            }
            const versionMatch = nextLine.match(/version\s+"([^\"]+)"/);
            if (versionMatch?.[1]) {
              resolvedVersion = versionMatch[1];
              break;
            }
            j++;
          }

          allPackages[packageName] = resolvedVersion;
        }
      }
      i++;
    }

    return allPackages;
  } catch (error) {
    console.warn(`Warning: Could not parse yarn.lock: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function parseBunLockfile(_lockFilePath: string): DependenciesMap {
  console.warn('Warning: bun.lockb parsing requires additional dependencies. Falling back to package.json only.');
  return {};
}

export function parseCliArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const args = [...argv];
  const flags: Record<string, string | boolean> = {};
  let command = 'scan';

  const knownCommands = ['scan', 'all-installed', 'generate-report', 'help'];

  const firstArg = args[0];
  if (firstArg !== undefined && !firstArg.startsWith('-')) {
    if (knownCommands.includes(firstArg)) {
      command = args.shift() as string;
    } else if (isGithubUrl(firstArg) || firstArg.startsWith('file://') || fs.existsSync(firstArg)) {
      command = 'scan';
      flags.url = args.shift() as string;
    } else {
      command = args.shift() as string;
    }
  }

  while (args.length > 0) {
    const token = args.shift() as string;
    if (token === '--direct-only') {
      flags['direct-only'] = true;
    } else if (token === '--full') {
      flags['full'] = true;
    } else if (token === '--clear-cache' || token === '--invalidate-cache') {
      flags['clear-cache'] = true;
    } else if (token === '--cache-file') {
      const next = args[0];
      if (next !== undefined && !next.startsWith('-')) {
        flags['cache-file'] = args.shift() as string;
      }
    } else if (token.startsWith('--cache-file=')) {
      flags['cache-file'] = token.slice('--cache-file='.length);
    } else if (token === '--save') {
      const next = args[0];
      if (next !== undefined && !next.startsWith('-')) {
        flags.save = args.shift() as string;
      } else {
        flags.save = 'security-scan.json';
      }
    } else if (token.startsWith('--save=')) {
      flags.save = token.slice('--save='.length);
    } else if (token === '--url' || token === '-u' || token === '--path' || token === '-p') {
      const next = args[0];
      if (next !== undefined && !next.startsWith('-')) {
        flags.url = args.shift() as string;
      }
    } else if (token.startsWith('--url=')) {
      flags.url = token.slice('--url='.length);
    } else if (token.startsWith('-u=')) {
      flags.url = token.slice('-u='.length);
    } else if (token.startsWith('--path=')) {
      flags.url = token.slice('--path='.length);
    } else if (token.startsWith('-p=')) {
      flags.url = token.slice('-p='.length);
    } else if (token === '--help' || token === '-h') {
      flags.help = true;
    } else if (!token.startsWith('-') && !flags.url) {
      flags.url = token;
    }
  }

  return { command, flags };
}

export function showHelp(): void {
  console.log('Usage: npm-scan [command] [options] [url|path]\n');
  console.log('Commands:');
  console.log('  scan [--url <url|path>] [--direct-only|--full] [--clear-cache] [--cache-file <path>]');
  console.log('                                   Scan dependencies for a project');
  console.log('  all-installed [--url <url|path>] List all installed packages');
  console.log('  generate-report [--url <url|path>] [--save [file]] [--clear-cache]');
  console.log('                                   Scan and generate a report for vulnerable packages');
  console.log('  help                             Show help');
  console.log('\nOptions:');
  console.log('  --url, -u <url|path>                GitHub repo URL or local project directory path');
  console.log('  --path, -p <path>                   Local project directory path or file URL');
  console.log('  --clear-cache, --invalidate-cache   Clear previous cached scan results');
  console.log('  --cache-file <path>                 Use a custom cache file instead of .npm-scan-cache.json');
  console.log('\nExamples:');
  console.log('  npm-scan scan --url https://github.com/expressjs/express');
  console.log('  npm-scan scan --url /path/to/project');
  console.log('  npm-scan scan --url file:///path/to/project');
  console.log('  npm-scan scan --direct-only');
  console.log('  npm-scan generate-report --url https://github.com/facebook/react --save report.json');
}

