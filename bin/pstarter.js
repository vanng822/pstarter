var pstarter = require('../lib/pstarter.js');
console.log('Parent pid: ' + process.pid);
pstarter.startMaster({}).startWorker(function() {
	// run worker code
	var r = parseInt(Math.random() * 10000) + 6000;
	console.log('Hello world!');
	console.log('will die in ' + r + ' ms');
	setTimeout(function() {
		throw Error('DADA');
	}, r);
});

/*
// OR
// master.js
var pstarter = require('PATH_TO_LIB/pstarter.js');
pstarter.startMaster(CONFIG_FILE, {exec : 'PATH_TO_WORKER/worker.js'})

// worker.js
var pstarter = require('PATH_TO_LIB/pstarter.js');
pstart.startWorker(function() {
// Run worker code here
});
// or here
*/
