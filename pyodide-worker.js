import fs from "fs";
import { workerData, parentPort } from "worker_threads";
import { PyodideManager } from "./build/lib/pyodide/pyodide-manager.js";

const TEST_CACHE_DIR = "./cache";

// run code
if (workerData.cmd === "runCode") {
  if (!workerData.sessionId) {
    throw new Error("sessionId is required");
  }
  const pyodideManager = new PyodideManager(workerData.sessionId);
  // first time init
  const isInitialized = await pyodideManager.initialize(TEST_CACHE_DIR);
  if (!isInitialized) {
    throw new Error("Failed to initialize Pyodide");
  }
  const mountResult = await pyodideManager.mountDirectory();
  pyodideManager.chdir();
  if (!mountResult) {
    throw new Error("Failed to mount directory");
  }

  await pyodideManager.installPackages(workerData.code);
  const response = await pyodideManager.executePython(workerData.code);
  parentPort.postMessage({ cmd: "response", result: response });
}
