import assert from "assert";
import { PyodideManager } from "../src/lib/pyodide/pyodide-manager.js";
import path from "path";
import fs from "fs";

const TEST_CACHE_DIR = "./cache";
(async () => {
  const TEST_SESSION_ID = "test-session";
  if (!fs.existsSync(TEST_CACHE_DIR)) {
    fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
  }
  const pyodideManager = PyodideManager.getInstance(TEST_SESSION_ID);

  function logResult(name, passed, error) {
    if (passed) {
      console.log(`✅ ${name}`);
    } else {
      console.error(`❌ ${name}: ${error}`);
      process.exit(1);
    }
  }

  function getErrorText(result: any): string {
    if (
      result &&
      Array.isArray(result.content) &&
      typeof result.content[0]?.text === "string"
    ) {
      return result.content[0].text;
    }
    return String(result);
  }

  // Helper to run and assert
  async function check(name, fn) {
    try {
      await fn();
      logResult(name, true, null);
    } catch (e) {
      logResult(name, false, e);
    }
  }

  // --- Test cases ---

  await check(
    "Prevent infinite loops/resource exhaustion (while True)",
    async () => {
      const result = await pyodideManager.runCode(
        `while True: pass`,
        2000
      );
      const errorText = getErrorText(result);
      console.log("DEBUG errorText: ", errorText);
      assert(errorText.includes("Timeout error"));
    }
  );

  await check(
    "Prevent infinite loops/resource exhaustion (large alloc)",
    async () => {
      const result = await pyodideManager.runCode(
        `x = [0] * 10**9`
      );
      const errorText = getErrorText(result);
      assert(
        errorText.includes("Execution timeout") ||
          errorText.includes("MemoryError")
      );
    }
  );

  await check(
    "Prevent package installation post-initialization (micropip)",
    async () => {
      let result = await pyodideManager.runCode(
        `import micropip\nmicropip.install('requests')`
      );
      const errorText = getErrorText(result);
      assert(
        errorText.includes("Package installation disabled"),
        "Should block micropip.install after initialization"
      );
    }
  );

  await check(
    "Restrict to pre-installed packages (import requests)",
    async () => {
      const result = await pyodideManager.runCode(`import requests`);
      const errorText = getErrorText(result);
      assert(
        errorText.includes("ModuleNotFoundError") ||
          errorText.includes("ImportError")
      );
    }
  );

  await check(
    "Restrict to pre-installed packages (import non_existent_module)",
    async () => {
      const result = await pyodideManager.runCode(
        `import non_existent_module`
      );
      const errorText = getErrorText(result);
      assert(
        errorText.includes("ModuleNotFoundError") ||
          errorText.includes("ImportError")
      );
    }
  );

  await check("Block network access (urllib)", async () => {
    const result = await pyodideManager.runCode(
      `import urllib.request\nurllib.request.urlopen('http://example.com')`
    );
    const errorText = getErrorText(result);
    assert(errorText.includes("Network access disabled"));
  });

  await check("Block network access (httpx)", async () => {
    const result = await pyodideManager.runCode(
      `import httpx\nhttpx.get('http://example.com')`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("ModuleNotFoundError") ||
        errorText.includes("ImportError")
    );
  });

  await check("Restrict file system access (open /etc/passwd)", async () => {
    const result = await pyodideManager.runCode(
      `open('/etc/passwd', 'r').read()`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("FileNotFoundError") ||
        errorText.includes("Permission denied")
    );
  });

  await check("Restrict file system mounting", async () => {
    let result = await pyodideManager.mountDirectory("/root", "/root");
    assert(result === false, "Should not be able to mount /root");

    result = await pyodideManager.mountDirectory("/root", "/etc");
    assert(result === false, "Should not be able to mount /etc");

    result = await pyodideManager.mountDirectory("/root", "../");
    assert(result === false, "Should not be able to mount ../");
  });

  await check("Restrict file system access (os.listdir /root)", async () => {
    const result = await pyodideManager.runCode(
      `import os\nos.listdir('/root')`
    );
    const errorText = getErrorText(result);
    assert(errorText.includes("No such file or directory: '/root'"));
  });

  await check(
    "Block host port/IP scanning (socket.create_connection)",
    async () => {
      const result = await pyodideManager.runCode(
        `import socket\nsocket.create_connection(('localhost', 80))`
      );
      const errorText = getErrorText(result);
      assert(errorText.includes("Network access disabled"));
    }
  );

  await check(
    "Block host port/IP scanning (socket.gethostbyname)",
    async () => {
      const result = await pyodideManager.runCode(
        `import socket\nsocket.gethostbyname('localhost')`
      );
      const errorText = getErrorText(result);
      assert(
        errorText.includes("Network access disabled") ||
          errorText.includes("ImportError")
      );
    }
  );

  await check("Prevent host port/service calls (socket.connect)", async () => {
    const result = await pyodideManager.runCode(
      `import socket\ns = socket.socket()\ns.connect(('127.0.0.1', 22))`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("Network access disabled") ||
        errorText.includes("ImportError")
    );
  });

  await check(
    "Prevent host port/service calls (urllib localhost)",
    async () => {
      const result = await pyodideManager.runCode(
        `import urllib.request\nurllib.request.urlopen('http://localhost:8080')`
      );
      const errorText = getErrorText(result);
      assert(errorText.includes("Network access disabled"));
    }
  );

  await check("Restrict cross-mount directory access", async () => {
    const testDir1 = path.join(TEST_CACHE_DIR, "instance1");
    fs.mkdirSync(testDir1, { recursive: true });
    await pyodideManager.mountDirectory("instance1", testDir1);
    const result = await pyodideManager.runCode(
      `open('/mnt/other_instance/file.txt', 'r').read()`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("FileNotFoundError") ||
        errorText.includes("Permission denied")
    );
  });

  await check("Restrict Pyodide internal API access", async () => {
    const result = await pyodideManager.runCode(
      `pyodide._api.run_js('malicious_code()')`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("NameError") ||
        errorText.includes("AttributeError") ||
        errorText.includes("ImportError")
    );
  });

  // await check("Prevent DoS via large file operations", async () => {
  //   const result = await pyodideManager.runCode(
  //     `import numpy as np\narr = np.ones((10000, 10000))\nprint("Allocated memory: ", arr.nbytes)`
  //   );
  //   const errorText = getErrorText(result);
  //   console.log("DEBUG errorText: ", errorText);
  //   assert(
  //     errorText.includes("Execution timeout") ||
  //       errorText.includes("MemoryError")
  //   );
  // });

  await check("Block environment variable access (sys._getframe)", async () => {
    const result = await pyodideManager.runCode(
      `import sys\nsys._getframe().f_locals`
    );
    const errorText = getErrorText(result);
    assert(
      errorText.includes("AttributeError") || errorText.includes("ImportError")
    );
  });

  console.log("All security tests passed!");
})();
