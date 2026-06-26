import { FrameworkConfig } from '../../types';

export const FRAMEWORK_CONFIGS: Record<string, FrameworkConfig> = {
  springboot: {
    name: 'Spring Boot',
    filePattern: '**/*Controller.java',
    methodPatterns: {
      get: /@GetMapping\s*\(\s*(\{[^}]*\}|[^)]*)\)/g,
      post: /@PostMapping\s*\(\s*(\{[^}]*\}|[^)]*)\)/g,
      put: /@PutMapping\s*\(\s*(\{[^}]*\}|[^)]*)\)/g,
      delete: /@DeleteMapping\s*\(\s*(\{[^}]*\}|[^)]*)\)/g,
    },
    classPathPattern: /@RequestMapping\s*\(\s*["']?([^"']*)["']?\s*\)/,
    fileExts: ['.java'],
  },
  nodejs: {
    name: 'Node.js',
    filePattern: '**/*{route,Route,router,Router,routes,Routes}*.{js,ts}',
    methodPatterns: {
      get: /(?:app|router|Route)\.get\s*\(\s*["'`]([^"'`]*)["'`]/g,
      post: /(?:app|router|Route)\.post\s*\(\s*["'`]([^"'`]*)["'`]/g,
      put: /(?:app|router|Route)\.put\s*\(\s*["'`]([^"'`]*)["'`]/g,
      delete: /(?:app|router|Route)\.delete\s*\(\s*["'`]([^"'`]*)["'`]/g,
      patch: /(?:app|router|Route)\.patch\s*\(\s*["'`]([^"'`]*)["'`]/g,
    },
    classPathPattern: undefined,
    fileExts: ['.js', '.ts'],
  },
  django: {
    name: 'Django',
    filePattern: '**/urls.py',
    methodPatterns: {
      get: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      post: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      put: /path\(\s*["']([^"']*)["'].*,.*views\./g,
      delete: /path\(\s*["']([^"']*)["'].*,.*views\./g,
    },
    classPathPattern: undefined,
    fileExts: ['.py'],
  },
};

const TEST_FILE_PATTERN =
  /(?:^|[\\/])(?:src[\\/])?test[\\/]|(?:Test|Tests)\.java$|_test\.java$|hy_test\.java$/i;

export function isTestOrNonApiSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERN.test(normalized);
}
