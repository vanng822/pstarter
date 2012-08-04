var pstarter = require('../lib/pstarter.js');
pstarter.startMaster({}).startWorker(function() {
	// run worker code
	var r = parseInt(Math.random() * 20000) + 10000;
	console.log('Hello world!');
/*	console.log('will die in ' + r + ' ms');

	setTimeout(function() {
		if(Math.random() > 0.5) {
			throw Error('DADA');
		} else {
			process.exit(1);
		}
	}, r);*/
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