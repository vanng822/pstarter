var cluster = require('cluster'), fs = require('fs'), os = require('os');
var exec = require('child_process').exec;
/* if worker die less than this milliseconds then will not fork new worker */
var MIMIMUM_AGE = 2000;
var conf;
var config = {};

var shuttingDown = false;

var PID_FILE = null;

/* between worker restart */
var gracefulStep = 1000;
var nodejs = '';
var serverName = '';

process.argv.forEach(function(val, index, array) {
	if (index == 0) {
		nodejs = val;
	} else if (index == 1) {
		serverName = val.split('/').pop();
	} else {
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

/**
 * No guarantee
 */
function isRunning(pid, callback) {
	var command;
	if(!pid) {
		callback(false);
		return;
	}
	command = 'ps -ef | grep \'' + nodejs + '\'| grep \'' + serverName + '\' | grep -v grep | awk \'{print $2}\'';
	exec(command, function(err, stdout, stderr) {
		var pids;
		if(err || stderr) {
			callback(false);
			return;
		}
		pids = stdout.trim().split("\n");
		if(pids.indexOf(pid) != -1) {
			callback(true);
			return;
		}
		callback(false);
	});
}

function workerOnfork(worker) {
	worker.on('listening', function(address) {
		console.log('Worker ' + worker.process.pid + ' is listening at ' + address.address + ':' + address.port);
	});
	worker.on('online', function() {
		console.log('Worker ' + worker.process.pid + ' is online');
	});
	worker.created = Date.now();
	Object.defineProperty(worker, 'age', { get : function() {
		return Date.now() - this.created;
	}});
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
		var pid = fs.readFileSync(PID_FILE, 'utf8');
		
		isRunning(pid, function(running) {
			if(running) {
				process.stderr.write("Running process exists\n");
				process.stderr.write("Not starting a new master\n");
				process.stderr.write("pstarter exits\n");
				process.stderr.write("Please check process id: " + pid + "\n");
				process.exit(1);
			}

			if(masterSettings) {
				cluster.setupMaster(masterSettings);
			}
			
			cluster.on('fork', workerOnfork);

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
				if (worker.age < MIMIMUM_AGE) {
					console.error("Worker died to soon\n");
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
		});
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
