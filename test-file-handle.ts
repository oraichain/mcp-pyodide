import { execSync } from 'child_process';
import fs, { readdirSync } from 'fs';
import { PyodideManager } from './src/lib/pyodide/pyodide-manager.js';
import path from 'path';

// Function to extract Python packages from a Python script
function extractPythonPackages(pythonCode: string): string[] {
  const regex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match: RegExpExecArray | null;
  const packages = new Set<string>();

  while ((match = regex.exec(pythonCode)) !== null) {
    packages.add(match[1]);
  }

  return Array.from(packages);
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

class FileSystemHandle {
  readonly kind: 'file' | 'directory'; // Type of handle
  readonly name: string; // Name of the file or directory
  readonly directory: string;

  constructor(directory: string, name: string, kind: 'file' | 'directory') {
    this.directory = directory;
    this.name = name;
    this.kind = kind;
  }

  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(true);
  } // Compare two handles
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState> {
    return Promise.resolve('granted');
  }

  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState> {
    return Promise.resolve('granted');
  }

  getFile(): Promise<File> {
    // check permission here
    const filepath = path.join(this.directory, this.name);
    const filename = this.name;

    // @ts-ignore
    return Promise.resolve({
      arrayBuffer: (): Promise<ArrayBuffer> => {
        return Promise.resolve(fs.readFileSync(filepath).buffer);
      },
      name: filename,
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/lastModified) */
      lastModified: 111
    });
  }
}

class FileSystemFileHandle extends FileSystemHandle {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemFileHandle/createWritable) */
  createWritable(
    options?: FileSystemCreateWritableOptions
  ): Promise<FileSystemWritableFileStream> {
    return Promise.resolve(new FileSystemWritableFileStream());
  }
}

class FileSystemDirectoryHandle {
  private directory: string;
  name: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }
  kind: 'directory';
  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions
  ): Promise<FileSystemDirectoryHandle> {
    return Promise.resolve(new FileSystemDirectoryHandle(name));
  }
  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions
  ): Promise<FileSystemFileHandle> {
    // @ts-ignore
    const file = new FileSystemFileHandle(this.directory, name, 'file');

    return Promise.resolve(file);
  }
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    return Promise.resolve();
  }
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    return Promise.resolve([possibleDescendant.name]);
  }
  entries(): [string, FileSystemHandle][] {
    const ret: [string, FileSystemHandle][] = [];
    for (const dir of readdirSync(this.directory)) {
      ret.push([dir, new FileSystemHandle(this.directory, dir, 'file')]);
    }
    return ret;
  }
  keys(): string[] {
    const ret: string[] = [];
    for (const dir of readdirSync(this.directory)) {
      ret.push(dir);
    }

    return ret;
  }
  values(): FileSystemHandle[] {
    const ret: FileSystemHandle[] = [];
    for (const dir of readdirSync(this.directory)) {
      ret.push(new FileSystemHandle(this.directory, dir, 'file'));
    }
    return ret;
  }
  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(false);
  }
  [Symbol.asyncIterator](): [string, FileSystemHandle][] {
    return this.entries();
  }
}

(async () => {
  const pyodideManager = PyodideManager.getInstance();
  //   const scriptContent = `
  // import matplotlib.pyplot as plt

  // # Data provided by you
  // categories = ['Apples', 'Bananas', 'Oranges', 'Grapes']
  // values = [25, 30, 15, 20]

  // # Set title and labels
  // plt.title('Fruit Sales')
  // plt.xlabel('Fruit Type')
  // plt.ylabel('Sales (in units)')

  // # Use skyblue color for the bars
  // plt.bar(categories, values, color='#87CEEB')  # Assuming '#87CEEB' is the skyblue color code

  // # Save the chart as /mnt/data/chart.png
  // plt.savefig('/mnt/data/chart.png')

  // `;
  const scriptContent = `
import glob
print(glob.glob("/mnt/*/**"))
`;
  await pyodideManager.initialize('./cache');
  const pyodide = pyodideManager.getPyodide()!;
  const fileHandle = new FileSystemDirectoryHandle('data');
  // @ts-ignore
  pyodide.mountNativeFS(`/mnt/data`, fileHandle);

  const packages = extractPythonPackages(scriptContent);
  console.log(packages);
  await Promise.all(packages.map((pkg) => pyodideManager.installPackage(pkg)));
  console.log(await pyodideManager.executePython(scriptContent, 10000));

  // const output = execSync(`chafa data/chart.png`).toString();
  // console.log(output);
  process.exit();
})();
