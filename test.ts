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
  const scriptContent = `
import matplotlib.pyplot as plt                                                                                                                                                     
                                                                                                                                                                                     
# Data provided by you                                                                                                                                                              
categories = ['Apples', 'Bananas', 'Oranges', 'Grapes']                                                                                                                             
values = [25, 30, 15, 20]                                                                                                                                                           
                                                                                                                                                                                     
# Set title and labels                                                                                                                                                              
plt.title('Fruit Sales')                                                                                                                                                            
plt.xlabel('Fruit Type')                                                                                                                                                            
plt.ylabel('Sales (in units)')                                                                                                                                                      
                                                                                                                                                                                    
# Use skyblue color for the bars                                                                                                                                                    
plt.bar(categories, values, color='#87CEEB')  # Assuming '#87CEEB' is the skyblue color code                                                                                        
                                                                                                                                                                                    
# Save the chart as /mnt/data/chart.png                                                                                                                                             
plt.savefig('/mnt/data/chart.png') 

`;
  await pyodideManager.initialize('./cache');
  await pyodideManager.mountDirectory('data', `data`);

  const packages = extractPythonPackages(scriptContent);
  console.log(packages);
  await Promise.all(packages.map((pkg) => pyodideManager.installPackage(pkg)));
  await pyodideManager.executePython(scriptContent, 10000);

  const output = execSync(`chafa data/chart.png`).toString();
  console.log(output);
})();
