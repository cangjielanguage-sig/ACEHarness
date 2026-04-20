#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let distDir = path.join(root, 'dist');
const srcDir = path.join(root, 'src');

const files = [
  path.join(srcDir, 'cli.ts'),
  path.join(srcDir, 'lib', 'app-paths.ts'),
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return;
  } catch {
    // Primary rmSync failed — try shell chmod + rm
  }
  try {
    execSync(`chmod -R u+w "${dirPath}" 2>/dev/null; rm -rf "${dirPath}"`, { stdio: 'ignore' });
  } catch {
    // Cannot clean — use an alternate dist directory to avoid the permission issue
    console.warn(`[build-cli] Warning: could not clean ${dirPath}, using alternate output dir`);
    distDir = path.join(root, 'dist-build');
  }
}

function transpileFile(inputPath) {
  const source = fs.readFileSync(inputPath, 'utf8');
  const relative = path.relative(srcDir, inputPath);
  const outputPath = path.join(distDir, relative).replace(/\.ts$/, '.js');
  const isCliEntry = relative === 'cli.ts';

  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: inputPath,
    reportDiagnostics: true,
  });

  if (result.diagnostics?.length) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    });
    if (formatted.trim()) {
      console.error(formatted);
    }
  }

  ensureDir(path.dirname(outputPath));
  const banner = isCliEntry ? '#!/usr/bin/env node\n' : '';
  fs.writeFileSync(outputPath, banner + result.outputText, 'utf8');
  if (isCliEntry) {
    fs.chmodSync(outputPath, 0o755);
  }
}

cleanDir(distDir);
ensureDir(distDir);
files.forEach(transpileFile);
