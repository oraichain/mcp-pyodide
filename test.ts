import { PyodideManager } from "./src/lib/pyodide/pyodide-manager.js";

(async () => {
  const pyodideManager = PyodideManager.getInstance("local-testing");
  const ret = await pyodideManager.runCode(
    `
    import time
    while True:
      time.sleep(1)
    `,
    2000
  );
  console.log(ret);
  process.exit();
})();
