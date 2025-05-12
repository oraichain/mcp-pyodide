import { execSync } from 'child_process';
import { PyodideManager } from './src/lib/pyodide/pyodide-manager.js';

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

(async () => {
  const pyodideManager = PyodideManager.getInstance();
  const sessionId = 'ducpl';
  const scriptContent = `
from matplotlib import pyplot as plt

fig, ax = plt.subplots()

fruits = ['apple', 'blueberry', 'cherry', 'orange']
counts = [40, 100, 30, 55]
bar_labels = ['red', 'blue', '_red', 'orange']
bar_colors = ['tab:red', 'tab:blue', 'tab:red', 'tab:orange']

ax.bar(fruits, counts, label=bar_labels, color=bar_colors)

ax.set_ylabel('fruit supply')
ax.set_title('Fruit supply by kind and color')
ax.legend(title='Fruit color')

plt.savefig('/mnt/data/fruit.png')

`;
  await pyodideManager.initialize('./cache');
  await pyodideManager.mountDirectory('data', `data/${sessionId}`);

  const packages = extractPythonPackages(scriptContent);
  console.log(packages);
  await Promise.all(packages.map((pkg) => pyodideManager.installPackage(pkg)));
  await pyodideManager.executePython(scriptContent, 10000);

  const output = execSync(`chafa data/${sessionId}/fruit.png`).toString();
  console.log(output);
})();
