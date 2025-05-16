import fs from "fs";
import { workerData, parentPort } from "worker_threads";
import { PyodideManager } from "./build/lib/pyodide/pyodide-manager.js";

const TEST_CACHE_DIR = "./cache";

// run code
if (workerData.cmd === "runCode") {
  if (!workerData.sessionId) {
    throw new Error("sessionId is required");
  }
  const pyodideManager = PyodideManager.getInstance(workerData.sessionId);
  // first time init
  const installPackageExists = fs.existsSync(TEST_CACHE_DIR);
  const isInitialized = await pyodideManager.initialize(
    TEST_CACHE_DIR,
    !installPackageExists
  );
  if (!isInitialized) {
    throw new Error("Failed to initialize Pyodide");
  }
  await pyodideManager.mountDirectory("data", "data");
  const response = await pyodideManager.executePython(workerData.code);
  parentPort.postMessage({ cmd: "response", result: response });
}
