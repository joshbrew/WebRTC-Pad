import inject from '../src/inject/index.js';
try {
  const driver = await inject.createInjector();
  console.log(`Ready: ${driver.name}`);
  driver.close();
} catch (error) {
  console.error(`Controller unavailable: ${error.message}\nSee README.md for platform setup. Video streaming can still run.`);
  process.exitCode = 1;
}
