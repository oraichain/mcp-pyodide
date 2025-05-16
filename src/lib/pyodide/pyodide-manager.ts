import { loadPyodide } from "pyodide";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";

import { withOutputCapture } from "../../utils/output-capture.js";
import {
  formatCallToolError,
  formatCallToolSuccess,
} from "../../formatters/index.js";
import { Worker } from "worker_threads";

import type { PyodideInterface } from "pyodide";

// Mock logger (replace with actual implementation)
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn,
};

// Download wheel files
async function downloadWheel(url: string, destPath: string): Promise<string> {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https:") ? https : http;
    const file = fs.createWriteStream(destPath);

    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadWheel(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
        }
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);

      file.on("finish", () => {
        file.close();
        resolve(path.resolve(destPath));
      });
    });

    request.on("error", (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
    file.on("error", (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

// Get wheel URL from PyPI
async function getWheelUrl(packageName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://pypi.org/pypi/${packageName}/json`;
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(`Failed to get package info: ${response.statusCode}`)
          );
          return;
        }
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            const packageInfo = JSON.parse(data);
            const releases = packageInfo.releases[packageInfo.info.version];
            const wheel = releases.find(
              (release: any) =>
                release.packagetype === "bdist_wheel" &&
                release.filename.includes("py3-none-any.whl")
            );
            if (wheel) resolve(wheel.url);
            else reject(new Error(`No compatible wheel for ${packageName}`));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

class PyodideManager {
  private pyodide: PyodideInterface | null = null;
  private sessionId: string;
  public readonly allowedPackages: string[] = [
    "numpy",
    "scipy",
    "sympy",
    "matplotlib",
    "seaborn",
    "plotly",
    "os",
    "pathlib",
    "pandas",
    "mistune",
    "PyPDF2",
    "reportlab",
  ];
  public readonly pyodideNativeSupportedPackages: string[] = [
    "contourpy",
    "cycler",
    "fonttools",
    "kiwisolver",
    "matplotlib",
    "matplotlib-pyodide",
    "mpmath",
    "numpy",
    "openblas",
    "packaging",
    "pandas",
    "pyparsing",
    "python-dateutil",
    "pytz",
    "scipy",
    "six",
    "sympy",
  ];
  private basePath: string = "/workspace";
  private hostPath: string = "workspace";
  public constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async initialize(packageCacheDir: string): Promise<boolean> {
    try {
      logger.error("Initializing Pyodide...");
      if (this.pyodide) {
        logger.error("Pyodide already initialized");
        return true;
      }
      this.pyodide = await loadPyodide({
        packageCacheDir,
        stdout: () => {},
        stderr: () => {},
        jsglobals: {
          AbortController,
          clearInterval,
          clearTimeout,
          setInterval,
          setTimeout,
          ImageData: {},
          document: {
            getElementById: (id: any) => {
              if (id.includes("canvas")) return null;
              else
                return {
                  addEventListener: () => {},
                  style: {},
                  classList: { add: () => {}, remove: () => {} },
                  setAttribute: () => {},
                  appendChild: () => {},
                  remove: () => {},
                };
            },
            createElement: () => ({
              addEventListener: () => {},
              style: {},
              classList: { add: () => {}, remove: () => {} },
              setAttribute: () => {},
              appendChild: () => {},
              remove: () => {},
            }),
            createTextNode: () => ({
              addEventListener: () => {},
              style: {},
              classList: { add: () => {}, remove: () => {} },
              setAttribute: () => {},
              appendChild: () => {},
              remove: () => {},
            }),
            body: {
              appendChild: () => {},
            },
          },
          fetch: () => Promise.reject(new Error("Network access disabled")),
          XMLHttpRequest: function () {
            throw new Error("Network access disabled");
          },
        },
      });
      this.pyodide.globals.set("js", undefined);

      await this.pyodide.runPythonAsync(`
        import sys
        import socket
        import urllib.request

        def blocked_opener(*args, **kwargs):
          raise RuntimeError("Network access disabled")
        urllib.request.urlopen = blocked_opener

        # Block socket operations
        def blocked_socket_op(*args, **kwargs):
            raise RuntimeError("Network access disabled")
        socket.create_connection = blocked_socket_op
        socket.socket = blocked_socket_op  # Block socket creation
        socket.gethostbyname = blocked_socket_op  # Block DNS resolution
      `);

      this.pyodide.FS.mkdirTree("/tmp");
      // this.pyodide.FS.chmod("/tmp", 0o555);

      logger.info("Pyodide initialized");
      return true;
    } catch (error) {
      logger.error("Failed to initialize Pyodide with error:", error);
      return false;
    }
  }

  getPyodide(): PyodideInterface | null {
    return this.pyodide;
  }

  private getSessionMountPoint(): string {
    return `${this.basePath}/${this.sessionId}`;
  }

  private chdir() {
    if (!this.pyodide) return;
    const mountPoint = this.getSessionMountPoint();
    this.pyodide.FS.chdir(mountPoint);
  }

  async mountDirectory(): Promise<boolean> {
    if (!this.pyodide) return false;
    try {
      const absolutePathWithSessionId = path.resolve(
        `${this.hostPath}/${this.sessionId}`
      );
      const regexCheck = /^\/etc|\/root|\.\.\/?/;
      if (
        regexCheck.test(absolutePathWithSessionId) ||
        regexCheck.test(this.hostPath)
      ) {
        throw new Error("Mounting restricted paths not allowed");
      }
      if (!fs.existsSync(absolutePathWithSessionId)) {
        fs.mkdirSync(absolutePathWithSessionId, { recursive: true });
      }
      const mountPoint = this.getSessionMountPoint();
      logger.error(`Mounting ${mountPoint} to ${absolutePathWithSessionId}`);
      this.pyodide.FS.mkdirTree(mountPoint);
      this.pyodide.FS.mount(
        this.pyodide.FS.filesystems.NODEFS,
        { root: absolutePathWithSessionId },
        mountPoint
      );
      this.chdir();
      return true;
    } catch (error) {
      return false;
    }
  }

  async listMountedDirectory() {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    const mountPoint = this.getSessionMountPoint();
    if (!mountPoint) return formatCallToolError(`Mount point not found`);
    try {
      const pythonCode = `
import os
def list_directory(path):
    contents = []
    try:
        for item in os.listdir(path):
            full_path = os.path.join(path, item)
            if os.path.isfile(full_path):
                contents.append(f"FILE: {item}")
            elif os.path.isdir(full_path):
                contents.append(f"DIR: {item}")
    except Exception as e:
        print(f"Error listing directory: {e}")
        return []
    return contents
list_directory("${mountPoint}")
`;

      return await this.executePython(pythonCode);
    } catch (error) {
      return formatCallToolError(error);
    }
  }

  // call this externally, which will call the worker
  async runCode(code: string, timeout: number = 10000): Promise<any> {
    const pyodideWorkerPath = "./pyodide-worker.js";
    const worker = new Worker(pyodideWorkerPath, {
      workerData: {
        cmd: "runCode",
        code,
        sessionId: this.sessionId,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 500, // Limit heap size to 100 MB
        maxYoungGenerationSizeMb: 500,
      },
    });
    try {
      return await new Promise((resolve, reject) => {
        worker.on("message", (msg) => {
          if (msg.cmd === "response") {
            resolve(msg.result);
          }
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code: ${code}`));
          }
        });
        setTimeout(() => {
          resolve(new Error("Timeout error"));
        }, timeout);
      });
    } catch (ex) {
      throw ex;
    } finally {
      worker.terminate();
    }
  }

  private async executePython(code: string) {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    if (code.includes("micropip")) {
      return formatCallToolError("Package installation disabled");
    }
    try {
      const { result, output } = await withOutputCapture(
        this.pyodide,
        async () => {
          const executionResult = await this.pyodide!.runPythonAsync(code);
          // Memory cleanup
          this.pyodide!.globals.clear();
          await this.pyodide!.runPythonAsync("import gc; gc.collect()");

          return executionResult;
        },
        { suppressConsole: true }
      );
      return formatCallToolSuccess(
        output
          ? `Output:\n${output}\nResult:\n${String(result)}`
          : String(result)
      );
    } catch (error) {
      return formatCallToolError(error);
    }
  }

  async installPackages(code: string) {
    console.time("installPackages");
    const packages = extractPythonPackages(code);
    const allowedPackages = packages.filter((pkg) =>
      this.allowedPackages.includes(pkg)
    );
    const nativePackages = allowedPackages.filter((pkg) =>
      this.pyodideNativeSupportedPackages.includes(pkg)
    );
    const micropipPackages = allowedPackages.filter(
      (pkg) => !this.pyodideNativeSupportedPackages.includes(pkg)
    );
    console.time("installPackages");
    if (!this.pyodide) throw new Error("Pyodide not initialized");
    await Promise.allSettled([
      this.pyodide.loadPackage(nativePackages),
      this.installMicropipPackages(micropipPackages),
    ]);
    console.timeEnd("installPackages");
  }

  private async installMicropipPackages(packages: string[]) {
    if (!this.pyodide) throw new Error("Pyodide not initialized");
    if (packages.length === 0) return;
    const [_, wheelInstallationPaths] = await Promise.all([
      this.pyodide.loadPackage("micropip", {
        messageCallback: (msg) => {
          console.log(msg);
        },
      }),
      this.downloadPackagesUsingWheel(packages),
    ]);
    if (wheelInstallationPaths.length === 0) return;
    const installScript = `import micropip\n${wheelInstallationPaths.join(
      "\n"
    )}`;
    logger.info("Install script: ", installScript);
    const { output } = await withOutputCapture(
      this.pyodide,
      async () => {
        await this.pyodide!.runPythonAsync(installScript);
      },
      { suppressConsole: true }
    );
    logger.info("Output installMicropipPackages: ", output);
  }

  private async downloadPackagesUsingWheel(packages: string[]) {
    if (!this.pyodide) throw new Error("Pyodide not initialized");
    const tempDir = process.env.PYODIDE_CACHE_DIR || "./cache";
    const basePyodideWheelsPath = "/tmp/wheels";

    // Ensure tempDir exists
    if (fs.existsSync(tempDir)) {
      // Read wheel files asynchronously
      let existingWheelFiles: string[] = [];
      try {
        existingWheelFiles = (await fs.promises.readdir(tempDir)).filter(
          (file) =>
            file.endsWith(".whl") &&
            file.includes("py3-none-any") &&
            packages.some((pkg) =>
              file.toLowerCase().includes(pkg.toLowerCase())
            )
        );
      } catch (error) {
        logger.error("Error reading tempDir:", error);
        return []; // Return empty scripts on error
      }
      this.pyodide.FS.mkdirTree(basePyodideWheelsPath);

      // Process wheels in parallel
      const installScripts = await Promise.all(
        existingWheelFiles.map(async (file) => {
          try {
            const localWheelPath = path.join(tempDir, file);
            const pyodideWheelPath = `${basePyodideWheelsPath}/${file}`;

            // Read and write wheel data asynchronously
            const wheelData = await fs.promises.readFile(localWheelPath);
            this.pyodide!.FS.writeFile(pyodideWheelPath, wheelData);
            // Add install script
            return `await micropip.install("emfs:${pyodideWheelPath}")`;
          } catch (error) {
            logger.error(`Error processing wheel ${file}:`, error);
            return "";
          }
        })
      );
      return installScripts.filter(Boolean);
    }

    await fs.promises.mkdir(tempDir, { recursive: true });
    // Create /tmp/wheels in Pyodide's filesystem
    this.pyodide.FS.mkdirTree(basePyodideWheelsPath);
    const installScripts = await Promise.all(
      packages.map(async (pkg) => {
        try {
          const wheelUrl = await getWheelUrl(pkg);
          const wheelFilename = path.basename(wheelUrl);
          const localWheelPath = path.join(tempDir, wheelFilename);

          await downloadWheel(wheelUrl, localWheelPath);
          const wheelData = await fs.promises.readFile(localWheelPath);
          const pyodideWheelPath = `${basePyodideWheelsPath}/${wheelFilename}`;
          this.pyodide!.FS.writeFile(pyodideWheelPath, wheelData);
          return `await micropip.install("emfs:${pyodideWheelPath}")`;
        } catch (error) {
          logger.error("Error downloading wheel for package: ", pkg, error);
          return "";
        }
      })
    );
    return installScripts.filter(Boolean);
  }
}

function extractPythonPackages(pythonCode: string): string[] {
  const regex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match: RegExpExecArray | null;
  const packages = new Set<string>();

  while ((match = regex.exec(pythonCode)) !== null) {
    packages.add(match[1]);
  }

  return Array.from(packages);
}

export { PyodideManager };
