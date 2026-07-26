export interface DependenciesMap {
  [key: string]: string;
}

export interface PackageInfo {
  version: string;
  [key: string]: unknown;
}

export interface PackageLockData {
  packages?: {
    [key: string]: PackageInfo;
  };
}

export interface PnpmLockData {
  packages?: {
    [key: string]: {
      version: string;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

export interface YarnLockEntry {
  version: string;
  [key: string]: unknown;
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface VersionInfo {
  publishedAt?: string;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface Advisory {
  id: string;
  title: string;
  severity?: string;
  cvss?: number;
  summary?: string;
}

export interface AdvisoriesResponse {
  advisories?: Advisory[];
}

export interface DependencyResult {
  package: string;
  currentVersion: string;
  dependencyType: 'direct' | 'transitive';
  publishedAt: string;
  isDefault: boolean;
  vulnerabilities: Advisory[];
  vulnerabilityCount: number;
  dependsOnVulnerable?: string[];
}

export interface ScanCacheEntry {
  cacheKey: string;
  fingerprint: string;
  results: DependencyResult[];
  packageJsonPath: string;
  includeTransitive: boolean;
  updatedAt: string;
}

export interface ScanReport {
  scanDate: string;
  summary: {
    totalPackages: number;
    directDependencies: number;
    transitiveDependencies: number;
    vulnerablePackages: number;
    vulnerableDirect: number;
    vulnerableTransitive: number;
  };
  results: DependencyResult[];
}

export interface TargetContext {
  projectPath: string;
  isTemporary: boolean;
  cleanup: () => void;
}

