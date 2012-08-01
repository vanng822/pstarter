var cluster = require('cluster'), fs = require('fs'), os = require('os');
var conf;
var config = {};

var shuttingDown = false;

var PID_FILE = null;

/* between worker restart */
var gracefulStep = 1000;

process.argv.forEach(function(val, index, array) {
	if(index > 1) {
		if(val.indexOf('=')) {
			var kv = val.split('=');
			k = kv.shift();
			v = kv.shift();
			if(v && k) {
				process.env[k] = v;
			}
		}
	}
});

if('PID_FILE' in process.env) {
	PID_FILE = process.env['PID_FILE'];
}

function workerInfo(worker) {
	worker.on('listening', function(address) {
		console.log('Worker ' + worker.process.pid + ' is listening at ' + address.address + ':' + address.port);
	});

	worker.on('online', function() {
		console.log('Worker ' + worker.process.pid + ' is online');
	});
}

function killWorker(pid, delay, signal) {
	var signal = (signal == 'SIGUSR2') ? 'SIGUSR2' : 'SIGTERM';
	if(delay > 0) {
		setTimeout(function() {
			try {
				process.kill(pid, signal);
			} catch(e) {
			}
		}, delay);
	} else {
		try {
			process.kill(pid, signal);
		} catch(e) {
		}
	}
}

function gracefulWorker(worker, delay) {
	setTimeout(function() {
		worker.disconnect();
		killWorker(worker.process.pid, 1000, 'SIGUSR2');
	}, delay);
}

// Fork workers.
function forkWorkers(numWorkers, env) {
	var workers = [];
	env = env || {};
	for(var i = 0; i < numWorkers; i++) {
		worker = cluster.fork(env);
		console.log("Start worker: " + worker.process.pid);
		workerInfo(worker);
		workers.push(worker);
	}
	return workers;
}

function loadConfig(confFile) {
	if( typeof confFile == 'string') {
		config = require(confFile);
	} else if( typeof confFile == 'object') {
		config = confFile;
	}

	if(!config.http) {
		config.http = {};
		config.http.numWorkers = os.cpus().length;
	} else if(!config.http.numWorkers) {
		config.http.numWorkers = os.cpus().length;
	}

}

module.exports.startMaster = function(confFile, masterSettings, callback) {
	if(cluster.isMaster) {
		conf = confFile;
		loadConfig(conf);

		if(!PID_FILE) {
			if(config.PID_FILE) {
				PID_FILE = config.PID_FILE;
			} else {
				PID_FILE = 'pstarter.pid';
			}
		}

		if(masterSettings) {
			cluster.setupMaster(masterSettings);
		}

		cluster.on('exit', function(worker, code, signal) {
			console.log('worker ' + worker.process.pid + ' died');
			if(shuttingDown === true) {
				console.log('master is shutting down workers');
				return;
				/* master is shutting down workers. */
			}
			if(Object.keys(cluster.workers).length >= config.http.numWorkers) {
				return;
			}
			worker = forkWorkers(1).shift();
			console.log("Replace with worker: " + worker.process.pid);
		});
		forkWorkers(config.http.numWorkers);

		/* graceful */
		process.on('SIGUSR2', function() {
			console.log("Graceful signal");

			var ids = [], timeout = 0;
			ids = Object.keys(cluster.workers);
			worker = forkWorkers(1).shift();
			console.log("Create extra worker for better graceful: " + worker.process.pid);
			worker.on('listening', function(address) {
				console.log('Extra worker ' + worker.process.pid + ' is listening at ' + address.address + ':' + address.port);
				ids.forEach(function(id) {
					gracefulWorker(cluster.workers[id], timeout);
					timeout += gracefulStep;
				});
			});
		});
		/* restart: reload http/master conf before starting workers */
		process.on('SIGHUP', function() {
			console.log("Restart signal");
			var pids = [];

			if( typeof conf == 'string') {
				try {
					delete require.cache[require.resolve(conf)];
					loadConfig(conf);
				} catch(e) {
				}
			}

			Object.keys(cluster.workers).forEach(function(id) {
				cluster.workers[id].disconnect();
				pids.push(cluster.workers[id].process.pid);
			});

			pids.forEach(function(pid) {
				killWorker(pid, 0, 'SIGTERM');
			});
			/* Don't work well on Ubuntu/Node v0.8.1
			 cluster.disconnect(function() {
			 console.log('Fork new worker set');
			 forkWorkers(config.http.numWorkers);
			 });
			 */
		});
		/* stop */
		process.on('SIGTERM', function() {
			shuttingDown = true;
			var pids = [];
			Object.keys(cluster.workers).forEach(function(id) {
				cluster.workers[id].disconnect();
				pids.push(cluster.workers[id].process.pid);
			});

			pids.forEach(function(pid) {
				killWorker(pid, 0, 'SIGTERM');
			});
			var fd = fs.openSync(PID_FILE, 'w+');
			fs.writeSync(fd, "");
			fs.close(fd);
			process.exit(0);

			/* Don't work well on Ubuntu/Node v0.8.1
			 cluster.disconnect(function() {
			 console.log('Finishing disconnect');
			 var fd = fs.openSync(PID_FILE, 'w+');
			 fs.writeSync(fd, "");
			 fs.close(fd);
			 process.exit(0);
			 });
			 */
		});
		var fd = fs.openSync(PID_FILE, 'w+');
		fs.writeSync(fd, process.pid);
		fs.close(fd);

		if(callback) {
			callback();
		}
	}

	return this;
};
/**
 * @param {Function} callback
 *  function to execute worker/application code
 * @param {Function} cleanupCallback
 * 	is a function that takes a callback for exiting
 *  or just call process.exit when done
 */
module.exports.startWorker = function(callback, cleanupCallback) {
	if(cluster.isWorker) {
		process.on('SIGUSR2', function() {
			console.log("Process is under killed: " + process.pid);
			console.log('Graceful');
			/* doing cleanup before exit */
			if(cleanupCallback) {
				cleanupCallback(function() {
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
		});

		process.on('SIGTERM', function() {
			console.log("Process is under killed: " + process.pid);
			console.log('Stop/kill');
			/* doing cleanup before exit */
			if(cleanupCallback) {
				cleanupCallback(function() {
					process.exit(0);
				});
			} else {
				process.exit(0);
			}
		});
		if(callback) {
			callback();
		}
	}
	return this;
};
