import { loadPyodide, PyodideInterface } from "pyodide";
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
  private preInstalledPackages: string[] = [
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

  private constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  static getInstance(sessionId: string): PyodideManager {
    if (!PyodideManager.instances.has(sessionId))
      PyodideManager.instances.set(sessionId, new PyodideManager(sessionId));
    return PyodideManager.instances.get(sessionId)!;
  }

  static setInstance(sessionId: string, instance: PyodideManager) {
    PyodideManager.instances.set(sessionId, instance);
  }

  async initialize(packageCacheDir: string): Promise<boolean> {
    try {
      logger.error("Initializing Pyodide...");
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
      await this.installPackage(this.preInstalledPackages.join(" "));
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

      // // Restrict /tmp
      this.pyodide.FS.mkdirTree("/tmp");
      // this.pyodide.FS.chmod("/tmp", 0o555);

      logger.info("Pyodide initialized");
      return true;
    } catch (error) {
      logger.error("Failed to initialize Pyodide:", error);
      return false;
    }
  }

  getPyodide(): PyodideInterface | null {
    return this.pyodide;
  }

  async mountDirectory(name: string, hostPath: string): Promise<boolean> {
    if (!this.pyodide) return false;
    try {
      const absolutePathWithSessionId = path.resolve(
        `${hostPath}/${this.sessionId}`
      );
      const regexCheck = /^\/etc|\/root|\.\.\/?/;
      if (regexCheck.test(absolutePathWithSessionId) || regexCheck.test(hostPath)) {
        throw new Error("Mounting restricted paths not allowed");
      }
      if (!fs.existsSync(absolutePathWithSessionId)) {
        fs.mkdirSync(absolutePathWithSessionId, { recursive: true });
      }
      const nameWithSessionId = `${this.sessionId}/${name}`;
      const mountPoint = `/mnt/${nameWithSessionId}`;
      this.pyodide.FS.mkdirTree(mountPoint);
      this.pyodide.FS.mount(
        this.pyodide.FS.filesystems.NODEFS,
        { root: absolutePathWithSessionId, readOnly: true },
        mountPoint
      );
      this.mountPoints.set(nameWithSessionId, {
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

      return await this.executePython(pythonCode, 5000);
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

  async executePython(code: string, timeout: number = 5000) {
    if (!this.pyodide) return formatCallToolError("Pyodide not initialized");
    if (code.includes("micropip")) {
      return formatCallToolError("Package installation disabled");
    }
    try {
      const { result, output } = await withOutputCapture(
        this.pyodide,
        async () => {
          const executionResult = await Promise.race([
            this.pyodide!.runPythonAsync(code),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Execution timeout")), timeout)
            ),
          ]);
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
      if (!packages.length) throw new Error("No valid package names");
      const outputs: string[] = [];
      for (const pkg of packages) {
        try {
          outputs.push(`Installing ${pkg} using loadPackage...`);
          await this.pyodide.loadPackage(pkg, {
            messageCallback: (msg) => outputs.push(`loadPackage: ${msg}`),
            errorCallback: (err) => {
              throw new Error(err);
            },
          });
          outputs.push(`Installed ${pkg} using loadPackage`);
          continue;
        } catch (loadPackageError) {
          outputs.push(
            `loadPackage failed for ${pkg}: ${String(loadPackageError)}`
          );
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
