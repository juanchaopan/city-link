import fs from 'node:fs';

const [file, expected] = process.argv.slice(2);
const deadline = Date.now() + 480000;
const timer = setInterval(() => {
  let count = 0;
  try {
    count = JSON.parse(fs.readFileSync(file, 'utf8')).length;
  } catch {
    count = 0;
  }
  if (count >= Number(expected) || Date.now() > deadline) {
    clearInterval(timer);
    console.log(`results ${count}/${expected}`);
  }
}, 3000);
