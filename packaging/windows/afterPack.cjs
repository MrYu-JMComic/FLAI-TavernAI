const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const source = path.resolve(context.packager.projectDir, '..', '..', 'dist', 'windows-app', 'backend', 'node_modules');
  const destination = path.join(context.appOutDir, 'resources', 'backend', 'node_modules');

  if (!fs.existsSync(source)) {
    throw new Error(`Backend node_modules staging directory is missing: ${source}`);
  }

  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
};
