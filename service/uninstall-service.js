const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'TallyDayBookMailer',
  script: path.resolve(__dirname, '..', 'dist', 'index.js'),
});

svc.on('uninstall', function () {
  console.log('TallyDayBookMailer Windows Service uninstalled successfully.');
});

svc.on('error', function (err) {
  console.error('Uninstall error:', err);
});

svc.uninstall();

