import { workerData, parentPort } from 'worker_threads';
import { PyodideManager } from './build/lib/pyodide/pyodide-manager.js';

const pyodideManager = PyodideManager.getInstance();
// first time init
await pyodideManager.initialize('./cache');
await pyodideManager.mountDirectory('data', `data`);
const pyodide = pyodideManager.getPyodide();
pyodide.FS.chdir('/mnt/data');

// Function to extract Python packages from a Python script
function extractPythonPackages(pythonCode) {
  const regex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match;
  const packages = new Set();

  while ((match = regex.exec(pythonCode)) !== null) {
    packages.add(match[1]);
  }
  return Array.from(packages);
}

// run code
if (workerData.cmd === 'runCode') {
  const packages = extractPythonPackages(workerData.code);
  await Promise.all(packages.map((pkg) => pyodideManager.installPackage(pkg)));
  const response = await pyodideManager.executePython(workerData.code);
  parentPort.postMessage({ cmd: 'response', result: response });
}
