import { Worker } from 'worker_threads';

async function runCode(code: string, timeout: number = 10000) {
  const worker = new Worker('./pyodideWorker.js', {
    workerData: { cmd: 'runCode', code }
  });

  return new Promise((resolve, reject) => {
    worker.on('message', (msg) => {
      if (msg.cmd === 'response') {
        resolve(msg.result);
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code: ${code}`));
      }
    });
    setTimeout(() => {
      reject(new Error('Timeout error'));
    }, timeout);
  });
}

(async () => {
  const ret = await runCode(
    `
while True:    
    print("hello world")    
    `,
    10000
  );
  console.log(ret);
  process.exit();
})();
