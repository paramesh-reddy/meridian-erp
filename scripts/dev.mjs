import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const isWin = process.platform === 'win32';
const venvDir = path.join(backendDir, '.venv');
const pythonExe = path.join(venvDir, isWin ? 'Scripts/python.exe' : 'bin/python');
const stampPath = path.join(venvDir, '.requirements-stamp');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureFrontend() {
  if (!existsSync(path.join(frontendDir, 'node_modules', 'vite'))) {
    console.log('Installing frontend packages...');
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    run(process.execPath, [npmCli, 'install'], { cwd: frontendDir });
  }
}

function ensureBackend() {
  if (!existsSync(pythonExe)) {
    console.log('Creating Python environment...');
    if (isWin) {
      run('py', ['-3', '-m', 'venv', venvDir]);
    } else {
      run('python3', ['-m', 'venv', venvDir]);
    }
  }

  const requirements = readFileSync(path.join(backendDir, 'requirements.txt'));
  const hash = createHash('sha256').update(requirements).digest('hex');
  const current = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';
  if (current !== hash) {
    console.log('Installing Python packages...');
    run(pythonExe, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: backendDir });
    writeFileSync(stampPath, hash);
  }
}

ensureFrontend();
ensureBackend();

const children = [];
let shuttingDown = false;

function start(command, args, cwd, shell = false) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', shell });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const api = start(
  pythonExe,
  ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
  backendDir
);
api.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('API stopped.');
    shutdown(code ?? 1);
  }
});

async function waitForApi() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const response = await fetch('http://127.0.0.1:8000/health');
      if (response.ok) return true;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.error('The API did not become ready. Check the log above.');
  shutdown(1);
  return false;
}

const ready = await waitForApi();
if (!ready) {
  process.exit(1);
}

const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const web = start(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173'], frontendDir);
web.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('Frontend stopped.');
    shutdown(code ?? 1);
  }
});

console.log('');
console.log('Meridian ERP is running');
console.log('App:   http://localhost:5173');
console.log('API:   http://localhost:8000/docs');
console.log('Login: admin@example.com / Password123!');
console.log('');
