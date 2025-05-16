import { loadPyodide } from "pyodide";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as http from "http";

import { withOutputCapture } from "../../utils/output-capture.js";
import {
  formatCallToolError,
  formatCallToolSuccess,
  contentFormatters,
} from "../../formatters/index.js";
import { MIME_TYPES } from "../../lib/mime-types/index.js";
import { Worker } from "worker_threads";

import type { PyodideInterface } from "pyodide";

// Basic mount point configuration
interface MountConfig {
  hostPath: string;
  mountPoint: string;
}

interface ResourceInfo {
  name: string;
  uri: string;
  mimeType: string;
}

// Mock logger (replace with actual implementation)
const logger = {
  info: console.log,
  error: console.error,
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
  private static instances: Map<string, PyodideManager> = new Map();
  private pyodide: PyodideInterface | null = null;
  private sessionId: string;
  private mountPoints: Map<string, MountConfig> = new Map();
  public readonly preInstalledPackages: string[] = [
    "numpy",
    "scipy",
    "sympy",
    "matplotlib",
    "seaborn",
    "plotly",
    "os",
    "pathlib",
    "pandas",
    "markdown",
    "mistune",
    "PyPDF2",
    "reportlab",
  ];
  private basePath: string = "/mnt";

  private constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  static getInstance(sessionId: string): PyodideManager {
    if (!PyodideManager.instances.has(sessionId))
      PyodideManager.setInstance(sessionId, new PyodideManager(sessionId));
    return PyodideManager.instances.get(sessionId)!;
  }

  static setInstance(sessionId: string, instance: PyodideManager) {
    PyodideManager.instances.set(sessionId, instance);
  }

  async initialize(
    packageCacheDir: string,
    installPackages: boolean = true
  ): Promise<boolean> {
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

      // Pre-install packages
      logger.info("Pre-installing packages...");
      if (installPackages) {
        await this.installPackage(this.preInstalledPackages.join(" "));
      }
      logger.info("Packages pre-installed");

      // Disable package installation
      this.installPackage = async () => {
        throw new Error("Package installation disabled");
      };
      await this.pyodide.runPythonAsync(`
        import sys
        import socket
        sys.modules['micropip'] = None
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

  private getSessionMountPoint(path: string): string {
    const sessionMountPath = `${this.basePath}/${this.sessionId}`;
    return `${sessionMountPath}/${path}`;
  }

  chdir(path: string) {
    if (!this.pyodide) return;
    const mountPoint = this.getSessionMountPoint(path);
    this.pyodide.FS.chdir(mountPoint);
  }

  async mountDirectory(name: string, hostPath: string): Promise<boolean> {
    if (!this.pyodide) return false;
    try {
      const absolutePathWithSessionId = path.resolve(
        `${hostPath}/${this.sessionId}`
      );
      const regexCheck = /^\/etc|\/root|\.\.\/?/;
      if (
        regexCheck.test(absolutePathWithSessionId) ||
        regexCheck.test(hostPath)
      ) {
        throw new Error("Mounting restricted paths not allowed");
      }
      if (!fs.existsSync(absolutePathWithSessionId)) {
        fs.mkdirSync(absolutePathWithSessionId, { recursive: true });
      }
      const mountPoint = this.getSessionMountPoint(name);
      this.pyodide.FS.mkdirTree(mountPoint);
      this.pyodide.FS.mount(
        this.pyodide.FS.filesystems.NODEFS,
        { root: absolutePathWithSessionId },
        mountPoint
      );
      this.mountPoints.set(mountPoint, {
        hostPath: absolutePathWithSessionId,
        mountPoint,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  async getMountPoints() {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    try {
      const mountPoints = Array.from(this.mountPoints.entries()).map(
        ([name, config]) => ({
          name,
          hostPath: config.hostPath,
          mountPoint: config.mountPoint,
        })
      );
      return formatCallToolSuccess(JSON.stringify(mountPoints, null, 2));
    } catch (error) {
      return formatCallToolError(error);
    }
  }

  async listMountedDirectory(mountName: string) {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    const mountConfig = this.mountPoints.get(mountName);
    if (!mountConfig)
      return formatCallToolError(`Mount point not found: ${mountName}`);
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
list_directory("${mountConfig.mountPoint}")
`;

      return await this.executePython(pythonCode);
    } catch (error) {
      return formatCallToolError(error);
    }
  }

  getMountNameFromPath(filePath: string): string | null {
    if (!filePath) return null;
    const normalizedPath = filePath.replace(/\\/g, "/");
    let longestMatch = "";
    let matchedMountName: string | null = null;
    for (const [mountName, config] of this.mountPoints.entries()) {
      const normalizedHostPath = config.hostPath.replace(/\\/g, "/");
      if (
        normalizedPath.startsWith(normalizedHostPath) &&
        normalizedHostPath.length > longestMatch.length
      ) {
        longestMatch = normalizedHostPath;
        matchedMountName = mountName;
      }
    }
    return matchedMountName;
  }

  getMountPointInfo(uri: string) {
    let filePath = uri.replace("file://", "");
    for (const [mountName, config] of this.mountPoints.entries()) {
      const mountPoint = config.mountPoint;
      if (filePath.startsWith(mountPoint)) {
        const relativePath = filePath
          .slice(mountPoint.length)
          .replace(/^[/\\]+/, "");
        return { mountName, mountPoint, relativePath };
      }
    }
    return null;
  }

  // call this externally, which will call the worker
  async runCode(code: string, timeout: number = 10000): Promise<any> {
    const pyodideWorkerPath = "./pyodide-worker.js";
    const worker = new Worker(pyodideWorkerPath, {
      workerData: { cmd: "runCode", code, sessionId: this.sessionId },
      resourceLimits: {
        maxOldGenerationSizeMb: 100, // Limit heap size to 100 MB
        maxYoungGenerationSizeMb: 100,
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

  async installPackage(packageName: string) {
    if (!this.pyodide) throw new Error("Pyodide not initialized");
    try {
      const packages = packageName
        .split(" ")
        .map((pkg) => pkg.trim())
        .filter(Boolean);
      if (packages.length === 0) throw new Error("No valid package names");
      const outputs: string[] = [];
      for (const pkg of packages) {
        try {
          // 1. まずpyodide.loadPackageでインストールを試みる
          outputs.push(`Attempting to install ${pkg} using loadPackage...`);

          try {
            await this.pyodide.loadPackage(pkg, {
              messageCallback: (msg) => {
                outputs.push(`loadPackage: ${msg}`);
              },
              errorCallback: (err) => {
                throw new Error(err);
              },
            });
            outputs.push(`Successfully installed ${pkg} using loadPackage.`);
            continue; // このパッケージは成功したので次のパッケージへ
          } catch (loadPackageError) {
            outputs.push(
              `loadPackage failed for ${pkg}: ${
                loadPackageError instanceof Error
                  ? loadPackageError.message
                  : String(loadPackageError)
              }`
            );
            outputs.push(`Falling back to micropip for ${pkg}...`);

            // loadPackageが失敗した場合は、micropipを使用する
            // micropipがまだロードされていない場合はロードする
            try {
              // micropipをロードする
              await this.pyodide.loadPackage("micropip", {
                messageCallback: (msg) => {
                  outputs.push(`loadPackage: ${msg}`);
                },
                errorCallback: (err) => {
                  throw new Error(err);
                },
              });
            } catch (micropipLoadError) {
              throw new Error(
                `Failed to load micropip: ${
                  micropipLoadError instanceof Error
                    ? micropipLoadError.message
                    : String(micropipLoadError)
                }`
              );
            }

            // 2. micropipを使ったインストール処理
            // 一時ディレクトリを作成
            const tempDir = process.env.PYODIDE_CACHE_DIR || "./cache";
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }

            // Pyodide内のtempディレクトリを作成
            this.pyodide.FS.mkdirTree("/tmp/wheels");

            // PyPIからwheelのURLを取得
            const wheelUrl = await getWheelUrl(pkg);
            const wheelFilename = path.basename(wheelUrl);
            const localWheelPath = path.join(tempDir, wheelFilename);

            // wheelをダウンロード
            outputs.push(`Downloading wheel for ${pkg}...`);
            await downloadWheel(wheelUrl, localWheelPath);

            // wheelをPyodideのファイルシステムにコピー
            const wheelData = fs.readFileSync(localWheelPath);
            const pyodideWheelPath = `/tmp/wheels/${wheelFilename}`;
            this.pyodide.FS.writeFile(pyodideWheelPath, wheelData);

            // micropipでインストール
            const { output } = await withOutputCapture(
              this.pyodide,
              async () => {
                await this.pyodide!.runPythonAsync(`
                  import micropip
                  await micropip.install("emfs:${pyodideWheelPath}")
                `);
              },
              { suppressConsole: true }
            );

            outputs.push(
              `Successfully installed ${pkg} using micropip: ${output}`
            );
          }
        } catch (error) {
          // 個別のパッケージのエラーを記録して続行
          outputs.push(`loadPackage failed for ${pkg}: ${String(error)}`);
          outputs.push(`Falling back to micropip...`);
          const tempDir = process.env.PYODIDE_CACHE_DIR || "./cache";
          if (!fs.existsSync(tempDir))
            fs.mkdirSync(tempDir, { recursive: true });

          this.pyodide.FS.mkdirTree("/tmp/wheels");

          const wheelUrl = await getWheelUrl(pkg);
          const wheelFilename = path.basename(wheelUrl);
          const localWheelPath = path.join(tempDir, wheelFilename);
          outputs.push(`Downloading wheel for ${pkg}...`);
          await downloadWheel(wheelUrl, localWheelPath);
          const wheelData = fs.readFileSync(localWheelPath);
          const pyodideWheelPath = `/tmp/wheels/${wheelFilename}`;
          this.pyodide.FS.writeFile(pyodideWheelPath, wheelData);
          const { output } = await withOutputCapture(
            this.pyodide,
            async () => {
              await this.pyodide!.runPythonAsync(`
                import micropip
                await micropip.install("emfs:${pyodideWheelPath}")
              `);
            },
            { suppressConsole: true }
          );
          outputs.push(`Installed ${pkg} using micropip: ${output}`);
        }
      }
      return formatCallToolSuccess(outputs.join("\n\n"));
    } catch (error) {
      return formatCallToolError(error);
    }
  }

  async readResource(
    mountName: string,
    resourcePath: string
  ): Promise<{ blob: string; mimeType: string } | { error: string }> {
    if (!this.pyodide) return { error: "Pyodide not initialized" };
    const mountConfig = this.mountPoints.get(mountName);
    if (!mountConfig) return { error: `Mount point not found: ${mountName}` };
    try {
      const fullPath = path.join(mountConfig.hostPath, resourcePath);
      if (!fs.existsSync(fullPath))
        return { error: `File not found: ${fullPath}` };
      const ext = path.extname(fullPath).toLowerCase();
      const mimeType = MIME_TYPES[ext];
      if (!mimeType) return { error: `Unsupported format: ${ext}` };
      const imageBuffer = await fs.promises.readFile(fullPath);
      const base64Data = imageBuffer.toString("base64");
      return { blob: base64Data, mimeType };
    } catch (error) {
      return { error: String(error) };
    }
  }

  async listResources(): Promise<ResourceInfo[]> {
    const resources: ResourceInfo[] = [];
    const validMimeTypes = new Set(Object.values(MIME_TYPES));
    const isMatchingMimeType = (filePath: string): string | null => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext];
      return mimeType && validMimeTypes.has(mimeType) ? mimeType : null;
    };
    const scanDirectory = (dirPath: string): void => {
      try {
        const items = fs.readdirSync(dirPath);
        const mountName = this.getMountNameFromPath(dirPath);
        if (!mountName) return;
        const config = this.mountPoints.get(mountName);
        if (!config) return;
        const { hostPath, mountPoint } = config;
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDirectory(fullPath);
          } else if (stat.isFile()) {
            const mimeType = isMatchingMimeType(item);
            if (mimeType) {
              const relativePath = path.relative(hostPath, fullPath);
              const uri = `file://${path.join(mountPoint, relativePath)}`;
              resources.push({ name: item, uri, mimeType });
            }
          }
        }
      } catch (error) {
        logger.error(`Error scanning ${dirPath}:`, error);
      }
    };
    for (const [_, config] of this.mountPoints.entries()) {
      scanDirectory(config.hostPath);
    }
    return resources;
  }

  async readImage(mountName: string, imagePath: string) {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    try {
      const resource = await this.readResource(mountName, imagePath);
      if ("error" in resource) return formatCallToolError(resource.error);
      const content = contentFormatters.formatImage(
        resource.blob,
        resource.mimeType
      );
      return formatCallToolSuccess(content);
    } catch (error) {
      return formatCallToolError(error);
    }
  }
}

export { PyodideManager };
