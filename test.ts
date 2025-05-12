import { execSync } from 'child_process';
import { PyodideManager } from './src/lib/pyodide/pyodide-manager.js';

// Function to extract Python packages from a Python script
function extractPythonPackages(scriptContent: string): string[] {
  // Set to store unique package names
  const packages = new Set<string>();

  // Regular expressions for different import patterns
  const importPatterns = [
    // Match: import package
    /import\s+([a-zA-Z0-9_]+)/g,
    // Match: from package import ...
    /from\s+([a-zA-Z0-9_]+)\s+import/g,
    // Match: pip install package
    /pip\s+install\s+([a-zA-Z0-9_-]+)/g
  ];

  // Process each pattern
  importPatterns.forEach((pattern) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const packageName = match[1];
      // Exclude Python keywords and common built-in modules
      if (!isPythonKeywordOrBuiltIn(packageName)) {
        packages.add(packageName);
      }
    }
  });

  return Array.from(packages);
}

// Helper function to filter out Python keywords and built-in modules
function isPythonKeywordOrBuiltIn(name: string) {
  const pythonKeywordsAndBuiltIns = [
    'False',
    'None',
    'True',
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
    'os',
    'sys',
    'math',
    'random',
    'datetime',
    'time',
    'json',
    're',
    'string'
    // Add more built-in modules as needed
  ];
  return pythonKeywordsAndBuiltIns.includes(name);
}

(async () => {
  const pyodideManager = PyodideManager.getInstance();
  const sessionId = 'ducpl';
  const scriptContent = `
import matplotlib.pyplot as plt

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
  await Promise.all(packages.map((pkg) => pyodideManager.installPackage(pkg)));
  await pyodideManager.executePython(scriptContent, 10000);

  const output = execSync(`chafa data/${sessionId}/fruit.png`).toString();
  console.log(output);
})();
