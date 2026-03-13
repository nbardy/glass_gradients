import fs from 'fs';
import { PNG } from 'pngjs';

function checkImage(filename) {
  if (!fs.existsSync(filename)) {
    console.log(filename + " does not exist.");
    return;
  }
  const data = fs.readFileSync(filename);
  const png = PNG.sync.read(data);
  let rSum = 0, gSum = 0, bSum = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    rSum += png.data[i];
    gSum += png.data[i+1];
    bSum += png.data[i+2];
  }
  const len = png.data.length / 4;
  console.log(`${filename} avg: R=${rSum/len}, G=${gSum/len}, B=${bSum/len}`);
}

checkImage('webgpu-screenshot.png');
checkImage('glass-test-screenshot.png');
