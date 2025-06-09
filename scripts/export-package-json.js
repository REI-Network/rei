const fs = require('fs');
const path = require('path');

fs.rmSync('exported-package-json', { recursive: true, force: true });

const packages = fs.readdirSync('packages');

packages.forEach((package) => {
  // ignore contracts package
  if (package === 'contracts') {
    return;
  }

  const packageJson = fs.readFileSync(
    path.join('packages', package, 'package.json'),
    'utf8'
  );
  fs.mkdirSync(path.join('exported-package-json', package), {
    recursive: true
  });
  fs.writeFileSync(
    path.join('exported-package-json', package, 'package.json'),
    packageJson
  );
});

console.log('Exported package.json files');
