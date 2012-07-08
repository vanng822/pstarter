var pstarter = require('../lib/pstarter.js');

pstarter.startMaster(CONFIG_FILE).startWorker(function() {
	// run worker code
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
