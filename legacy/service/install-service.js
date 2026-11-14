const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'TallyDayBookMailer',
  description: 'Automated TallyPrime Day Book Exporter and Scheduled Email Middleware',
  script: path.resolve(__dirname, '..', 'dist', 'index.js'),
  nodeOptions: [
    '--max_old_space_size=4096'
  ],
  execPath: process.execPath,
  env: [
    {
      name: 'NODE_ENV',
      value: 'production',
    },
  ],
  // Auto-restart on failure
  wait: 2,
  grow: 0.25,
  maxRestarts: 10,
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
  console.log('TallyDayBookMailer Windows Service installed successfully!');
  console.log('Starting service...');
  svc.start();
});

svc.on('alreadyinstalled', function () {
  console.log('TallyDayBookMailer Windows Service is already installed.');
});

svc.on('start', function () {
  console.log('TallyDayBookMailer Windows Service started successfully.');
});

svc.on('error', function (err) {
  console.error('Service error:', err);
});

svc.install();

