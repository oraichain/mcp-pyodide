import { workerData, parentPort } from 'worker_threads';
import { PyodideManager } from './build/lib/pyodide/pyodide-manager.js';

const pyodideManager = PyodideManager.getInstance();
// first time init
await pyodideManager.initialize('./cache');
await pyodideManager.mountDirectory('data', `data`);
pyodideManager.getPyodide().FS.chdir('/mnt/data');

// Regex to extract Python packages from a Python script
const regex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
let match;

// run code
if (workerData.cmd === 'runCode') {
  while ((match = regex.exec(workerData.code)) !== null) {
    await pyodideManager.installPackage(match[1]);
  }
  const response = await pyodideManager.executePython(workerData.code);
  parentPort.postMessage({ cmd: 'response', result: response });
}
